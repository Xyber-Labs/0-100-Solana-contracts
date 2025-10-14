use crate::constants::SEED_ROOT;
use crate::errors::ErrorCode as EngineErrorCode;
use crate::events::Withdrawn;
use crate::state::{EscrowAccount, LaunchState, RosterShard, UserContribution};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::clock::Clock;

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,
    #[account(mut, seeds = [SEED_ROOT, b"user", launch_state.key().as_ref(), user.key().as_ref()], bump)]
    pub user_contribution: Account<'info, UserContribution>,
    // Legacy roster removed from new flow
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

pub fn handler(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    let launch_state = &mut ctx.accounts.launch_state;

    // Check if funding period is still active
    let current_time = Clock::get()?.unix_timestamp;
    require!(
        current_time < launch_state.funding_period_end,
        EngineErrorCode::FundingPeriodEnded
    );
    let user = &mut ctx.accounts.user_contribution;
    require!(
        user.deposited >= amount,
        EngineErrorCode::InsufficientDeposit
    );

    // return lamports from escrow to user
    **ctx
        .accounts
        .escrow
        .to_account_info()
        .try_borrow_mut_lamports()? -= amount;
    **ctx
        .accounts
        .user
        .to_account_info()
        .try_borrow_mut_lamports()? += amount;

    // recompute tickets
    let old_tickets = user.ticket_count;
    user.deposited = user
        .deposited
        .checked_sub(amount)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
    let new_tickets = (user
        .deposited
        .checked_div(launch_state.tau_lamports)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?) as u32;
    let lost = old_tickets
        .checked_sub(new_tickets)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
    user.ticket_count = new_tickets;

    // Sharded roster decrement
    let shard = &mut ctx.accounts.roster_shard;
    require!(
        user.shard_id == shard.shard_id,
        EngineErrorCode::Unauthorized
    );
    let u = user.idx_in_shard as usize;
    if shard.counts.len() <= u {
        shard.counts.resize(u + 1, 0);
    }
    shard.counts[u] = shard.counts[u]
        .checked_sub(lost)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
    shard.prefix.clear();
    shard.total_in_shard = 0; // prevent stale reads pre-finalization
    launch_state.total_tickets = launch_state
        .total_tickets
        .checked_sub(lost)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
    launch_state.total_deposited = launch_state
        .total_deposited
        .checked_sub(amount)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;

    emit!(Withdrawn {
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
