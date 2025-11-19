use anchor_lang::{prelude::*, solana_program::sysvar::clock::Clock};

use crate::{
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    events::CreatorDepositChanged,
    state::{CreatorGrant, LaunchState},
};

#[derive(Accounts)]
pub struct CreatorWithdraw<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        has_one = creator,
        constraint = launch_state.to_account_info().owner == &crate::ID @ crate::errors::ErrorCode::InvalidAuthority
    )]
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

pub fn creator_withdraw(ctx: Context<CreatorWithdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, EngineErrorCode::Unauthorized);
    let now = Clock::get()?.unix_timestamp;
    let state = &mut ctx.accounts.launch_state;
    require!(now >= state.funding_period_start, EngineErrorCode::FundingPeriodNotStarted);
    require!(now < state.funding_period_end, EngineErrorCode::FundingPeriodEnded);
    require!(amount % state.tau_lamports == 0, EngineErrorCode::InvalidCreatorDeposit);

    let grant = &mut ctx.accounts.creator_grant;
    require!(grant.locked_lamports >= amount, EngineErrorCode::InsufficientDeposit);

    let launch_key = state.key();
    let signer_seeds: &[&[u8]] = &[
        SEED_ROOT,
        b"escrow_authority",
        launch_key.as_ref(),
        &[ctx.bumps.escrow_authority],
    ];

    anchor_lang::system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.escrow_authority.to_account_info(),
                to: ctx.accounts.creator.to_account_info(),
            },
            &[signer_seeds],
        ),
        amount,
    )?;

    grant.locked_lamports =
        grant.locked_lamports.checked_sub(amount).ok_or(EngineErrorCode::ArithmeticOverflow)?;
    state.total_deposited =
        state.total_deposited.checked_sub(amount).ok_or(EngineErrorCode::ArithmeticOverflow)?;

    emit!(CreatorDepositChanged {
        launch: state.key(),
        creator: ctx.accounts.creator.key(),
        delta_lamports: -(amount as i64),
        new_locked_lamports: grant.locked_lamports,
    });

    Ok(())
}
