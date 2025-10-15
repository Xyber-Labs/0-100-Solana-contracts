use crate::constants::SEED_ROOT;
use crate::errors::ErrorCode as EngineErrorCode;
use crate::events::CreatorClaimed;
use crate::state::{CreatorGrant, LaunchState};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};

#[derive(Accounts)]
pub struct ClaimCreatorTokens<'info> {
    #[account(mut, address = launch_state.creator)]
    pub creator: Signer<'info>,

    pub launch_state: Account<'info, LaunchState>,

    #[account(
        mut,
        seeds = [SEED_ROOT, b"creator", launch_state.key().as_ref()],
        bump,
    )]
    pub creator_grant: Account<'info, CreatorGrant>,

    #[account(mut)]
    pub sale_mint: Account<'info, Mint>,

    /// CHECK: PDA mint authority
    #[account(seeds = [SEED_ROOT, b"mint_auth", launch_state.key().as_ref()], bump)]
    pub mint_auth: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = creator_ata.mint == sale_mint.key() @ EngineErrorCode::InvalidMint,
        constraint = creator_ata.owner == creator.key() @ EngineErrorCode::InvalidOwner,
    )]
    pub creator_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn claim_creator_tokens(ctx: Context<ClaimCreatorTokens>) -> Result<()> {
    let launch_state = &ctx.accounts.launch_state;
    require!(
        ctx.accounts.sale_mint.key() == launch_state.sale_mint,
        EngineErrorCode::Unauthorized
    );
    require!(launch_state.claims_open, EngineErrorCode::ClaimsNotOpen);

    let per = launch_state
        .tokens_per_ticket
        .ok_or(EngineErrorCode::TokensPerTicketMissing)?;
    let creator_grant = &mut ctx.accounts.creator_grant;

    // Calculate how many tokens have vested/accrued over time.
    let now = Clock::get()?.unix_timestamp;
    let start = launch_state.claims_opened_at.unwrap_or(now);

    // How many full periods have passed since claiming opened.
    let periods_passed = (now - start).div_euclid(launch_state.creator_claim_lock_period_sec);

    // Calculate the ceiling of claimable tickets based on periods passed.
    // We add 1 to include the current, partially-elapsed period.
    let unlocked_ceiling = (periods_passed as u32)
        .saturating_add(1)
        .saturating_mul(creator_grant.daily_ticket_cap);

    // The total unlocked amount cannot exceed the total reserved tickets.
    let total_unlocked = unlocked_ceiling.min(creator_grant.reserved_tickets);

    // The amount to claim now is the difference between what's unlocked and what's already been claimed.
    let to_claim = total_unlocked
        .checked_sub(creator_grant.claimed_tickets)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;

    // If there's nothing to claim, exit.
    require!(to_claim > 0, EngineErrorCode::NothingToClaim);

    let amount = (per as u128)
        .checked_mul(to_claim as u128)
        .and_then(|val| val.checked_div(1_000_000))
        .ok_or(EngineErrorCode::ArithmeticOverflow)? as u64;
    
    // Debug logging
    msg!("DEBUG: Creator claim - per={}, to_claim={}, amount={}", per, to_claim, amount);

    // Mint tokens
    let seeds: &[&[u8]] = &[
        SEED_ROOT,
        b"mint_auth",
        &launch_state.key().to_bytes(),
        &[launch_state.mint_auth_bump()],
    ];
    let signer_seeds = &[seeds];
    let cpi_accounts = MintTo {
        mint: ctx.accounts.sale_mint.to_account_info(),
        to: ctx.accounts.creator_ata.to_account_info(),
        authority: ctx.accounts.mint_auth.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );
    token::mint_to(cpi_ctx, amount)?;

    creator_grant.claimed_tickets = creator_grant
        .claimed_tickets
        .checked_add(to_claim)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;

    emit!(CreatorClaimed {
        launch: launch_state.key(),
        creator: ctx.accounts.creator.key(),
        tickets_claimed: to_claim,
        lamports_equiv: (to_claim as u64)
            .checked_mul(launch_state.tau_lamports)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?,
        tokens_minted: amount,
        day_index: periods_passed, // Using periods_passed for logging
        remaining_tickets: creator_grant.reserved_tickets - creator_grant.claimed_tickets,
    });

    Ok(())
}
