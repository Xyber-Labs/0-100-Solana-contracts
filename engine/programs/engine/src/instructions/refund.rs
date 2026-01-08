use anchor_lang::prelude::*;

use crate::{
    checked_mul, checked_sub,
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    state::{Contribution, LaunchPreset, LaunchState},
    utils::lottery::LotteryRaw,
};

#[event]
pub struct Refunded {
    pub launch: Pubkey,
    pub contributor: Pubkey,
    pub lamports: u64,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub contributor: Signer<'info>,

    #[account(constraint = launch_state.is_finalized() || launch_state.is_cancelled() @ EngineErrorCode::NotFinalized)]
    pub launch_state: Account<'info, LaunchState>,

    #[account(address = launch_state.preset @ EngineErrorCode::MalformedPreset)]
    pub launch_preset: Account<'info, LaunchPreset>,

    /// CHECK: Raw winners bitmap, validated via seeds
    #[account(seeds = [SEED_ROOT, b"winners_bitmap", launch_state.key().as_ref()], bump)]
    pub winners_bitmap: UncheckedAccount<'info>,

    /// CHECK: Raw inactive bitmap, validated via seeds
    #[account(seeds = [SEED_ROOT, b"inactive_bitmap", launch_state.key().as_ref()], bump)]
    pub inactive_bitmap: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [SEED_ROOT, b"contributor", launch_state.key().as_ref(), contributor.key().as_ref()],
        bump
    )]
    pub contribution: Account<'info, Contribution>,

    /// CHECK: SOL escrow PDA
    #[account(mut, seeds = [SEED_ROOT, b"escrow_authority", launch_state.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn refund(ctx: Context<Refund>) -> Result<()> {
    let launch_state = &ctx.accounts.launch_state;
    let contribution = &mut ctx.accounts.contribution;

    let total_tickets = contribution.total_tickets();

    let refundable_total = if launch_state.is_cancelled() {
        total_tickets
    } else {
        let winners_data = ctx.accounts.winners_bitmap.try_borrow_data()?;
        let inactive_data = ctx.accounts.inactive_bitmap.try_borrow_data()?;

        let lottery = LotteryRaw::new(&**launch_state, &winners_data[..], &inactive_data[..]);

        let winners = lottery.count_winning_in_ranges(&contribution.ticket_ranges);
        checked_sub!(total_tickets, winners)?
    };

    let refundable = checked_sub!(refundable_total, contribution.tickets_refunded)?;
    require!(refundable > 0, EngineErrorCode::AlreadyRefunded);
    contribution.tickets_refunded = refundable_total;

    let tau_lamports = ctx.accounts.launch_preset.tau_lamports;
    let lamports = checked_mul!(refundable, tau_lamports)?;

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
        lamports,
    )?;

    emit!(Refunded {
        launch: launch_state.key(),
        contributor: ctx.accounts.contributor.key(),
        lamports,
    });

    Ok(())
}
