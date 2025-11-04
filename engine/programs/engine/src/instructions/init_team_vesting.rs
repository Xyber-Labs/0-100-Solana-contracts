use anchor_lang::prelude::*;

use crate::{
    constants::{SEED_ROOT, TEAM_BASIS_POINTS, TEAM_CLAIM_MIN_INTERVAL_SEC, TEAM_VESTING_DURATION_SEC},
    errors::ErrorCode,
    events::TeamVestingInitialized,
    state::{LaunchState, TeamVesting},
};

#[derive(Accounts)]
pub struct InitTeamVesting<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
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

    require!(
        state.base_sale_basis_points <= 10_000u64.saturating_sub(TEAM_BASIS_POINTS),
        ErrorCode::InvalidShareSum
    );

    let total_alloc = state
        .base_total_allocation
        .checked_mul(TEAM_BASIS_POINTS)
        .and_then(|v| v.checked_div(10_000))
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let team = &mut ctx.accounts.team_vesting;
    team.launch = state.key();
    team.creator = state.creator;
    team.total_allocation = total_alloc;
    team.claimed = 0;
    team.start_ts = 0;
    team.duration_sec = TEAM_VESTING_DURATION_SEC;
    team.min_interval_sec = TEAM_CLAIM_MIN_INTERVAL_SEC;
    team.last_claim_ts = 0;

    emit!(TeamVestingInitialized {
        launch: state.key(),
        total_allocation: total_alloc,
        duration_sec: team.duration_sec,
    });

    Ok(())
}


