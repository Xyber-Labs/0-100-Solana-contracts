use crate::{
    checked_mul, checked_sub,
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    events::RefundClaimed,
    state::{LaunchState, UserContribution},
    utils::{bitmap::TicketBitmap, lottery::count_winning_in_ranges},
};
use anchor_lang::{prelude::*, solana_program::sysvar::clock::Clock};

#[derive(Accounts)]
pub struct ClaimRefund<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    pub launch_state: Account<'info, LaunchState>,
    #[account(seeds = [SEED_ROOT, b"bitmap", launch_state.key().as_ref()], bump)]
    pub launch_bitmap: Account<'info, TicketBitmap>,
    #[account(mut, seeds = [SEED_ROOT, b"user", launch_state.key().as_ref(), user.key().as_ref()], bump)]
    pub user_contribution: Account<'info, UserContribution>,
    /// CHECK:
    #[account(mut, seeds = [SEED_ROOT, b"escrow_authority", launch_state.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
    let launch_state = &ctx.accounts.launch_state;
    let user = &mut ctx.accounts.user_contribution;
    let bitmap = &ctx.accounts.launch_bitmap;

    let total_tickets = user.total_tickets();

    let current_time = Clock::get()?.unix_timestamp;
    if current_time >= launch_state.funding_end
        && launch_state.total_deposited < launch_state.min_raise_lamports
    {
        let refundable = checked_sub!(total_tickets, user.tickets_refunded)?;
        let refund = checked_mul!(refundable as u64, launch_state.tau_lamports)?;
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
                        to: ctx.accounts.user.to_account_info(),
                    },
                    signer,
                ),
                refund,
            )?;
        }
        user.tickets_refunded = total_tickets;

        emit!(RefundClaimed {
            launch: launch_state.key(),
            user: ctx.accounts.user.key(),
            refunded_lamports: refund,
            y_approved: 0,
        });

        return Ok(());
    }

    require!(launch_state.selection_finalized, EngineErrorCode::NotFinalized);

    let winning_tickets = count_winning_in_ranges(bitmap, &user.ticket_ranges);
    let losing_tickets = checked_sub!(total_tickets, winning_tickets)?;
    let refundable = checked_sub!(losing_tickets, user.tickets_refunded)?;

    require!(refundable > 0, EngineErrorCode::AlreadyClaimedRefund);

    let refund = checked_mul!(refundable as u64, launch_state.tau_lamports)?;
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
                    to: ctx.accounts.user.to_account_info(),
                },
                signer,
            ),
            refund,
        )?;
    }
    user.tickets_refunded = checked_sub!(total_tickets, winning_tickets)? as u32;

    emit!(RefundClaimed {
        launch: launch_state.key(),
        user: ctx.accounts.user.key(),
        refunded_lamports: refund,
        y_approved: winning_tickets,
    });

    Ok(())
}
