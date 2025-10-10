use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};
use crate::errors::ErrorCode as EngineErrorCode;
use crate::events::TokensClaimed;
use crate::utils::selection::{ticket_score, tie_break_wins};
use crate::state::{LaunchState, SelectionState, UserContribution};
use crate::constants::SEED_ROOT;

#[derive(Accounts)]
pub struct ClaimTokens<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,
    #[account(mut, seeds = [SEED_ROOT, b"user", launch_state.key().as_ref(), user.key().as_ref()], bump)]
    pub user_contribution: Account<'info, UserContribution>,
    #[account(mut, constraint = selection_state.launch == launch_state.key())]
    pub selection_state: Account<'info, SelectionState>,

    #[account(mut)]
    pub sale_mint: Account<'info, Mint>,
    /// CHECK: mint authority PDA
    /// Seeds: ["mint_auth", launch_state]
    #[account(seeds = [SEED_ROOT, b"mint_auth", launch_state.key().as_ref()], bump)]
    pub mint_auth: UncheckedAccount<'info>,

    #[account(mut)]
    pub user_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ClaimTokens>) -> Result<()> {
    let st = &mut ctx.accounts.launch_state;
    require!(st.claims_open, EngineErrorCode::ClaimsNotOpen);
    let per = st
        .tokens_per_ticket
        .ok_or(EngineErrorCode::TokensPerTicketMissing)?;

    // Tokens are claimed only if the raise was successful
    require!(
        st.total_deposited >= st.min_raise_lamports,
        EngineErrorCode::MinRaiseNotMet
    );

    let threshold = st
        .threshold_score
        .ok_or(EngineErrorCode::ThresholdMissing)?;
    let seed = st.vrf_seed.ok_or(EngineErrorCode::SeedMissing)?;

    let user = &mut ctx.accounts.user_contribution;
    require!(!user.claimed_tokens, EngineErrorCode::AlreadyClaimedTokens);

    // recompute y_i
    let mut y = 0u32;
    for j in 0..user.ticket_count {
        let s = ticket_score(&seed, &user.wallet, j);
        if s < threshold
            || (s == threshold
                && tie_break_wins(
                    user.wallet,
                    j,
                    threshold,
                    &ctx.accounts.selection_state.heap,
                ))
        {
            y = y
                .checked_add(1)
                .ok_or(EngineErrorCode::ArithmeticOverflow)?;
        }
    }
    if y == 0 {
        user.claimed_tokens = true;
        return Ok(());
    }
    let amount = per
        .checked_mul(y as u64)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;

    // Mint from sale_mint; mint authority is PDA [mint_auth, launch_state]
    let seeds: &[&[u8]] = &[
        SEED_ROOT,
        b"mint_auth",
        &st.key().to_bytes(),
        &[st.mint_auth_bump()],
    ];
    let signer_seeds = &[seeds];
    let cpi_accounts = MintTo {
        mint: ctx.accounts.sale_mint.to_account_info(),
        to: ctx.accounts.user_ata.to_account_info(),
        authority: ctx.accounts.mint_auth.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );
    token::mint_to(cpi_ctx, amount)?;

    user.claimed_tokens = true;

    emit!(TokensClaimed {
        launch: st.key(),
        user: ctx.accounts.user.key(),
        amount,
        y_approved: y,
    });

    Ok(())
}
