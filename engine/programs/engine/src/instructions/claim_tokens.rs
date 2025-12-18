use crate::{
    checked_mul, checked_sub,
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    events::TokensClaimed,
    state::{LaunchState, PoolState, UserContribution},
    utils::{bitmap::TicketBitmap, lottery::count_winning_in_ranges},
};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct ClaimTokens<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    pub launch_state: Account<'info, LaunchState>,
    #[account(seeds = [SEED_ROOT, b"bitmap", launch_state.key().as_ref()], bump)]
    pub launch_bitmap: Account<'info, TicketBitmap>,
    #[account(mut, seeds = [SEED_ROOT, b"user", launch_state.key().as_ref(), user.key().as_ref()], bump)]
    pub user_contribution: Account<'info, UserContribution>,

    #[account(seeds = [SEED_ROOT, b"pool", launch_state.key().as_ref()],bump)]
    pub pool_state: Account<'info, PoolState>,

    #[account(address = launch_state.base_mint.unwrap())]
    pub base_mint: Account<'info, Mint>,

    /// CHECK: PDA owning the escrow ATA for base_mint
    #[account(seeds = [SEED_ROOT, b"escrow_authority", launch_state.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = escrow_authority,
    )]
    pub base_escrow_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_ata.mint == base_mint.key() @ EngineErrorCode::InvalidMint,
        constraint = user_ata.owner == user.key() @ EngineErrorCode::InvalidOwner,
    )]
    pub user_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn claim_tokens(ctx: Context<ClaimTokens>) -> Result<()> {
    let launch_state = &ctx.accounts.launch_state;
    let bitmap = &ctx.accounts.launch_bitmap;

    require!(launch_state.base_mint.is_some(), EngineErrorCode::Unauthorized);
    require!(
        ctx.accounts.base_mint.key() == launch_state.base_mint.unwrap(),
        EngineErrorCode::Unauthorized
    );
    require!(ctx.accounts.pool_state.claims_ready, EngineErrorCode::PoolNotCreated);
    let per = launch_state.tokens_per_ticket.ok_or(EngineErrorCode::TokensPerTicketMissing)?;

    require!(
        launch_state.total_deposited >= launch_state.min_raise_lamports,
        EngineErrorCode::MinRaiseNotMet
    );

    let user = &mut ctx.accounts.user_contribution;

    let winning_tickets = count_winning_in_ranges(bitmap, &user.ticket_ranges);
    let claimable = checked_sub!(winning_tickets, user.tickets_claimed)?;

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
        to: ctx.accounts.user_ata.to_account_info(),
        authority: ctx.accounts.escrow_authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );
    token::transfer(cpi_ctx, amount)?;

    user.tickets_claimed = winning_tickets;

    emit!(TokensClaimed {
        launch: launch_state.key(),
        user: ctx.accounts.user.key(),
        amount,
        y_approved: winning_tickets,
    });

    Ok(())
}
