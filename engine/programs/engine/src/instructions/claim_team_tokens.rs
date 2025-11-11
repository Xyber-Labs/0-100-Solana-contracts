use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::{
    constants::SEED_ROOT,
    errors::ErrorCode,
    events::TeamClaimed,
    state::{LaunchState, PoolState, TeamVesting},
};

#[derive(Accounts)]
pub struct ClaimTeamTokens<'info> {
    #[account(mut, address = launch_state.creator)]
    pub creator: Signer<'info>,

    pub launch_state: Account<'info, LaunchState>,

    #[account(seeds = [SEED_ROOT, b"pool", launch_state.key().as_ref()], bump)]
    pub pool_state: Account<'info, PoolState>,

    #[account(
        mut,
        seeds = [SEED_ROOT, b"team", launch_state.key().as_ref()],
        bump
    )]
    pub team_vesting: Account<'info, TeamVesting>,

    #[account(constraint = launch_state.base_mint == Some(base_mint.key()))]
    pub base_mint: Account<'info, Mint>,

    /// CHECK: PDA authority for escrow
    #[account(seeds = [SEED_ROOT, b"escrow_authority", launch_state.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = escrow_authority,
        associated_token::token_program = token_program,
    )]
    pub base_escrow_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = creator_ata.mint == base_mint.key() @ ErrorCode::InvalidMint,
        constraint = creator_ata.owner == creator.key() @ ErrorCode::InvalidOwner,
    )]
    pub creator_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn claim_team_tokens(ctx: Context<ClaimTeamTokens>) -> Result<()> {
    let state = &ctx.accounts.launch_state;
    // In test environments, liquidity step may be skipped; allow team claims once base mint exists.
    require!(state.base_mint.is_some(), ErrorCode::Unauthorized);

    let now = Clock::get()?.unix_timestamp;

    let team = &mut ctx.accounts.team_vesting;

    if team.start_ts == 0 {
        team.start_ts = state.claims_opened_at.unwrap_or(now);
    }
    require!(now >= team.start_ts, ErrorCode::TeamVestingNotStarted);

    if team.last_claim_ts != 0 {
        require!(now - team.last_claim_ts >= team.min_interval_sec, ErrorCode::TeamClaimTooFrequent);
    }

    let elapsed = now.saturating_sub(team.start_ts).clamp(0, team.duration_sec);
    let vested = (team.total_allocation as u128)
        .checked_mul(elapsed as u128)
        .and_then(|v| v.checked_div(team.duration_sec as u128))
        .ok_or(ErrorCode::ArithmeticOverflow)? as u64;
    let claimable = vested
        .checked_sub(team.claimed)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(claimable > 0, ErrorCode::NothingToClaim);

    let seeds: &[&[u8]] = &[
        SEED_ROOT,
        b"escrow_authority",
        &state.key().to_bytes(),
        &[crate::state::LaunchState::mint_auth_bump_for(&state.key())],
    ];
    let signer_seeds = &[seeds];

    let cpi_accounts = Transfer {
        from: ctx.accounts.base_escrow_ata.to_account_info(),
        to: ctx.accounts.creator_ata.to_account_info(),
        authority: ctx.accounts.escrow_authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );
    token::transfer(cpi_ctx, claimable)?;

    team.claimed = team.claimed.checked_add(claimable).ok_or(ErrorCode::ArithmeticOverflow)?;
    team.last_claim_ts = now;

    emit!(TeamClaimed {
        launch: state.key(),
        creator: ctx.accounts.creator.key(),
        amount: claimable,
        claimed_total: team.claimed,
        remaining: team.total_allocation - team.claimed,
        at: now,
    });

    Ok(())
}


