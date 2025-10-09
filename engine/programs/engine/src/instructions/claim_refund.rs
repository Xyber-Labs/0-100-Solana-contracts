use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::clock::Clock;
use crate::errors::ErrorCode as EngineErrorCode;
use crate::events::RefundClaimed;
use crate::utils::selection::{ticket_score, tie_break_wins};
use crate::state::{EscrowAccount, LaunchState, SelectionState, UserContribution};
use crate::constants::SEED_ROOT;

#[derive(Accounts)]
pub struct ClaimRefund<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    pub launch_state: Account<'info, LaunchState>,
    #[account(mut, seeds = [SEED_ROOT, b"user", launch_state.key().as_ref(), user.key().as_ref()], bump)]
    pub user_contribution: Account<'info, UserContribution>,
    #[account(mut)]
    pub selection_state: Account<'info, SelectionState>,
    /// CHECK:
    #[account(mut, address = crate::utils::pool::escrow_address(launch_state.key()))]
    pub escrow: Account<'info, EscrowAccount>,
}

pub fn handler(ctx: Context<ClaimRefund>) -> Result<()> {
    let st = &mut ctx.accounts.launch_state;
    let user = &mut ctx.accounts.user_contribution;
    require!(!user.claimed_refund, EngineErrorCode::AlreadyClaimedRefund);

    // If funding is complete and min raise is not met, issue a full refund without selection
    let current_time = Clock::get()?.unix_timestamp;
    if current_time >= st.funding_period_end && st.total_deposited < st.min_raise_lamports {
        let refund = user.deposited;
        if refund > 0 {
            **ctx
                .accounts
                .escrow
                .to_account_info()
                .try_borrow_mut_lamports()? -= refund;
            **ctx
                .accounts
                .user
                .to_account_info()
                .try_borrow_mut_lamports()? += refund;
        }
        user.claimed_refund = true;

        emit!(RefundClaimed {
            launch: st.key(),
            user: ctx.accounts.user.key(),
            refunded_lamports: refund,
            y_approved: 0,
        });

        return Ok(());
    }

    // Otherwise, proceed as before: requires finalized selection and y calculation
    require!(st.selection_finalized, EngineErrorCode::NotFinalized);
    let threshold = st
        .threshold_score
        .ok_or(EngineErrorCode::ThresholdMissing)?;
    let seed = st.vrf_seed.ok_or(EngineErrorCode::SeedMissing)?;

    let mut y = 0u32;
    for j in 0..user.ticket_count {
        let s = ticket_score(&seed, &user.wallet, j);
        if s < threshold
            || (s == threshold
                && tie_break_wins(
                    user.wallet,
                    j,
                    threshold,
                    &ctx.accounts.selection_state.heap,
                ))
        {
            y = y
                .checked_add(1)
                .ok_or(EngineErrorCode::ArithmeticOverflow)?;
        }
    }

    let approved_lamports = (y as u64)
        .checked_mul(st.tau_lamports)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
    let refund = user
        .deposited
        .checked_sub(approved_lamports)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
    if refund > 0 {
        **ctx
            .accounts
            .escrow
            .to_account_info()
            .try_borrow_mut_lamports()? -= refund;
        **ctx
            .accounts
            .user
            .to_account_info()
            .try_borrow_mut_lamports()? += refund;
    }
    user.claimed_refund = true;

    emit!(RefundClaimed {
        launch: st.key(),
        user: ctx.accounts.user.key(),
        refunded_lamports: refund,
        y_approved: y,
    });

    Ok(())
}
