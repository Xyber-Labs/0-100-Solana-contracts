use anchor_lang::{prelude::*, solana_program::pubkey::Pubkey};
use anchor_spl::{
    associated_token::AssociatedToken,
    metadata::{self, CreateMetadataAccountsV3, Metadata, mpl_token_metadata::types::DataV2},
    token::{self, Mint, MintTo, Token},
    token_interface::TokenAccount,
};
use raydium_amm_v3::{cpi, program::AmmV3, states::AmmConfig};

use crate::{
    BASE_TOKEN_DECIMALS,
    checked_mul,
    constants::{AMM_CONFIG_INDEX, WSOL_MINT},
    errors::ErrorCode,
    LaunchState,
    SEED_ROOT, state::{LaunchPreset, TokenMetadataConfig}, utils::clmm::ClmmOrder,
};

#[derive(Accounts)]
pub struct CreateClmmPool<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        constraint = launch_state.is_finalized() @ ErrorCode::NotFinalized,
        constraint = !launch_state.is_pool_created() @ ErrorCode::PoolAlreadyCreated
    )]
    pub launch_state: Box<Account<'info, LaunchState>>,

    #[account(address = launch_state.preset @ ErrorCode::MalformedPreset)]
    pub launch_preset: Account<'info, LaunchPreset>,

    /// CHECK: Escrow authority PDA without data for token ownership
    #[account(seeds = [SEED_ROOT, b"escrow_authority", launch_state.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        mint::decimals = BASE_TOKEN_DECIMALS,
        mint::authority = escrow_authority,
        mint::token_program = base_token_program
    )]
    pub base_mint: Account<'info, Mint>,

    /// CHECK: Escrow ATA for base token (ATA of escrow_authority for base_mint)
    #[account(
        init,
        payer = payer,
        associated_token::mint = base_mint,
        associated_token::authority = escrow_authority,
        associated_token::token_program = base_token_program,
    )]
    pub base_escrow_ata: Box<InterfaceAccount<'info, TokenAccount>>,

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
    let state = &mut ctx.accounts.launch_state;
    let preset = &ctx.accounts.launch_preset;

    let total_deposited = checked_mul!(state.active_tickets(), preset.tau_lamports)?;

    mint_to_escrow_for_launch(
        &ctx.accounts.base_token_program.to_account_info(),
        &ctx.accounts.base_mint.to_account_info(),
        &ctx.accounts.base_escrow_ata.to_account_info(),
        &ctx.accounts.escrow_authority.to_account_info(),
        &state.key(),
        preset.base_total_allocation,
        ctx.bumps.escrow_authority,
    )?;

    ensure_token_metadata_for_launch(
        &ctx.accounts.token_metadata_program.to_account_info(),
        &ctx.accounts.metadata_account.to_account_info(),
        &ctx.accounts.base_mint.to_account_info(),
        &ctx.accounts.escrow_authority.to_account_info(),
        &ctx.accounts.payer.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &ctx.accounts.rent.to_account_info(),
        &ctx.accounts.token_metadata_config,
        &state.key(),
        ctx.bumps.escrow_authority,
    )?;

    state.set_pool_created(ctx.accounts.base_mint.key(), ctx.accounts.raydium_pool_state.key());

    raydium_create_pool_impl(&ctx, total_deposited)?;

    Ok(())
}

fn raydium_create_pool_impl(ctx: &Context<CreateClmmPool>, total_deposited: u64) -> Result<()> {
    let order = ClmmOrder::from_inputs(
        &ctx.accounts.launch_preset,
        total_deposited,
        &ctx.accounts.quote_mint,
        &ctx.accounts.base_mint,
        &ctx.accounts.raydium_quote_vault,
        &ctx.accounts.raydium_base_vault,
        &ctx.accounts.base_token_program,
        &ctx.accounts.quote_token_program,
        None,
        None,
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

fn mint_to_escrow_for_launch<'info>(
    token_program: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    escrow_authority: &AccountInfo<'info>,
    launch_key: &Pubkey,
    amount: u64,
    escrow_authority_bump: u8,
) -> Result<()> {
    let seeds: &[&[u8]] = &[
        SEED_ROOT,
        b"escrow_authority",
        &launch_key.to_bytes(),
        &[escrow_authority_bump],
    ];
    let signer_seeds = &[seeds];
    let mint_accounts = MintTo {
        mint: mint.clone(),
        to: to.clone(),
        authority: escrow_authority.clone(),
    };
    let mint_ctx = CpiContext::new_with_signer(token_program.clone(), mint_accounts, signer_seeds);
    token::mint_to(mint_ctx, amount)?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn ensure_token_metadata_for_launch<'info>(
    token_metadata_program: &AccountInfo<'info>,
    metadata_account: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    escrow_authority: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    rent: &AccountInfo<'info>,
    token_metadata_config: &TokenMetadataConfig,
    launch_key: &Pubkey,
    escrow_authority_bump: u8,
) -> Result<()> {
    if metadata_account.lamports() == 0 {
        let data = DataV2 {
            name: token_metadata_config.name.clone(),
            symbol: token_metadata_config.symbol.clone(),
            uri: token_metadata_config.uri.clone(),
            seller_fee_basis_points: token_metadata_config.seller_fee_basis_points,
            creators: None,
            collection: None,
            uses: None,
        };

        let seeds: &[&[u8]] = &[
            SEED_ROOT,
            b"escrow_authority",
            &launch_key.to_bytes(),
            &[escrow_authority_bump],
        ];
        let signer_seeds = &[seeds];

        let cpi_accounts = CreateMetadataAccountsV3 {
            metadata: metadata_account.clone(),
            mint: mint.clone(),
            mint_authority: escrow_authority.clone(),
            payer: payer.clone(),
            update_authority: escrow_authority.clone(),
            system_program: system_program.clone(),
            rent: rent.clone(),
        };
        let cpi_ctx =
            CpiContext::new_with_signer(token_metadata_program.clone(), cpi_accounts, signer_seeds);
        metadata::create_metadata_accounts_v3(
            cpi_ctx,
            data,
            token_metadata_config.is_mutable,
            true,
            None,
        )?;
    }
    Ok(())
}
