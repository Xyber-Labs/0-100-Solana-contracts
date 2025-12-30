use anchor_lang::{prelude::*, solana_program};

use crate::{
    checked_add, checked_div, checked_mul, checked_sub,
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    events::DepositMade,
    state::{Contribution, LaunchPreset, LaunchState, TicketRange, WithdrawnRanges},
    utils::{lottery::LotteryRaw, realloc::realloc_raw},
};

const DISCRIMINATOR_LEN: usize = 8;

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

    /// CHECK: Raw lottery data, validated via seeds
    #[account(mut, seeds = [SEED_ROOT, b"lottery", launch_state.key().as_ref()], bump)]
    pub lottery: UncheckedAccount<'info>,

    #[account(mut, seeds = [SEED_ROOT, b"withdrawn", launch_state.key().as_ref()], bump)]
    pub withdrawn_ranges: Account<'info, WithdrawnRanges>,

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
    let launch_state = &mut ctx.accounts.launch_state;
    let launch_preset = &ctx.accounts.launch_preset;
    let contribution = &mut ctx.accounts.contribution;

    require!(amount > 0 && amount % launch_preset.tau_lamports == 0, EngineErrorCode::BadAmount);

    let current_tickets = contribution.total_tickets();
    let current_deposit = checked_mul!(current_tickets, launch_preset.tau_lamports)?;
    let new_deposit = checked_add!(current_deposit, amount)?;
    let is_creator = ctx.accounts.contributor.key() == launch_state.creator;
    let creator_cap = launch_preset.creator_max_deposit;
    let contributor_cap = launch_preset.per_wallet_cap;
    let cap = if is_creator { creator_cap } else { contributor_cap };

    require!(new_deposit <= cap, EngineErrorCode::DepositCapExceeded);

    let new_tickets_count = checked_div!(amount, launch_preset.tau_lamports)?;

    let withdrawn_ranges = &mut ctx.accounts.withdrawn_ranges;

    let mut reused_ranges = withdrawn_ranges.take_tickets(new_tickets_count);
    let reused_count: u64 = reused_ranges.iter().map(|r| r.count()).sum();

    let lottery_info = ctx.accounts.lottery.to_account_info();
    {
        let mut lottery_data = lottery_info.try_borrow_mut_data()?;
        let mut lottery = LotteryRaw::new(&mut lottery_data[DISCRIMINATOR_LEN..]);

        require!(lottery.is_in_progress(), EngineErrorCode::AlreadyFinalized);

        lottery.set_inactive(withdrawn_ranges.total_withdrawn());

        let remaining = checked_sub!(new_tickets_count, reused_count)?;
        if remaining > 0 {
            let bits_allocated = lottery.bits_allocated();
            let new_bits_allocated = bits_allocated.checked_add(remaining).ok_or(EngineErrorCode::ArithmeticOverflow)?;
            lottery.set_bits_allocated(new_bits_allocated);
            let new_vec_len = LotteryRaw::<&[u8]>::required_words(new_bits_allocated) as u32;
            lottery.set_vec_len(new_vec_len);
            reused_ranges.push(TicketRange::new(bits_allocated, checked_add!(bits_allocated, remaining)?));
        }
    }

    let bits_allocated = {
        let mut lottery_data = lottery_info.try_borrow_mut_data()?;
        LotteryRaw::new(&mut lottery_data[DISCRIMINATOR_LEN..]).bits_allocated()
    };
    let required_space = DISCRIMINATOR_LEN + LotteryRaw::<&[u8]>::required_space(bits_allocated);
    realloc_raw(&lottery_info, &ctx.accounts.realloc_funds.to_account_info(), required_space)?;

    if is_creator {
        let mut lottery_data = lottery_info.try_borrow_mut_data()?;
        let mut lottery = LotteryRaw::new(&mut lottery_data[DISCRIMINATOR_LEN..]);
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
        launch: launch_state.key(),
        contributor: ctx.accounts.contributor.key(),
        amount,
    });

    Ok(())
}
