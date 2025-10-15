use anchor_lang::{prelude::*, solana_program::sysvar::clock::Clock};

use crate::{
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    events::RefundClaimed,
    state::{CreatorGrant, EscrowAccount, LaunchState},
};

#[derive(Accounts)]
pub struct ClaimCreatorRefund<'info> {
    #[account(mut, address = launch_state.creator)]
    pub creator: Signer<'info>,

    pub launch_state: Account<'info, LaunchState>,

    #[account(
        mut,
        seeds = [SEED_ROOT, b"creator", launch_state.key().as_ref()],
        bump,
    )]
    pub creator_grant: Account<'info, CreatorGrant>,

    /// CHECK: Escrow account
    #[account(
        mut,
        address = crate::utils::pool::escrow_address(launch_state.key()),
        constraint = escrow.launch == launch_state.key()
    )]
    pub escrow: Account<'info, EscrowAccount>,
}

pub fn claim_creator_refund(ctx: Context<ClaimCreatorRefund>) -> Result<()> {
    let launch_state = &ctx.accounts.launch_state;
    let creator_grant = &mut ctx.accounts.creator_grant;

    require!(!creator_grant.refunded, EngineErrorCode::CreatorRefundAlreadyClaimed);

    // Check if funding period has ended and min raise was not met
    let current_time = Clock::get()?.unix_timestamp;
    require!(
        current_time >= launch_state.funding_period_end,
        EngineErrorCode::FundingPeriodNotEnded
    );
    require!(
        launch_state.total_deposited < launch_state.min_raise_lamports,
        EngineErrorCode::MinRaiseNotMet
    );

    let refund = creator_grant.locked_lamports;
    if refund > 0 {
        **ctx.accounts.escrow.to_account_info().try_borrow_mut_lamports()? -= refund;
        **ctx.accounts.creator.to_account_info().try_borrow_mut_lamports()? += refund;
    }

    creator_grant.refunded = true;

    emit!(RefundClaimed {
        launch: launch_state.key(),
        user: ctx.accounts.creator.key(),
        refunded_lamports: refund,
        y_approved: 0,
    });

    Ok(())
}
