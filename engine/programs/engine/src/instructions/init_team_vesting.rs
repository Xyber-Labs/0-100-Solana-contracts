use anchor_lang::prelude::*;

use crate::{
    constants::{
        SEED_ROOT, TEAM_BASIS_POINTS, TEAM_CLAIM_MIN_INTERVAL_SEC, TEAM_VESTING_DURATION_SEC,
    },
    errors::ErrorCode,
    events::TeamVestingInitialized,
    state::{LaunchState, TeamVesting},
};

#[derive(Accounts)]
pub struct InitTeamVesting<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        constraint = launch_state.to_account_info().owner == &crate::ID @ ErrorCode::InvalidAuthority
    )]
    pub launch_state: Account<'info, LaunchState>,

    #[account(
        init,
        payer = payer,
        space = 8 + TeamVesting::INIT_SPACE,
        seeds = [SEED_ROOT, b"team", launch_state.key().as_ref()],
        bump
    )]
    pub team_vesting: Account<'info, TeamVesting>,

    pub system_program: Program<'info, System>,
}

pub fn init_team_vesting(ctx: Context<InitTeamVesting>) -> Result<()> {
    let state = &ctx.accounts.launch_state;

    let team_bps = if state.team_allocation_basis_points > 0 {
        state.team_allocation_basis_points
    } else {
        TEAM_BASIS_POINTS
    };
    require!(
        state.base_sale_basis_points <= 10_000u64.saturating_sub(team_bps),
        ErrorCode::InvalidShareSum
    );

    // Compute in u128 to avoid overflow, then downcast to u64
    let total_alloc_u128 = (state.base_total_allocation as u128)
        .checked_mul(team_bps as u128)
        .and_then(|v| v.checked_div(10_000u128))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(total_alloc_u128 <= u64::MAX as u128, ErrorCode::U64ConversionOverflow);
    let total_alloc = total_alloc_u128 as u64;

    let team = &mut ctx.accounts.team_vesting;
    team.launch = state.key();
    team.creator = state.creator;
    team.total_allocation = total_alloc;
    team.claimed = 0;
    // Start vesting now (or from claims_opened_at if present)
    let now = Clock::get()?.unix_timestamp;
    team.start_ts = state.claims_opened_at.unwrap_or(now);
    let duration = if state.team_vesting_duration_sec > 0 {
        state.team_vesting_duration_sec
    } else if state.team_allocation_basis_points == 0 {
        1
    } else {
        TEAM_VESTING_DURATION_SEC
    };
    team.duration_sec = duration;
    team.min_interval_sec = TEAM_CLAIM_MIN_INTERVAL_SEC;
    team.last_claim_ts = 0;

    emit!(TeamVestingInitialized {
        launch: state.key(),
        total_allocation: total_alloc,
        duration_sec: team.duration_sec,
    });

    Ok(())
}
