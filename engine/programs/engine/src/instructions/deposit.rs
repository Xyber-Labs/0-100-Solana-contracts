use anchor_lang::{prelude::*, solana_program};

use crate::{
    checked_add, checked_div, checked_mul, checked_sub,
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    events::DepositMade,
    state::{Contribution, LaunchPreset, LaunchState, TicketRange},
    utils::{lottery::{LotteryControl, LotteryRaw}, realloc::realloc_raw},
};

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub contributor: Signer<'info>,

    #[account(mut, constraint = launch_state.is_funding_active(launch_preset.funding_duration_seconds) @ EngineErrorCode::FundingInactive)]
    pub launch_state: Account<'info, LaunchState>,

    #[account(address = launch_state.preset @ EngineErrorCode::MalformedPreset)]
    pub launch_preset: Account<'info, LaunchPreset>,

    /// CHECK: Platform account for paying reallocation
    #[account(mut, seeds = [SEED_ROOT, b"realloc_funds"], bump)]
    pub realloc_funds: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [SEED_ROOT, b"lottery_control", launch_state.key().as_ref()],
        bump,
        constraint = lottery_control.is_funding() @ EngineErrorCode::AlreadyFinalized
    )]
    pub lottery_control: Account<'info, LotteryControl>,

    /// CHECK: Raw winners bitmap, validated via seeds
    #[account(mut, seeds = [SEED_ROOT, b"winners_bitmap", launch_state.key().as_ref()], bump)]
    pub winners_bitmap: UncheckedAccount<'info>,

    /// CHECK: Raw inactive bitmap, validated via seeds
    #[account(mut, seeds = [SEED_ROOT, b"inactive_bitmap", launch_state.key().as_ref()], bump)]
    pub inactive_bitmap: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = contributor,
        space = 8 + Contribution::INIT_SPACE,
        seeds = [SEED_ROOT, b"contributor", launch_state.key().as_ref(), contributor.key().as_ref()],
        bump
    )]
    pub contribution: Account<'info, Contribution>,

    /// CHECK: Escrow authority PDA without data for SOL storage
    #[account(mut, seeds = [SEED_ROOT, b"escrow_authority", launch_state.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    let launch_preset = &ctx.accounts.launch_preset;
    let contribution = &mut ctx.accounts.contribution;

    require!(amount > 0 && amount % launch_preset.tau_lamports == 0, EngineErrorCode::BadAmount);

    let current_tickets = contribution.total_tickets();
    let current_deposit = checked_mul!(current_tickets, launch_preset.tau_lamports)?;
    let new_deposit = checked_add!(current_deposit, amount)?;
    let is_creator = ctx.accounts.contributor.key() == ctx.accounts.launch_state.creator;
    let cap = if is_creator { launch_preset.creator_max_deposit } else { launch_preset.per_wallet_cap };

    require!(new_deposit <= cap, EngineErrorCode::DepositCapExceeded);

    let new_tickets_count = checked_div!(amount, launch_preset.tau_lamports)?;
    let lottery_control = &mut ctx.accounts.lottery_control;

    let mut reused_ranges = {
        let inactive_info = ctx.accounts.inactive_bitmap.to_account_info();
        let winners_info = ctx.accounts.winners_bitmap.to_account_info();
        let mut inactive_data = inactive_info.try_borrow_mut_data()?;
        let winners_data = winners_info.try_borrow_data()?;

        let mut lottery = LotteryRaw::new(
            &mut **lottery_control,
            &winners_data[..],
            &mut inactive_data[..],
        );

        lottery.take_tickets(new_tickets_count)
    };
    let reused_count: u64 = reused_ranges.iter().map(|r| r.count()).sum();

    let remaining = checked_sub!(new_tickets_count, reused_count)?;
    if remaining > 0 {
        let bits_allocated = lottery_control.bits_allocated;
        let new_bits_allocated = bits_allocated
            .checked_add(remaining)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;
        lottery_control.bits_allocated = new_bits_allocated;
        reused_ranges.push(TicketRange::new(bits_allocated, checked_add!(bits_allocated, remaining)?));
    }

    let bits_allocated = lottery_control.bits_allocated;
    let required_bitmap_space = LotteryRaw::<&LotteryControl, &[u8], &[u8]>::required_bitmap_space(bits_allocated);

    realloc_raw(
        &ctx.accounts.winners_bitmap.to_account_info(),
        &ctx.accounts.realloc_funds.to_account_info(),
        required_bitmap_space,
    )?;
    realloc_raw(
        &ctx.accounts.inactive_bitmap.to_account_info(),
        &ctx.accounts.realloc_funds.to_account_info(),
        required_bitmap_space,
    )?;

    if is_creator {
        let winners_info = ctx.accounts.winners_bitmap.to_account_info();
        let inactive_info = ctx.accounts.inactive_bitmap.to_account_info();
        let mut winners_data = winners_info.try_borrow_mut_data()?;
        let inactive_data = inactive_info.try_borrow_data()?;

        let mut lottery = LotteryRaw::new(
            &mut **lottery_control,
            &mut winners_data[..],
            &inactive_data[..],
        );

        for range in &reused_ranges {
            lottery.set_range(range);
        }
    }

    for range in reused_ranges {
        contribution.ticket_ranges.push(range);
    }

    let ix = solana_program::system_instruction::transfer(
        &ctx.accounts.contributor.key(),
        &ctx.accounts.escrow_authority.key(),
        amount,
    );
    solana_program::program::invoke(
        &ix,
        &[
            ctx.accounts.contributor.to_account_info(),
            ctx.accounts.escrow_authority.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
    )?;

    emit!(DepositMade {
        launch: ctx.accounts.launch_state.key(),
        contributor: ctx.accounts.contributor.key(),
        amount,
    });

    Ok(())
}
