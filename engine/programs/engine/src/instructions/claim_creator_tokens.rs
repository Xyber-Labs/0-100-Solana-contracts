use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::{
    checked_div, checked_mul, checked_sub,
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    events::CreatorClaimed,
    state::{Contribution, LaunchPreset, LaunchState},
    utils::lottery::Lottery,
};

#[derive(Accounts)]
pub struct ClaimCreatorTokens<'info> {
    #[account(mut, address = launch_state.creator)]
    pub creator: Signer<'info>,

    pub launch_state: Account<'info, LaunchState>,

    #[account(address = launch_state.preset @ EngineErrorCode::MalformedPreset)]
    pub launch_preset: Account<'info, LaunchPreset>,

    #[account(
        seeds = [SEED_ROOT, b"lottery", launch_state.key().as_ref()],
        bump,
        constraint = lottery.is_finalized() @ EngineErrorCode::NotFinalized
    )]
    pub lottery: Account<'info, Lottery>,

    #[account(
        mut,
        seeds = [SEED_ROOT, b"contributor", launch_state.key().as_ref(), creator.key().as_ref()],
        bump
    )]
    pub contribution: Account<'info, Contribution>,

    #[account(address = launch_state.base_mint.expect("Expected base_mint"))]
    pub base_mint: Account<'info, Mint>,

    /// CHECK: PDA owning the escrow ATA for base_mint
    #[account(seeds = [SEED_ROOT, b"escrow_authority", launch_state.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = escrow_authority)]
    pub base_escrow_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = creator_ata.mint == base_mint.key() @ EngineErrorCode::InvalidMint,
        constraint = creator_ata.owner == creator.key() @ EngineErrorCode::InvalidOwner
    )]
    pub creator_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn claim_creator_tokens(ctx: Context<ClaimCreatorTokens>) -> Result<()> {
    let launch_state = &ctx.accounts.launch_state;
    let launch_preset = &ctx.accounts.launch_preset;
    let lottery = &ctx.accounts.lottery;
    let contribution = &mut ctx.accounts.contribution;

    let now = Clock::get()?.unix_timestamp;
    let start = launch_state.claims_opened_at.unwrap_or(now);
    let periods_passed = (now - start).div_euclid(launch_preset.creator_claim_lock_period_sec);

    let daily_ticket_cap =
        checked_div!(launch_preset.creator_daily_lamports_limit, launch_preset.tau_lamports)?;

    let unlocked_ceiling =
        (periods_passed as u64).saturating_add(1).saturating_mul(daily_ticket_cap);

    let winning_tickets = lottery.count_winning_in_ranges(&contribution.ticket_ranges);
    let total_unlocked = unlocked_ceiling.min(winning_tickets);
    let to_claim = checked_sub!(total_unlocked, contribution.tickets_claimed)?;

    require!(to_claim > 0, EngineErrorCode::NothingToClaim);

    let per = launch_preset.tokens_per_ticket(lottery.active_tickets())?;
    let amount_u128 = checked_mul!(per as u128, to_claim as u128)?;
    require!(amount_u128 <= u64::MAX as u128, EngineErrorCode::U64ConversionOverflow);
    let amount = amount_u128 as u64;

    let seeds: &[&[u8]] = &[
        SEED_ROOT,
        b"escrow_authority",
        &launch_state.key().to_bytes(),
        &[ctx.bumps.escrow_authority],
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
    token::transfer(cpi_ctx, amount)?;

    contribution.tickets_claimed = total_unlocked;

    emit!(CreatorClaimed {
        launch: launch_state.key(),
        creator: ctx.accounts.creator.key(),
        tickets_claimed: to_claim,
        lamports_equiv: checked_mul!(to_claim, launch_preset.tau_lamports)?,
        tokens_minted: amount,
        day_index: periods_passed,
        remaining_tickets: winning_tickets.saturating_sub(contribution.tickets_claimed),
    });

    Ok(())
}
