use crate::{
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    events::CreatorDepositChanged,
    state::{CreatorGrant, LaunchState},
};
use anchor_lang::{prelude::*, solana_program::sysvar::clock::Clock};

#[derive(Accounts)]
pub struct CreatorDeposit<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(mut, has_one = creator)]
    pub launch_state: Account<'info, LaunchState>,

    /// CHECK: Escrow authority PDA without data for SOL storage
    #[account(mut, seeds = [SEED_ROOT, b"escrow_authority", launch_state.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [SEED_ROOT, b"creator", launch_state.key().as_ref()],
        bump
    )]
    pub creator_grant: Account<'info, CreatorGrant>,

    pub system_program: Program<'info, System>,
}

pub fn creator_deposit(ctx: Context<CreatorDeposit>, amount: u64) -> Result<()> {
    require!(amount > 0, EngineErrorCode::Unauthorized);
    let now = Clock::get()?.unix_timestamp;
    let state = &mut ctx.accounts.launch_state;
    require!(now < state.funding_period_end, EngineErrorCode::FundingPeriodEnded);
    require!(amount % state.tau_lamports == 0, EngineErrorCode::InvalidCreatorDeposit);

    let grant = &mut ctx.accounts.creator_grant;
    let new_locked = grant
        .locked_lamports
        .checked_add(amount)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
    require!(new_locked <= state.creator_max_deposit, EngineErrorCode::Unauthorized);

    // Move lamports from creator to escrow authority PDA
    let ix = anchor_lang::solana_program::system_instruction::transfer(
        &ctx.accounts.creator.key(),
        &ctx.accounts.escrow_authority.key(),
        amount,
    );
    anchor_lang::solana_program::program::invoke(
        &ix,
        &[
            ctx.accounts.creator.to_account_info(),
            ctx.accounts.escrow_authority.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
    )?;

    grant.locked_lamports = new_locked;
    state.total_deposited = state
        .total_deposited
        .checked_add(amount)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;

    emit!(CreatorDepositChanged {
        launch: state.key(),
        creator: ctx.accounts.creator.key(),
        delta_lamports: amount as i64,
        new_locked_lamports: new_locked,
    });

    Ok(())
}


