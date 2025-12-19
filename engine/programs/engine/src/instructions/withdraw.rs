use anchor_lang::{prelude::*, solana_program};

use crate::{
    checked_add, checked_div,
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    events::Withdrawn,
    state::{Contribution, LaunchPreset, LaunchState, WithdrawnRanges},
    utils::bitmap::TicketBitmap,
};

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub contributor: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_ROOT, b"contributor", launch_state.key().as_ref(), contributor.key().as_ref()],
        bump,
        constraint = contribution.withdraw_count < launch_preset.withdrawal_limit @ EngineErrorCode::LimitExceeded
    )]
    pub contribution: Account<'info, Contribution>,

    #[account(mut, constraint = launch_state.is_funding_active() @ EngineErrorCode::FundingInactive)]
    pub launch_state: Account<'info, LaunchState>,

    #[account(address = launch_state.preset @ EngineErrorCode::MalformedPreset)]
    pub launch_preset: Account<'info, LaunchPreset>,

    #[account(mut, seeds = [SEED_ROOT, b"bitmap", launch_state.key().as_ref()], bump)]
    pub launch_bitmap: Account<'info, TicketBitmap>,

    #[account(mut, seeds = [SEED_ROOT, b"withdrawn", launch_state.key().as_ref()], bump)]
    pub withdrawn_ranges: Account<'info, WithdrawnRanges>,

    /// CHECK: Escrow authority PDA without data for SOL storage
    #[account(mut, seeds = [SEED_ROOT, b"escrow_authority", launch_state.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    let launch_state = &mut ctx.accounts.launch_state;
    let contribution = &mut ctx.accounts.contribution;
    let launch_bitmap = &mut ctx.accounts.launch_bitmap;

    require!(amount > 0 && amount % launch_state.tau_lamports == 0, EngineErrorCode::BadAmount);

    let tickets_to_remove = checked_div!(amount, launch_state.tau_lamports)? as u32;
    require!(
        contribution.total_tickets() >= tickets_to_remove,
        EngineErrorCode::InsufficientDeposit
    );
    let removed_ranges = contribution.remove_tickets(tickets_to_remove);

    for range in removed_ranges {
        launch_bitmap.clear_range(range.start, range.count);
        ctx.accounts.withdrawn_ranges.push(range);
    }

    contribution.withdraw_count = checked_add!(contribution.withdraw_count, 1)?;

    let launch_key = launch_state.key();
    let signer_seeds: &[&[u8]] = &[
        SEED_ROOT,
        b"escrow_authority",
        launch_key.as_ref(),
        &[ctx.bumps.escrow_authority],
    ];

    let transfer_ix = solana_program::system_instruction::transfer(
        &ctx.accounts.escrow_authority.key(),
        &ctx.accounts.contributor.key(),
        amount,
    );
    solana_program::program::invoke_signed(
        &transfer_ix,
        &[
            ctx.accounts.escrow_authority.to_account_info(),
            ctx.accounts.contributor.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        &[signer_seeds],
    )?;

    emit!(Withdrawn {
        launch: launch_state.key(),
        contributor: ctx.accounts.contributor.key(),
        amount
    });

    Ok(())
}
