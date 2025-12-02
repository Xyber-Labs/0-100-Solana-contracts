use crate::{
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    events::TokensClaimed,
    state::{LaunchState, PoolState, RosterShard, UserContribution},
    utils::selection::permute_u32,
};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct ClaimTokens<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    pub launch_state: Account<'info, LaunchState>,
    #[account(mut, seeds = [SEED_ROOT, b"user", launch_state.key().as_ref(), user.key().as_ref()], bump)]
    pub user_contribution: Account<'info, UserContribution>,
    #[account(mut)]
    pub roster_shard: Option<Account<'info, RosterShard>>, // TODO: remove roster shard from here

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
    // In test environments, liquidity step may be skipped; allow user claims if selection is finalized and base mint exists.
    require!(launch_state.base_mint.is_some(), EngineErrorCode::Unauthorized);
    require!(
        ctx.accounts.base_mint.key() == launch_state.base_mint.unwrap(),
        EngineErrorCode::Unauthorized
    );
    require!(ctx.accounts.pool_state.claims_ready, EngineErrorCode::PoolNotCreated);
    let per = launch_state.tokens_per_ticket.ok_or(EngineErrorCode::TokensPerTicketMissing)?;

    // Tokens are claimed only if the raise was successful
    require!(
        launch_state.total_deposited >= launch_state.min_raise_lamports,
        EngineErrorCode::MinRaiseNotMet
    );

    let seed = launch_state.vrf_seed.ok_or(EngineErrorCode::SeedMissing)?;

    let user = &mut ctx.accounts.user_contribution;
    require!(!user.claimed_tokens, EngineErrorCode::AlreadyClaimedTokens);

    // recompute y_i using permutation condition
    let reserved = launch_state.creator_reserved_tickets.min(launch_state.k_capacity);
    let k_pub =
        launch_state.k_capacity.checked_sub(reserved).ok_or(EngineErrorCode::ArithmeticOverflow)?;
    let n = launch_state.public_total_tickets;

    let (base, tcount) = if user.finalized_snapshot {
        // Strong binding when using finalized snapshot
        require_keys_eq!(user.launch, launch_state.key(), EngineErrorCode::Unauthorized);
        (user.final_t_base, user.final_ticket_count)
    } else {
        let shard = ctx
            .accounts
            .roster_shard
            .as_ref()
            .ok_or(EngineErrorCode::ShardNotFinalized)?;
        // Additional runtime checks to prevent shard substitution
        require_keys_eq!(shard.launch, launch_state.key(), EngineErrorCode::Unauthorized);
        require!(
            launch_state.roster_finalized_up_to >= shard.shard_id as i32,
            EngineErrorCode::ShardNotFinalized
        );
        require!(
            shard.wallets.len() == shard.counts.len() && shard.prefix.len() == shard.wallets.len(),
            EngineErrorCode::ShardNotFinalized
        );
        require!(user.shard_id == shard.shard_id, EngineErrorCode::Unauthorized);
        let u = user.idx_in_shard as usize;
        require!(u < shard.wallets.len(), EngineErrorCode::MappingError);
        require_keys_eq!(shard.wallets[u], user.wallet, EngineErrorCode::UserNotFoundInRoster);
        let b = shard
            .shard_base
            .checked_add(*shard.prefix.get(u).ok_or(EngineErrorCode::MappingError)?)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;
        let c = *shard.counts.get(u).ok_or(EngineErrorCode::MappingError)?;
        (b, c)
    };

    // Early exit to avoid permute on n==0 and when no public winners are possible
    if k_pub == 0 || n == 0 {
        user.claimed_tokens = true;
        return Ok(());
    }

    let mut y = 0u32;
    for j in 0..tcount {
        let t = base.checked_add(j).ok_or(EngineErrorCode::ArithmeticOverflow)?;
        if permute_u32(&seed, n, t) < k_pub {
            y = y.checked_add(1).ok_or(EngineErrorCode::ArithmeticOverflow)?;
        }
    }
    require!(y > 0, EngineErrorCode::NoTokensToClaim);
    let amount_u128 = (per as u128)
        .checked_mul(y as u128)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
    require!(amount_u128 <= u64::MAX as u128, EngineErrorCode::U64ConversionOverflow);
    let amount = amount_u128 as u64;

    // Transfer from escrow ATA to user ATA, signed by escrow_authority PDA
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

    user.claimed_tokens = true;

    emit!(TokensClaimed {
        launch: launch_state.key(),
        user: ctx.accounts.user.key(),
        amount,
        y_approved: y,
    });

    Ok(())
}
