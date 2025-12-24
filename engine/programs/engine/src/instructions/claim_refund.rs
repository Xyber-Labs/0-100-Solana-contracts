use crate::{
    checked_mul, checked_sub,
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    events::RefundClaimed,
    state::{Contribution, LaunchPreset, LaunchState},
    utils::lottery::Lottery,
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct ClaimRefund<'info> {
    #[account(mut)]
    pub contributor: Signer<'info>,
    pub launch_state: Account<'info, LaunchState>,
    #[account(address = launch_state.preset @ EngineErrorCode::MalformedPreset)]
    pub launch_preset: Account<'info, LaunchPreset>,
    #[account(seeds = [SEED_ROOT, b"lottery", launch_state.key().as_ref()], bump)]
    pub lottery: Account<'info, Lottery>,
    #[account(mut, seeds = [SEED_ROOT, b"contributor", launch_state.key().as_ref(), contributor.key().as_ref()], bump)]
    pub contribution: Account<'info, Contribution>,
    /// CHECK:
    #[account(mut, seeds = [SEED_ROOT, b"escrow_authority", launch_state.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
    let launch_state = &ctx.accounts.launch_state;
    let launch_preset = &ctx.accounts.launch_preset;
    let contribution = &mut ctx.accounts.contribution;
    let lottery = &ctx.accounts.lottery;

    let total_tickets = contribution.total_tickets();

    let total_deposited = checked_mul!(lottery.active_tickets() as u64, launch_preset.tau_lamports)?;

    if launch_state.is_funding_ended(launch_preset.funding_duration_seconds)
        && total_deposited < launch_preset.min_raise_lamports
    {
        let refundable = checked_sub!(total_tickets, contribution.tickets_refunded)?;
        let refund = checked_mul!(refundable as u64, launch_preset.tau_lamports)?;
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
                        to: ctx.accounts.contributor.to_account_info(),
                    },
                    signer,
                ),
                refund,
            )?;
        }
        contribution.tickets_refunded = total_tickets;

        emit!(RefundClaimed {
            launch: launch_state.key(),
            contributor: ctx.accounts.contributor.key(),
            refunded_lamports: refund,
            y_approved: 0,
        });

        return Ok(());
    }

    require!(lottery.is_finalized(), EngineErrorCode::NotFinalized);

    let winning_tickets = lottery.count_winning_in_ranges(&contribution.ticket_ranges);
    let losing_tickets = checked_sub!(total_tickets, winning_tickets)?;
    let refundable = checked_sub!(losing_tickets, contribution.tickets_refunded)?;

    require!(refundable > 0, EngineErrorCode::AlreadyClaimedRefund);

    let refund = checked_mul!(refundable as u64, launch_preset.tau_lamports)?;
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
                    to: ctx.accounts.contributor.to_account_info(),
                },
                signer,
            ),
            refund,
        )?;
    }
    contribution.tickets_refunded = checked_sub!(total_tickets, winning_tickets)?;

    emit!(RefundClaimed {
        launch: launch_state.key(),
        contributor: ctx.accounts.contributor.key(),
        refunded_lamports: refund,
        y_approved: winning_tickets,
    });

    Ok(())
}
