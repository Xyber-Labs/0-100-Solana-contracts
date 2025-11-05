use crate::{
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    events::DepositMade,
    state::{LaunchState, RosterShard, UserContribution},
};
use anchor_lang::{prelude::*, solana_program};
use solana_program::sysvar::clock::Clock;

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
    
    #[account(mut, constraint = roster_shard.launch == launch_state.key())]
    pub roster_shard: Account<'info, RosterShard>,
    /// CHECK: Escrow authority PDA without data for SOL storage
    #[account(mut, seeds = [SEED_ROOT, b"escrow_authority", launch_state.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,

    /// CHECK: This is the launch account referenced by the roster
    #[account(address = launch_state.key())]
    pub launch: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    let launch_state = &mut ctx.accounts.launch_state;

    // Check if funding period is still active
    let current_time = Clock::get()?.unix_timestamp;
    require!(current_time >= launch_state.funding_period_start, EngineErrorCode::FundingPeriodNotStarted);
    require!(current_time < launch_state.funding_period_end, EngineErrorCode::FundingPeriodEnded);
    require!(
        amount > 0 && amount % launch_state.tau_lamports == 0,
        EngineErrorCode::AmountNotMultipleTau
    );

    // Creator must use privileged creator_deposit, not user deposit
    require!(ctx.accounts.user.key() != launch_state.creator, EngineErrorCode::Unauthorized);

    // per-wallet cap check
    let current = ctx.accounts.user_contribution.deposited;
    require!(
        current.checked_add(amount).ok_or(EngineErrorCode::ArithmeticOverflow)?
            <= launch_state.per_wallet_cap,
        EngineErrorCode::PerWalletCapExceeded
    );

    // transfer to escrow_authority
    let ix = solana_program::system_instruction::transfer(
        &ctx.accounts.user.key(),
        &ctx.accounts.escrow_authority.key(),
        amount,
    );
    anchor_lang::solana_program::program::invoke(
        &ix,
        &[
            ctx.accounts.user.to_account_info(),
            ctx.accounts.escrow_authority.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
    )?;

    // update user
    let user = &mut ctx.accounts.user_contribution;
    let is_first_deposit = user.wallet == Pubkey::default();

    // Initialize wallet field if this is the first deposit
    if is_first_deposit {
        user.launch = launch_state.key();
        user.wallet = ctx.accounts.user.key();
        user.claimed_refund = false;
        user.claimed_tokens = false;
    }

    let old_tickets = user.ticket_count;
    user.deposited = current.checked_add(amount).ok_or(EngineErrorCode::ArithmeticOverflow)?;
    let new_tickets_u64 = user
        .deposited
        .checked_div(launch_state.tau_lamports)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
    require!(new_tickets_u64 <= u32::MAX as u64, EngineErrorCode::U64ConversionOverflow);
    let new_tickets = new_tickets_u64 as u32;
    let delta = new_tickets.checked_sub(old_tickets).ok_or(EngineErrorCode::ArithmeticOverflow)?;
    user.ticket_count = new_tickets;

    // Sharded roster update: assign on first deposit, then O(1) by index
    let shard = &mut ctx.accounts.roster_shard;
    if is_first_deposit {
        // first deposit path: assign shard and index
        require!(
            shard.wallets.len() < launch_state.roster_shard_cap as usize,
            EngineErrorCode::RosterShardFull
        );
        user.shard_id = shard.shard_id;
        user.idx_in_shard = shard.wallets.len() as u32;
        shard.wallets.push(ctx.accounts.user.key());
        // Start counts at 0 for first deposit; we'll add the delta below.
        shard.counts.push(0);
        shard.prefix.clear(); // invalidate prefix if already built
    } else {
        // must stay in the same shard
        require!(user.shard_id == shard.shard_id, EngineErrorCode::Unauthorized);
    }
    let u = user.idx_in_shard as usize;
    if shard.counts.len() <= u {
        shard.counts.resize(u + 1, 0);
    }
    shard.counts[u] =
        shard.counts[u].checked_add(delta).ok_or(EngineErrorCode::ArithmeticOverflow)?;
    shard.prefix.clear(); // will be recomputed at finalize
    shard.total_in_shard = 0; // prevent stale reads pre-finalization

    launch_state.total_deposited = launch_state
        .total_deposited
        .checked_add(amount)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
    launch_state.total_tickets =
        launch_state.total_tickets.checked_add(delta).ok_or(EngineErrorCode::ArithmeticOverflow)?;

    emit!(DepositMade {
        launch: launch_state.key(),
        user: ctx.accounts.user.key(),
        amount,
        tickets_before: old_tickets,
        tickets_after: new_tickets,
        total_deposited: launch_state.total_deposited,
        total_tickets: launch_state.total_tickets,
    });

    Ok(())
}
