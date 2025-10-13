use anchor_lang::prelude::*;
use anchor_lang::solana_program;
use solana_program::sysvar::clock::Clock;
use crate::errors::ErrorCode as EngineErrorCode;
use crate::events::DepositMade;
use crate::state::{EscrowAccount, LaunchState, RosterShard, UserContribution};
use crate::constants::SEED_ROOT;

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserContribution::INIT_SPACE,
        seeds = [SEED_ROOT, b"user", launch_state.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_contribution: Account<'info, UserContribution>,
    // Legacy roster removed from new flow to reduce account size and confusion
    // Sharded roster account, required for new flow
    #[account(mut, constraint = roster_shard.launch == launch_state.key())]
    pub roster_shard: Account<'info, RosterShard>,
    /// Escrow account (PDA off launch_state)
    #[account(mut, address = crate::utils::pool::escrow_address(launch_state.key()), constraint = escrow.launch == launch_state.key())]
    pub escrow: Account<'info, EscrowAccount>,

    /// CHECK: This is the launch account referenced by the roster
    #[account(address = launch_state.key())]
    pub launch: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    let st = &mut ctx.accounts.launch_state;

    // Check if funding period is still active
    let current_time = Clock::get()?.unix_timestamp;
    require!(
        current_time < st.funding_period_end,
        EngineErrorCode::FundingPeriodEnded
    );
    require!(
        amount > 0 && amount % st.tau_lamports == 0,
        EngineErrorCode::AmountNotMultipleTau
    );

    // per-wallet cap check
    let current = ctx.accounts.user_contribution.deposited;
    require!(
        current
            .checked_add(amount)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?
            <= st.per_wallet_cap,
        EngineErrorCode::PerWalletCapExceeded
    );

    // transfer to escrow
    let ix = solana_program::system_instruction::transfer(
        &ctx.accounts.user.key(),
        &ctx.accounts.escrow.key(),
        amount,
    );
    anchor_lang::solana_program::program::invoke(
        &ix,
        &[
            ctx.accounts.user.to_account_info(),
            ctx.accounts.escrow.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
    )?;

    // update user
    let user = &mut ctx.accounts.user_contribution;
    let is_first_deposit = user.wallet == Pubkey::default();

    // Initialize wallet field if this is the first deposit
    if is_first_deposit {
        user.launch = st.key();
        user.wallet = ctx.accounts.user.key();
        user.claimed_refund = false;
        user.claimed_tokens = false;
    }

    let old_tickets = user.ticket_count;
    user.deposited = current
        .checked_add(amount)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
    let new_tickets_u64 = user
        .deposited
        .checked_div(st.tau_lamports)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
    require!(new_tickets_u64 <= u32::MAX as u64, EngineErrorCode::U64ConversionOverflow);
    let new_tickets = new_tickets_u64 as u32;
    let delta = new_tickets
        .checked_sub(old_tickets)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
    user.ticket_count = new_tickets;

    // Sharded roster update: assign on first deposit, then O(1) by index
    let shard = &mut ctx.accounts.roster_shard;
    if is_first_deposit {
        // first deposit path: assign shard and index
        require!(shard.wallets.len() < crate::constants::ROSTER_SHARD_CAP, EngineErrorCode::RosterShardFull);
        user.shard_id = shard.shard_id;
        user.idx_in_shard = shard.wallets.len() as u32;
        shard.wallets.push(ctx.accounts.user.key());
        shard.counts.push(new_tickets);
        shard.prefix.clear(); // invalidate prefix if already built
    } else {
        // must stay in the same shard
        require!(user.shard_id == shard.shard_id, EngineErrorCode::Unauthorized);
    }
    let u = user.idx_in_shard as usize;
    if shard.counts.len() <= u { shard.counts.resize(u+1, 0); }
    shard.counts[u] = shard.counts[u].checked_add(delta).ok_or(EngineErrorCode::ArithmeticOverflow)?;
    shard.prefix.clear(); // will be recomputed at finalize
    shard.total_in_shard = 0; // prevent stale reads pre-finalization

    st.total_deposited = st
        .total_deposited
        .checked_add(amount)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
    st.total_tickets = st
        .total_tickets
        .checked_add(delta)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;

    emit!(DepositMade {
        launch: st.key(),
        user: ctx.accounts.user.key(),
        amount,
        tickets_before: old_tickets,
        tickets_after: new_tickets,
        total_deposited: st.total_deposited,
        total_tickets: st.total_tickets,
    });

    Ok(())
}
