use anchor_lang::prelude::*;
use anchor_lang::solana_program::pubkey::Pubkey;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token},
};
use raydium_amm_v3::{cpi, libraries::fixed_point_64, program::AmmV3, states::AmmConfig};

use crate::{
    constants::{AMM_CONFIG_INDEX, WSOL_MINT},
    errors::ErrorCode,
    state::{PoolState, TokenMetadataConfig},
    utils::mint as mint_utils,
    LaunchState, SEED_ROOT,
};
use anchor_spl::metadata::Metadata;

// Base mint supply is unified with sale mint; minted amount comes from state.sale_allocation + state.lp_allocation

#[derive(Accounts)]
pub struct CreateClmmPool<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        constraint = launch_state.to_account_info().owner == &crate::ID @ crate::errors::ErrorCode::InvalidAuthority,
        constraint = launch_state.clmm_base_mint.is_none() @ crate::errors::ErrorCode::PoolAlreadyCreated,
        constraint = launch_state.selection_finalized @ ErrorCode::NotFinalized,
        constraint = launch_state.total_deposited >= launch_state.min_raise_lamports @ ErrorCode::MinRaiseNotMet
    )]
    pub launch_state: Box<Account<'info, LaunchState>>,

    #[account(mut, seeds = [SEED_ROOT, b"pool", launch_state.key().as_ref()], bump)]
    pub pool_state: Account<'info, PoolState>,

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

    #[account(address = WSOL_MINT)]
    pub quote_mint: Box<Account<'info, Mint>>,
    #[account(seeds = [b"amm_config", &AMM_CONFIG_INDEX.to_be_bytes()], bump, seeds::program = raydium_program.key())]
    pub raydium_amm_config: Box<Account<'info, AmmConfig>>,
    /// CHECK: Pool state PDA
    #[account(mut)]
    pub raydium_pool_state: UncheckedAccount<'info>,
    /// CHECK: Base vault
    #[account(mut)]
    pub raydium_base_vault: UncheckedAccount<'info>,
    /// CHECK: Quote vault
    #[account(mut)]
    pub raydium_quote_vault: UncheckedAccount<'info>,
    /// CHECK: Observation state
    #[account(mut)]
    pub raydium_observation_state: UncheckedAccount<'info>,
    /// CHECK: Tick array bitmap
    #[account(mut)]
    pub raydium_tick_array_bitmap: UncheckedAccount<'info>,

    pub raydium_program: Program<'info, AmmV3>,
    pub quote_token_program: Program<'info, Token>,
    pub base_token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

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
    pub token_metadata_program: Program<'info, Metadata>,
}

pub fn create_clmm_pool(ctx: Context<CreateClmmPool>) -> Result<()> {
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

    let state = &ctx.accounts.launch_state;
    let base_total_atomic = state.base_total_allocation as u128;
    let to_mint = base_total_atomic as u64;

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
    raydium_create_pool_impl(&ctx)?;
    ctx.accounts.launch_state.base_mint = Some(ctx.accounts.base_mint.key());
    ctx.accounts.launch_state.clmm_base_mint = Some(ctx.accounts.base_mint.key());
    ctx.accounts.pool_state.raydium_pool_state = Some(ctx.accounts.raydium_pool_state.key());
    Ok(())
}

fn raydium_create_pool_impl(ctx: &Context<CreateClmmPool>) -> Result<()> {
    let order = TokenOrderForPool::new(
        &ctx.accounts.quote_mint.to_account_info(),
        &ctx.accounts.base_mint.to_account_info(),
        &ctx.accounts.raydium_quote_vault.to_account_info(),
        &ctx.accounts.raydium_base_vault.to_account_info(),
        &ctx.accounts.quote_token_program.to_account_info(),
        &ctx.accounts.base_token_program.to_account_info(),
        7.16 * 10f64.powi(-7),
    )?;

    let cpi_accounts = cpi::accounts::CreatePool {
        pool_creator: ctx.accounts.payer.to_account_info(),
        amm_config: ctx.accounts.raydium_amm_config.to_account_info(),
        pool_state: ctx.accounts.raydium_pool_state.to_account_info(),
        token_mint_0: order.token_mint_0,
        token_mint_1: order.token_mint_1,
        token_vault_0: order.token_vault_0,
        token_vault_1: order.token_vault_1,
        observation_state: ctx.accounts.raydium_observation_state.to_account_info(),
        tick_array_bitmap: ctx.accounts.raydium_tick_array_bitmap.to_account_info(),
        token_program_0: order.token_program_0,
        token_program_1: order.token_program_1,
        system_program: ctx.accounts.system_program.to_account_info(),
        rent: ctx.accounts.rent.to_account_info(),
    };
    let cpi_context = CpiContext::new(ctx.accounts.raydium_program.to_account_info(), cpi_accounts);
    cpi::create_pool(cpi_context, order.sqrt_price, 0)?;
    Ok(())
}

struct TokenOrderForPool<'info> {
    token_mint_0: AccountInfo<'info>,
    token_mint_1: AccountInfo<'info>,
    token_vault_0: AccountInfo<'info>,
    token_vault_1: AccountInfo<'info>,
    token_program_0: AccountInfo<'info>,
    token_program_1: AccountInfo<'info>,
    sqrt_price: u128,
}

impl<'info> TokenOrderForPool<'info> {
    fn new(
        quote_mint: &AccountInfo<'info>,
        base_mint: &AccountInfo<'info>,
        quote_vault: &AccountInfo<'info>,
        base_vault: &AccountInfo<'info>,
        quote_program: &AccountInfo<'info>,
        base_program: &AccountInfo<'info>,
        price: f64,
    ) -> Result<Self> {
        if quote_mint.key() < base_mint.key() {
            let reverse_price = 1f64 / price;
            Ok(Self {
                token_mint_0: quote_mint.clone(),
                token_mint_1: base_mint.clone(),
                token_vault_0: quote_vault.clone(),
                token_vault_1: base_vault.clone(),
                token_program_0: quote_program.clone(),
                token_program_1: base_program.clone(),
                sqrt_price: ((reverse_price.sqrt()) * fixed_point_64::Q64 as f64) as u128,
            })
        } else {
            Ok(Self {
                token_mint_0: base_mint.clone(),
                token_mint_1: quote_mint.clone(),
                token_vault_0: base_vault.clone(),
                token_vault_1: quote_vault.clone(),
                token_program_0: base_program.clone(),
                token_program_1: quote_program.clone(),
                sqrt_price: ((price.sqrt()) * fixed_point_64::Q64 as f64) as u128,
            })
        }
    }
}
