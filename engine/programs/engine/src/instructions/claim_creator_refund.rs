use anchor_lang::{prelude::*, solana_program::sysvar::clock::Clock};

use crate::{
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    events::RefundClaimed,
    state::{CreatorGrant, LaunchState},
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

    /// CHECK: SOL held on escrow_authority PDA
    #[account(mut, seeds = [SEED_ROOT, b"escrow_authority", launch_state.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn claim_creator_refund(ctx: Context<ClaimCreatorRefund>) -> Result<()> {
    let launch_state = &ctx.accounts.launch_state;
    let creator_grant = &mut ctx.accounts.creator_grant;

    require!(!creator_grant.refunded, EngineErrorCode::CreatorRefundAlreadyClaimed);

    // Check if funding period has ended and min raise was not met
    let current_time = Clock::get()?.unix_timestamp;
    require!(
        current_time >= launch_state.funding_end,
        EngineErrorCode::FundingNotEnded
    );
    require!(
        launch_state.total_deposited < launch_state.min_raise_lamports,
        EngineErrorCode::MinRaiseNotMet
    );

    let refund = creator_grant.locked_lamports;
    if refund > 0 {
        let launch_key = launch_state.key();
        let seeds = [
            SEED_ROOT,
            b"escrow_authority",
            launch_key.as_ref(),
            &[ctx.bumps.escrow_authority],
        ];
        let signer = &[&seeds[..]];
        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.escrow_authority.to_account_info(),
                    to: ctx.accounts.creator.to_account_info(),
                },
                signer,
            ),
            refund,
        )?;
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
