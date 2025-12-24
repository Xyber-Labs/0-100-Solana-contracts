use crate::{
    checked_mul, checked_sub,
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    events::TokensClaimed,
    state::{Contribution, LaunchPreset, LaunchState},
    utils::lottery::Lottery,
};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct ClaimTokens<'info> {
    #[account(mut)]
    pub contributor: Signer<'info>,

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
        seeds = [SEED_ROOT, b"contributor", launch_state.key().as_ref(), contributor.key().as_ref()],
        bump
    )]
    pub contribution: Account<'info, Contribution>,

    #[account(address = launch_state.base_mint.unwrap())]
    pub base_mint: Account<'info, Mint>,

    /// CHECK: PDA owning the escrow ATA for base_mint
    #[account(seeds = [SEED_ROOT, b"escrow_authority", launch_state.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = escrow_authority)]
    pub base_escrow_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = contributor_ata.mint == base_mint.key() @ EngineErrorCode::InvalidMint,
        constraint = contributor_ata.owner == contributor.key() @ EngineErrorCode::InvalidOwner
    )]
    pub contributor_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn claim_tokens(ctx: Context<ClaimTokens>) -> Result<()> {
    let launch_state = &ctx.accounts.launch_state;
    let launch_preset = &ctx.accounts.launch_preset;
    let lottery = &ctx.accounts.lottery;

    let per = launch_preset.tokens_per_ticket(lottery.active_tickets())?;

    let contribution = &mut ctx.accounts.contribution;

    let winning_tickets = lottery.count_winning_in_ranges(&contribution.ticket_ranges);
    let claimable = checked_sub!(winning_tickets, contribution.tickets_claimed)?;

    require!(claimable > 0, EngineErrorCode::AlreadyClaimedTokens);

    let amount_u128 = checked_mul!(per as u128, claimable as u128)?;
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
        to: ctx.accounts.contributor_ata.to_account_info(),
        authority: ctx.accounts.escrow_authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );
    token::transfer(cpi_ctx, amount)?;

    contribution.tickets_claimed = winning_tickets;

    emit!(TokensClaimed {
        launch: launch_state.key(),
        contributor: ctx.accounts.contributor.key(),
        amount,
        y_approved: winning_tickets,
    });

    Ok(())
}
