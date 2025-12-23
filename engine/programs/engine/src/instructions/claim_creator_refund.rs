use anchor_lang::prelude::*;

use crate::{
    checked_mul,
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    events::RefundClaimed,
    state::{CreatorGrant, LaunchPreset, LaunchState, WithdrawnRanges},
    utils::bitmap::TicketBitmap,
};

#[derive(Accounts)]
pub struct ClaimCreatorRefund<'info> {
    #[account(mut, address = launch_state.creator)]
    pub creator: Signer<'info>,

    pub launch_state: Account<'info, LaunchState>,

    #[account(address = launch_state.preset @ EngineErrorCode::MalformedPreset)]
    pub launch_preset: Account<'info, LaunchPreset>,

    #[account(seeds = [SEED_ROOT, b"bitmap", launch_state.key().as_ref()], bump)]
    pub launch_bitmap: Account<'info, TicketBitmap>,

    #[account(seeds = [SEED_ROOT, b"withdrawn", launch_state.key().as_ref()], bump)]
    pub withdrawn_ranges: Account<'info, WithdrawnRanges>,

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
    let launch_preset = &ctx.accounts.launch_preset;
    let creator_grant = &mut ctx.accounts.creator_grant;
    let bitmap = &ctx.accounts.launch_bitmap;
    let withdrawn = &ctx.accounts.withdrawn_ranges;

    require!(!creator_grant.refunded, EngineErrorCode::CreatorRefundAlreadyClaimed);
    require!(
        launch_state.is_funding_ended(launch_preset.funding_duration_seconds),
        EngineErrorCode::FundingNotEnded
    );

    let active_tickets = bitmap.bits_allocated - withdrawn.total_withdrawn();
    let total_deposited = checked_mul!(active_tickets as u64, launch_preset.tau_lamports)?;
    require!(
        total_deposited < launch_preset.min_raise_lamports,
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
        contributor: ctx.accounts.creator.key(),
        refunded_lamports: refund,
        y_approved: 0,
    });

    Ok(())
}
