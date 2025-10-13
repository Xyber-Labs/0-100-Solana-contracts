use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};
use crate::errors::ErrorCode as EngineErrorCode;
use crate::events::TokensClaimed;
use crate::utils::selection::permute_u32;
use crate::state::{LaunchState, UserContribution, RosterShard};
use crate::constants::SEED_ROOT;

#[derive(Accounts)]
pub struct ClaimTokens<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,
    #[account(mut, seeds = [SEED_ROOT, b"user", launch_state.key().as_ref(), user.key().as_ref()], bump)]
    pub user_contribution: Account<'info, UserContribution>,
    // Sharded roster account to compute ticket indices
    #[account(constraint = roster_shard.launch == launch_state.key())]
    pub roster_shard: Account<'info, RosterShard>,

    #[account(mut)]
    pub sale_mint: Account<'info, Mint>,
    /// CHECK: mint authority PDA
    /// Seeds: ["mint_auth", launch_state]
    #[account(seeds = [SEED_ROOT, b"mint_auth", launch_state.key().as_ref()], bump)]
    pub mint_auth: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = user_ata.mint == sale_mint.key() @ EngineErrorCode::InvalidMint,
        constraint = user_ata.owner == user.key() @ EngineErrorCode::InvalidOwner,
    )]
    pub user_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ClaimTokens>) -> Result<()> {
    let st = &mut ctx.accounts.launch_state;
    require!(ctx.accounts.sale_mint.key() == st.sale_mint, EngineErrorCode::Unauthorized);
    require!(st.claims_open, EngineErrorCode::ClaimsNotOpen);
    let per = st
        .tokens_per_ticket
        .ok_or(EngineErrorCode::TokensPerTicketMissing)?;

    // Tokens are claimed only if the raise was successful
    require!(
        st.total_deposited >= st.min_raise_lamports,
        EngineErrorCode::MinRaiseNotMet
    );

    let seed = st.vrf_seed.ok_or(EngineErrorCode::SeedMissing)?;

    let user = &mut ctx.accounts.user_contribution;
    require!(!user.claimed_tokens, EngineErrorCode::AlreadyClaimedTokens);

    // recompute y_i using permutation condition
    let reserved = st.creator_reserved_tickets.min(st.k_capacity);
    let k_pub = st
        .k_capacity
        .checked_sub(reserved)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
    let n = st.public_total_tickets;
    let shard = &ctx.accounts.roster_shard;
    // Ensure shard is finalized and consistent
    require!(st.roster_finalized_up_to >= shard.shard_id as i32, EngineErrorCode::ShardNotFinalized);
    require!(
        shard.wallets.len() == shard.counts.len() && shard.prefix.len() == shard.wallets.len(),
        EngineErrorCode::ShardNotFinalized
    );
    require!(user.shard_id == shard.shard_id, EngineErrorCode::Unauthorized);
    let u = user.idx_in_shard as usize;
    let base = shard.shard_base
        .checked_add(*shard.prefix.get(u).ok_or(EngineErrorCode::MappingError)?)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;

    // Early exit to avoid permute on n==0 and when no public winners are possible
    if k_pub == 0 || n == 0 {
        user.claimed_tokens = true;
        return Ok(());
    }

    let mut y = 0u32;
    for j in 0..user.ticket_count {
        let t = base.checked_add(j).ok_or(EngineErrorCode::ArithmeticOverflow)?;
        if permute_u32(&seed, n, t) < k_pub {
            y = y.checked_add(1).ok_or(EngineErrorCode::ArithmeticOverflow)?;
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
