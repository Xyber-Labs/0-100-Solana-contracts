use anchor_lang::{prelude::*, solana_program};

use crate::{
    checked_add, checked_div,
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    events::Withdrawn,
    state::{Contribution, LaunchPreset, LaunchState, WithdrawnRanges},
    utils::{lottery::LotteryRaw, realloc::realloc_with_payer},
};

const DISCRIMINATOR_LEN: usize = 8;

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

    #[account(mut, constraint = launch_state.is_funding_active(launch_preset.funding_duration_seconds) @ EngineErrorCode::FundingInactive)]
    pub launch_state: Account<'info, LaunchState>,

    #[account(address = launch_state.preset @ EngineErrorCode::MalformedPreset)]
    pub launch_preset: Account<'info, LaunchPreset>,

    /// CHECK: Raw lottery data, validated via seeds
    #[account(mut, seeds = [SEED_ROOT, b"lottery", launch_state.key().as_ref()], bump)]
    pub lottery: UncheckedAccount<'info>,

    #[account(mut, seeds = [SEED_ROOT, b"withdrawn", launch_state.key().as_ref()], bump)]
    pub withdrawn_ranges: Account<'info, WithdrawnRanges>,

    /// CHECK: Platform account for paying reallocation
    #[account(mut, seeds = [SEED_ROOT, b"realloc_funds"], bump)]
    pub realloc_funds: UncheckedAccount<'info>,

    /// CHECK: Escrow authority PDA without data for SOL storage
    #[account(mut, seeds = [SEED_ROOT, b"escrow_authority", launch_state.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    let launch_state = &mut ctx.accounts.launch_state;
    let launch_preset = &ctx.accounts.launch_preset;
    let contribution = &mut ctx.accounts.contribution;

    require!(amount > 0 && amount % launch_preset.tau_lamports == 0, EngineErrorCode::BadAmount);

    let tickets_to_remove = checked_div!(amount, launch_preset.tau_lamports)?;
    require!(
        contribution.total_tickets() >= tickets_to_remove,
        EngineErrorCode::InsufficientDeposit
    );
    let removed_ranges = contribution.remove_tickets(tickets_to_remove);

    {
        let mut lottery_data = ctx.accounts.lottery.try_borrow_mut_data()?;
        let lottery = &mut lottery_data[DISCRIMINATOR_LEN..];

        require!(LotteryRaw::is_in_progress(lottery), EngineErrorCode::AlreadyFinalized);

        let inactive = LotteryRaw::read_inactive(lottery);
        let added_inactive: u64 = removed_ranges.iter().map(|r| r.count()).sum();
        LotteryRaw::write_inactive(lottery, inactive + added_inactive);

        for range in removed_ranges {
            LotteryRaw::clear_range(lottery, &range);
            ctx.accounts.withdrawn_ranges.push(range);
        }
    }

    realloc_with_payer(
        &ctx.accounts.withdrawn_ranges,
        &ctx.accounts.realloc_funds.to_account_info(),
    )?;

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
