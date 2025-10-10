use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};
use crate::errors::ErrorCode as EngineErrorCode;
use crate::events::CreatorClaimed;
use crate::state::{LaunchState, CreatorGrant};
use crate::constants::SEED_ROOT;

#[derive(Accounts)]
pub struct ClaimCreatorTokens<'info> {
    #[account(mut, address = launch_state.creator)]
    pub creator: Signer<'info>,

    #[account(mut)]
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

pub fn handler(ctx: Context<ClaimCreatorTokens>) -> Result<()> {
    let st = &mut ctx.accounts.launch_state;
    require!(st.claims_open, EngineErrorCode::ClaimsNotOpen);

    let per = st.tokens_per_ticket.ok_or(EngineErrorCode::TokensPerTicketMissing)?;
    let cg = &mut ctx.accounts.creator_grant;

    // Day calculation: count days from claims opening
    let now = Clock::get()?.unix_timestamp;
    let start = st.claims_opened_at.unwrap_or(now);
    let day = (now - start).div_euclid(86_400);

    if cg.last_claim_day != day {
        cg.last_claim_day = day;
        cg.claimed_today_tickets = 0;
    }

    let remaining = cg.reserved_tickets.saturating_sub(cg.claimed_tickets);
    let daily_left = cg.daily_ticket_cap.saturating_sub(cg.claimed_today_tickets);
    let to_claim = remaining.min(daily_left);
    require!(to_claim > 0, EngineErrorCode::DailyCapReached);

    let amount = per.checked_mul(to_claim as u64).ok_or(EngineErrorCode::ArithmeticOverflow)?;

    // Mint tokens
    let seeds: &[&[u8]] = &[
        SEED_ROOT,
        b"mint_auth",
        &st.key().to_bytes(),
        &[st.mint_auth_bump()],
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

    cg.claimed_tickets = cg.claimed_tickets.checked_add(to_claim).ok_or(EngineErrorCode::ArithmeticOverflow)?;
    cg.claimed_today_tickets = cg.claimed_today_tickets.checked_add(to_claim).ok_or(EngineErrorCode::ArithmeticOverflow)?;

    emit!(CreatorClaimed {
        launch: st.key(),
        creator: ctx.accounts.creator.key(),
        tickets_claimed: to_claim,
        lamports_equiv: (to_claim as u64).checked_mul(st.tau_lamports).ok_or(EngineErrorCode::ArithmeticOverflow)?,
        tokens_minted: amount,
        day_index: day,
        remaining_tickets: cg.reserved_tickets - cg.claimed_tickets,
    });

    Ok(())
}
