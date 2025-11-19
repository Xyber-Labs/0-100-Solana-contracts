#![allow(dead_code)]

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    metadata::Metadata,
    token::{Mint, Token},
};

use crate::{
    errors::ErrorCode,
    SEED_ROOT,
    state::{LaunchState, TokenMetadataConfig},
    utils::mint as mint_utils,
};

// Base mint supply is unified with sale mint; minted amount comes from state.sale_allocation + state.lp_allocation

#[derive(Accounts)]
pub struct MintForTest<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        constraint = launch_state.clmm_base_mint.is_none() @ crate::errors::ErrorCode::PoolAlreadyCreated
    )]
    #[account(constraint = launch_state.to_account_info().owner == &crate::ID @ ErrorCode::InvalidAuthority)]
    pub launch_state: Account<'info, LaunchState>,

    /// CHECK: Escrow authority PDA without data for token ownership
    #[account(seeds = [SEED_ROOT, b"escrow_authority", launch_state.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub base_mint: Box<Account<'info, Mint>>,

    /// CHECK: Escrow ATA for base token (ATA of escrow_authority for base_mint)
    #[account(
        mut,
        seeds = [escrow_authority.key().as_ref(), base_token_program.key().as_ref(), base_mint.key().as_ref()],
        seeds::program = associated_token_program.key(),
        bump
    )]
    pub base_escrow_ata: UncheckedAccount<'info>,
    /// CHECK: Metaplex metadata account PDA for base_mint
    #[account(
        mut,
        seeds = [b"metadata", token_metadata_program.key().as_ref(), base_mint.key().as_ref()],
        bump,
        seeds::program = token_metadata_program.key()
    )]
    pub metadata_account: UncheckedAccount<'info>,
    #[account(seeds = [SEED_ROOT, b"token_metadata", launch_state.key().as_ref()], bump)]
    pub token_metadata_config: Account<'info, TokenMetadataConfig>,
    pub base_token_program: Program<'info, Token>,
    pub token_metadata_program: Program<'info, Metadata>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

/// Flagged as a test feature in engine/programs/engine/src/lib.rs — used only for testing to bypass pool creation and liquidity transfer.
pub fn mint_for_test(ctx: Context<MintForTest>) -> Result<()> {
    require!(ctx.accounts.launch_state.selection_finalized, ErrorCode::NotFinalized);
    require!(
        ctx.accounts.launch_state.total_deposited >= ctx.accounts.launch_state.min_raise_lamports,
        ErrorCode::MinRaiseNotMet
    );
    require!(
        ctx.accounts.launch_state.roster_shards > 0
            && ctx.accounts.launch_state.roster_finalized_up_to + 1
                == ctx.accounts.launch_state.roster_shards as i32,
        ErrorCode::ShardsNotFullyFinalized
    );

    mint_utils::create_ata_for_authority(
        &ctx.accounts.associated_token_program.to_account_info(),
        &ctx.accounts.payer.to_account_info(),
        &ctx.accounts.base_escrow_ata.to_account_info(),
        &ctx.accounts.escrow_authority.to_account_info(),
        &ctx.accounts.base_mint.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &ctx.accounts.base_token_program.to_account_info(),
    )?;

    let to_mint = ctx.accounts.launch_state.base_total_allocation;
    mint_utils::mint_to_escrow_for_launch(
        &ctx.accounts.base_token_program.to_account_info(),
        &ctx.accounts.base_mint.to_account_info(),
        &ctx.accounts.base_escrow_ata.to_account_info(),
        &ctx.accounts.escrow_authority.to_account_info(),
        &ctx.accounts.launch_state.key(),
        to_mint,
    )?;
    mint_utils::ensure_token_metadata_for_launch(
        &ctx.accounts.token_metadata_program.to_account_info(),
        &ctx.accounts.metadata_account.to_account_info(),
        &ctx.accounts.base_mint.to_account_info(),
        &ctx.accounts.escrow_authority.to_account_info(),
        &ctx.accounts.payer.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &ctx.accounts.rent.to_account_info(),
        &ctx.accounts.token_metadata_config,
        &ctx.accounts.launch_state.key(),
    )?;
    ctx.accounts.launch_state.base_mint = Some(ctx.accounts.base_mint.key());
    ctx.accounts.launch_state.clmm_base_mint = Some(ctx.accounts.base_mint.key());
    Ok(())
}
