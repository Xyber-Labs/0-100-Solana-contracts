use anchor_lang::{prelude::*, solana_program::pubkey::Pubkey};
use anchor_spl::{
    associated_token::AssociatedToken,
    metadata::Metadata,
    token::{Mint, Token},
    token_interface::TokenAccount,
};
use raydium_amm_v3::{cpi, program::AmmV3, states::AmmConfig};

use crate::{
    BASE_TOKEN_DECIMALS,
    checked_mul,
    constants::{AMM_CONFIG_INDEX, WSOL_MINT},
    errors::ErrorCode,
    LaunchState,
    SEED_ROOT, state::{LaunchPreset, TokenMetadataConfig}, utils::{lottery::LotteryRaw, clmm::ClmmOrder, mint as mint_utils},
};

const DISCRIMINATOR_LEN: usize = 8;

#[derive(Accounts)]
pub struct CreateClmmPool<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut, constraint = launch_state.base_mint.is_none() @ ErrorCode::PoolAlreadyCreated)]
    pub launch_state: Box<Account<'info, LaunchState>>,

    #[account(address = launch_state.preset @ ErrorCode::MalformedPreset)]
    pub launch_preset: Account<'info, LaunchPreset>,

    /// CHECK: Raw lottery data, validated via seeds
    #[account(seeds = [SEED_ROOT, b"lottery", launch_state.key().as_ref()], bump)]
    pub lottery: UncheckedAccount<'info>,

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

    let lottery_data = ctx.accounts.lottery.try_borrow_data()?;
    let lottery = &lottery_data[DISCRIMINATOR_LEN..];

    require!(LotteryRaw::is_finalized(lottery), ErrorCode::NotFinalized);

    let total_deposited = checked_mul!(LotteryRaw::active_tickets(lottery), preset.tau_lamports)?;
    require!(
        total_deposited >= preset.min_raise_lamports,
        ErrorCode::MinRaiseNotMet
    );

    mint_utils::mint_to_escrow_for_launch(
        &ctx.accounts.base_token_program.to_account_info(),
        &ctx.accounts.base_mint.to_account_info(),
        &ctx.accounts.base_escrow_ata.to_account_info(),
        &ctx.accounts.escrow_authority.to_account_info(),
        &state.key(),
        preset.base_total_allocation,
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
        &state.key(),
    )?;
    state.base_mint = Some(ctx.accounts.base_mint.key());
    state.raydium_pool_state = Some(ctx.accounts.raydium_pool_state.key());

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
