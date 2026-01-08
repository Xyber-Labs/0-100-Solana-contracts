use anchor_lang::{prelude::*, solana_program};

use crate::{
    checked_add, checked_div, checked_mul, checked_sub,
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    state::{Contribution, LaunchPreset, LaunchState, TicketRange},
    utils::{
        lottery::{LotteryControl, LotteryRaw},
        realloc::{realloc_raw, Reallocatable},
    },
};

#[event]
pub struct Deposited {
    pub launch: Pubkey,
    pub contributor: Pubkey,
    pub lamports: u64,
}

#[derive(Accounts)]
#[instruction(lamports: u64)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub contributor: Signer<'info>,

    #[account(mut, constraint = launch_state.is_funding_active(launch_preset.funding_duration_seconds, clock.unix_timestamp) @ EngineErrorCode::FundingInactive)]
    pub launch_state: Account<'info, LaunchState>,

    #[account(
        address = launch_state.preset @ EngineErrorCode::MalformedPreset,
        constraint = lamports > 0 && lamports % launch_preset.tau_lamports == 0 @ EngineErrorCode::BadAmount
    )]
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

    /// CHECK: Initialized manually, validated via seeds
    #[account(
        mut,
        seeds = [SEED_ROOT, b"contributor", launch_state.key().as_ref(), contributor.key().as_ref()],
        bump
    )]
    pub contribution: UncheckedAccount<'info>,

    /// CHECK: Escrow authority PDA without data for SOL storage
    #[account(mut, seeds = [SEED_ROOT, b"escrow_authority", launch_state.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,

    pub clock: Sysvar<'info, Clock>,
    pub system_program: Program<'info, System>,
}

pub fn deposit(ctx: Context<Deposit>, lamports: u64) -> Result<()> {
    let launch_preset = &ctx.accounts.launch_preset;
    let contribution_info = ctx.accounts.contribution.to_account_info();
    let launch_key = ctx.accounts.launch_state.key();
    let contributor_key = ctx.accounts.contributor.key();

    let mut contribution = if contribution_info.data_is_empty() {
        let initial_space = 8 + Contribution::INIT_SPACE;
        let rent = Rent::get()?;
        let lamports = rent.minimum_balance(initial_space);

        let signer_seeds: &[&[&[u8]]] = &[&[
            SEED_ROOT,
            b"contributor",
            launch_key.as_ref(),
            contributor_key.as_ref(),
            &[ctx.bumps.contribution],
        ]];

        solana_program::program::invoke_signed(
            &solana_program::system_instruction::create_account(
                &contributor_key,
                &contribution_info.key(),
                lamports,
                initial_space as u64,
                ctx.program_id,
            ),
            &[
                ctx.accounts.contributor.to_account_info(),
                contribution_info.clone(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer_seeds,
        )?;

        let mut data = contribution_info.try_borrow_mut_data()?;
        data[..8].copy_from_slice(Contribution::DISCRIMINATOR);
        drop(data);

        Contribution::default()
    } else {
        let data = contribution_info.try_borrow_data()?;
        require!(
            data[..8] == *Contribution::DISCRIMINATOR,
            EngineErrorCode::InvalidAccountDiscriminator
        );
        Contribution::try_deserialize(&mut &data[..])?
    };

    let current_tickets = contribution.total_tickets();
    let current_deposit = checked_mul!(current_tickets, launch_preset.tau_lamports)?;
    let new_deposit = checked_add!(current_deposit, lamports)?;
    let is_creator = contributor_key == ctx.accounts.launch_state.creator;
    let cap =
        if is_creator { launch_preset.creator_max_deposit } else { launch_preset.per_wallet_cap };

    require!(new_deposit <= cap, EngineErrorCode::DepositCapExceeded);

    let lottery_control = &mut ctx.accounts.lottery_control;
    let winners_info = ctx.accounts.winners_bitmap.to_account_info();
    let inactive_info = ctx.accounts.inactive_bitmap.to_account_info();

    let (mut reused_ranges, remaining, future_bits_allocated) = {
        let mut winners_data = winners_info.try_borrow_mut_data()?;
        let mut inactive_data = inactive_info.try_borrow_mut_data()?;
        let mut lottery =
            LotteryRaw::new(&mut **lottery_control, &mut winners_data[..], &mut inactive_data[..]);

        let new_tickets_count = checked_div!(lamports, launch_preset.tau_lamports)?;
        let reused = lottery.take_tickets(new_tickets_count);
        let reused_count = reused.iter().try_fold(0u64, |acc, r| checked_add!(acc, r.count()))?;
        let remaining = checked_sub!(new_tickets_count, reused_count)?;
        let future_bits = checked_add!(lottery.bits_allocated(), remaining)?;
        (reused, remaining, future_bits)
    };

    let required_bitmap_space =
        LotteryRaw::<&LotteryControl, &[u8], &[u8]>::required_bitmap_space(future_bits_allocated);

    realloc_raw(
        &winners_info,
        &ctx.accounts.realloc_funds.to_account_info(),
        required_bitmap_space,
    )?;
    realloc_raw(
        &inactive_info,
        &ctx.accounts.realloc_funds.to_account_info(),
        required_bitmap_space,
    )?;

    let new_ranges: Vec<TicketRange> = {
        let mut winners_data = winners_info.try_borrow_mut_data()?;
        let mut lottery =
            LotteryRaw::new(&mut **lottery_control, &mut winners_data[..], &[] as &[u8]);

        if remaining > 0 {
            reused_ranges.push(lottery.allocate_tickets(remaining));
        }

        for range in &reused_ranges {
            lottery.set_range(*range, is_creator);
        }
        reused_ranges
    };

    for range in new_ranges {
        contribution.ticket_ranges.push(range);
    }

    let required_contribution_space = 8 + contribution.required_space();
    let current_space = contribution_info.data_len();
    if required_contribution_space > current_space {
        let rent = Rent::get()?;
        let new_min_balance = rent.minimum_balance(required_contribution_space);
        let current_lamports = contribution_info.lamports();
        let diff = new_min_balance
            .checked_sub(current_lamports)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;

        solana_program::program::invoke(
            &solana_program::system_instruction::transfer(
                &contributor_key,
                &contribution_info.key(),
                diff,
            ),
            &[
                ctx.accounts.contributor.to_account_info(),
                contribution_info.clone(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        contribution_info.realloc(required_contribution_space, true)?;
    }

    {
        let mut data = contribution_info.try_borrow_mut_data()?;
        contribution.try_serialize(&mut &mut data[..])?;
    }

    solana_program::program::invoke(
        &solana_program::system_instruction::transfer(
            &contributor_key,
            &ctx.accounts.escrow_authority.key(),
            lamports,
        ),
        &[
            ctx.accounts.contributor.to_account_info(),
            ctx.accounts.escrow_authority.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
    )?;

    emit!(Deposited {
        launch: launch_key,
        contributor: contributor_key,
        lamports,
    });

    Ok(())
}
