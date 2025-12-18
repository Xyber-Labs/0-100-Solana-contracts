use anchor_lang::{prelude::*, solana_program};
use solana_program::sysvar::rent::Rent;

use crate::{
    checked_add, checked_div, checked_mul, checked_sub,
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    events::DepositMade,
    state::{LaunchPreset, LaunchState, TicketRange, UserContribution},
    utils::bitmap::TicketBitmap,
};

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub launch_preset: Account<'info, LaunchPreset>,

    #[account(mut, constraint = launch_state.is_funding_active() @ EngineErrorCode::FundingInactive)]
    pub launch_state: Account<'info, LaunchState>,

    /// CHECK: Platform account for paying bitmap reallocation
    #[account(mut, seeds = [SEED_ROOT, b"realloc_funds"], bump)]
    pub realloc_funds: UncheckedAccount<'info>,

    #[account(mut, seeds = [SEED_ROOT, b"bitmap", launch_state.key().as_ref()], bump)]
    pub launch_bitmap: Account<'info, TicketBitmap>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserContribution::INIT_SPACE,
        seeds = [SEED_ROOT, b"user", launch_state.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_contribution: Account<'info, UserContribution>,

    /// CHECK: Escrow authority PDA without data for SOL storage
    #[account(mut, seeds = [SEED_ROOT, b"escrow_authority", launch_state.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    let launch_state = &mut ctx.accounts.launch_state;
    let launch_preset = &ctx.accounts.launch_preset;
    let contribution = &mut ctx.accounts.user_contribution;

    require!(amount > 0 && amount % launch_state.tau_lamports == 0, EngineErrorCode::BadAmount);

    let current_tickets = contribution.total_tickets();
    let current_deposit = checked_mul!(current_tickets as u64, launch_state.tau_lamports)?;
    let new_deposit = checked_add!(current_deposit, amount)?;
    let is_creator = ctx.accounts.user.key() == launch_state.creator;
    let creator_cap = launch_preset.creator_max_deposit;
    let user_cap = launch_preset.per_wallet_cap;
    let cap = if is_creator { creator_cap } else { user_cap };

    require!(new_deposit <= cap, EngineErrorCode::DepositCapExceeded);

    let new_tickets_count = checked_div!(amount, launch_state.tau_lamports)?;
    require!(new_tickets_count <= u32::MAX as u64, EngineErrorCode::U64ConversionOverflow);
    let new_tickets_count = new_tickets_count as u32;

    let bitmap_info = ctx.accounts.launch_bitmap.to_account_info();
    let launch_bitmap = &mut ctx.accounts.launch_bitmap;

    let start = launch_bitmap
        .allocate(new_tickets_count, is_creator)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;

    let required_space = launch_bitmap.required_space();
    let current_space = bitmap_info.data_len();

    if required_space > current_space {
        bitmap_info.realloc(required_space, false)?;

        let rent = Rent::get()?;
        let new_min_balance = rent.minimum_balance(required_space);
        let current_lamports = bitmap_info.lamports();
        let diff = checked_sub!(new_min_balance, current_lamports)?;

        **ctx.accounts.realloc_funds.try_borrow_mut_lamports()? = ctx
            .accounts
            .realloc_funds
            .lamports()
            .checked_sub(diff)
            .ok_or(EngineErrorCode::InsufficientFeeBalance)?;
        **bitmap_info.try_borrow_mut_lamports()? = checked_add!(current_lamports, diff)?;
    }

    contribution.ticket_ranges.push(TicketRange::new(start, new_tickets_count));

    let ix = solana_program::system_instruction::transfer(
        &ctx.accounts.user.key(),
        &ctx.accounts.escrow_authority.key(),
        amount,
    );
    solana_program::program::invoke(
        &ix,
        &[
            ctx.accounts.user.to_account_info(),
            ctx.accounts.escrow_authority.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
    )?;

    launch_state.total_deposited = checked_add!(launch_state.total_deposited, amount)?;
    launch_state.total_tickets = launch_bitmap.bits_allocated;

    emit!(DepositMade {
        launch: launch_state.key(),
        user: ctx.accounts.user.key(),
        amount,
    });

    Ok(())
}
