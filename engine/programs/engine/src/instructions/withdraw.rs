use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::clock::Clock;
use crate::errors::ErrorCode as EngineErrorCode;
use crate::events::Withdrawn;
use crate::utils::roster::roster_decr;
use crate::{EscrowAccount, LaunchState, Roster, UserContribution, SEED_ROOT};

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,
    #[account(mut, seeds = [SEED_ROOT, b"user", launch_state.key().as_ref(), user.key().as_ref()], bump)]
    pub user_contribution: Account<'info, UserContribution>,
    #[account(mut, has_one = launch)]
    pub roster: Account<'info, Roster>,
    /// Escrow account (PDA off launch_state)
    #[account(mut, address = crate::utils::pool::escrow_address(launch_state.key()))]
    pub escrow: Account<'info, EscrowAccount>,

    /// CHECK: This is the launch account referenced by the roster
    #[account(address = launch_state.key())]
    pub launch: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    let st = &mut ctx.accounts.launch_state;

    // Check if funding period is still active
    let current_time = Clock::get()?.unix_timestamp;
    require!(
        current_time < st.funding_period_end,
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

    // Update escrow balance
    ctx.accounts.escrow.balance = ctx
        .accounts
        .escrow
        .balance
        .checked_sub(amount)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;

    // recompute tickets
    let old_tickets = user.ticket_count;
    user.deposited = user
        .deposited
        .checked_sub(amount)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
    let new_tickets = (user
        .deposited
        .checked_div(st.tau_lamports)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?) as u32;
    let lost = old_tickets
        .checked_sub(new_tickets)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
    user.ticket_count = new_tickets;

    // roster decrement
    let roster = &mut ctx.accounts.roster;
    roster_decr(roster, user.wallet, lost)?;
    st.total_tickets = st
        .total_tickets
        .checked_sub(lost)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
    st.total_deposited = st
        .total_deposited
        .checked_sub(amount)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;

    emit!(Withdrawn {
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
