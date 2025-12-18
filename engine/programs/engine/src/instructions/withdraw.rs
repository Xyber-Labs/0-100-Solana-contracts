use anchor_lang::{prelude::*, solana_program};

use crate::{
    checked_div, checked_sub,
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    events::Withdrawn,
    state::{LaunchPreset, LaunchState, UserContribution, VacantRanges},
    utils::bitmap::TicketBitmap,
};

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub launch_preset: Account<'info, LaunchPreset>,

    #[account(mut, constraint = launch_state.is_funding_active() @ EngineErrorCode::FundingInactive)]
    pub launch_state: Account<'info, LaunchState>,

    #[account(mut, seeds = [SEED_ROOT, b"bitmap", launch_state.key().as_ref()], bump)]
    pub launch_bitmap: Account<'info, TicketBitmap>,

    #[account(mut, seeds = [SEED_ROOT, b"vacant", launch_state.key().as_ref()], bump)]
    pub vacant_ranges: Account<'info, VacantRanges>,

    #[account(mut, seeds = [SEED_ROOT, b"user", launch_state.key().as_ref(), user.key().as_ref()], bump)]
    pub user_contribution: Account<'info, UserContribution>,

    /// CHECK: Escrow authority PDA without data for SOL storage
    #[account(mut, seeds = [SEED_ROOT, b"escrow_authority", launch_state.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,

    /// CHECK: Treasury for withdrawal fees
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    let launch_state = &mut ctx.accounts.launch_state;
    let launch_preset = &ctx.accounts.launch_preset;
    let contribution = &mut ctx.accounts.user_contribution;

    require!(amount > 0 && amount % launch_state.tau_lamports == 0, EngineErrorCode::BadAmount);

    let tickets_to_remove = checked_div!(amount, launch_state.tau_lamports)? as u32;
    require!(contribution.total_tickets() >= tickets_to_remove, EngineErrorCode::InsufficientDeposit);
    let removed_ranges = contribution.remove_tickets(tickets_to_remove);

    let launch_bitmap = &mut ctx.accounts.launch_bitmap;
    let vacant_ranges = &mut ctx.accounts.vacant_ranges;
    for range in removed_ranges {
        launch_bitmap.clear_range(range.start, range.count);
        vacant_ranges.push(range);
    }

    let mut transfer_amount = amount;
    if contribution.withdraw_count >= launch_preset.free_withdrawals_limit {
        let fee = launch_preset.withdraw_fee_lamports;
        require!(amount > fee, EngineErrorCode::InsufficientDeposit);
        transfer_amount = checked_sub!(amount, fee)?;

        let launch_key = launch_state.key();
        let signer_seeds: &[&[u8]] = &[
            SEED_ROOT,
            b"escrow_authority",
            launch_key.as_ref(),
            &[ctx.bumps.escrow_authority],
        ];

        let fee_ix = solana_program::system_instruction::transfer(
            &ctx.accounts.escrow_authority.key(),
            &ctx.accounts.treasury.key(),
            fee,
        );
        solana_program::program::invoke_signed(
            &fee_ix,
            &[
                ctx.accounts.escrow_authority.to_account_info(),
                ctx.accounts.treasury.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[signer_seeds],
        )?;
    }
    contribution.withdraw_count = contribution.withdraw_count.saturating_add(1);

    let launch_key = launch_state.key();
    let signer_seeds: &[&[u8]] = &[
        SEED_ROOT,
        b"escrow_authority",
        launch_key.as_ref(),
        &[ctx.bumps.escrow_authority],
    ];

    let transfer_ix = solana_program::system_instruction::transfer(
        &ctx.accounts.escrow_authority.key(),
        &ctx.accounts.user.key(),
        transfer_amount,
    );
    solana_program::program::invoke_signed(
        &transfer_ix,
        &[
            ctx.accounts.escrow_authority.to_account_info(),
            ctx.accounts.user.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        &[signer_seeds],
    )?;

    launch_state.total_tickets = checked_sub!(launch_state.total_tickets, tickets_to_remove)?;
    launch_state.total_deposited = checked_sub!(launch_state.total_deposited, amount)?;

    emit!(Withdrawn {
        launch: launch_state.key(),
        user: ctx.accounts.user.key(),
        amount
    });

    Ok(())
}
