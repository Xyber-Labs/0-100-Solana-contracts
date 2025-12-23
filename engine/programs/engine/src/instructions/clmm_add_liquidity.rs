use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
    token_2022::Token2022,
};
use raydium_amm_v3::{program::AmmV3, states::AmmConfig};

use crate::{
    checked_mul,
    constants::AMM_CONFIG_INDEX,
    errors::ErrorCode,
    SEED_ROOT,
    state::{LaunchPreset, LaunchState, PoolState, WithdrawnRanges},
    utils::{bitmap::TicketBitmap, clmm::{ClmmOrder, get_liquidity_range_impl}},
};

#[derive(Accounts)]
pub struct AddClmmLiquidity<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
    pub launch_state: Box<Account<'info, LaunchState>>,

    #[account(address = launch_state.preset @ ErrorCode::MalformedPreset)]
    pub launch_preset: Account<'info, LaunchPreset>,

    #[account(seeds = [SEED_ROOT, b"bitmap", launch_state.key().as_ref()], bump)]
    pub launch_bitmap: Account<'info, TicketBitmap>,

    #[account(seeds = [SEED_ROOT, b"withdrawn", launch_state.key().as_ref()], bump)]
    pub withdrawn_ranges: Account<'info, WithdrawnRanges>,

    #[account(
        constraint = launch_state.base_mint == Some(base_mint.key()),
        mint::authority = escrow_authority,
        mint::token_program = base_token_program
    )]
    pub base_mint: Box<Account<'info, Mint>>,

    /// CHECK: Escrow authority PDA without data for token ownership and SOL transfers
    #[account(mut, seeds = [SEED_ROOT, b"escrow_authority", launch_state.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = escrow_authority,
        associated_token::token_program = base_token_program,
    )]
    pub base_escrow_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mint::token_program = quote_token_program,
        address = anchor_lang::solana_program::pubkey ! ("So11111111111111111111111111111111111111112")
    )]
    pub quote_mint: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = quote_mint,
        associated_token::authority = escrow_authority,
        associated_token::token_program = quote_token_program,
    )]
    pub quote_escrow_ata: Box<Account<'info, TokenAccount>>,

    #[account(seeds = [b"amm_config", &AMM_CONFIG_INDEX.to_be_bytes()], bump, seeds::program = raydium_program.key())]
    pub raydium_amm_config: Box<Account<'info, AmmConfig>>,

    #[account(mut, seeds = [SEED_ROOT, b"pool", launch_state.key().as_ref()], bump)]
    pub pool_state: Account<'info, PoolState>,

    /// CHECK: Pool state PDA (created by Raydium)
    #[account(mut)]
    pub raydium_pool_state: UncheckedAccount<'info>,
    /// CHECK: Quote vault (created by Raydium)
    #[account(mut)]
    pub raydium_quote_vault: UncheckedAccount<'info>,
    /// CHECK: Base vault (created by Raydium)
    #[account(mut)]
    pub raydium_base_vault: UncheckedAccount<'info>,
    /// CHECK: Escrow ATA for base token
    /// CHECK: Position NFT mint
    #[account(mut)]
    pub raydium_position_nft_mint: Signer<'info>,
    /// CHECK: Position NFT account
    #[account(mut)]
    pub raydium_position_nft_account: UncheckedAccount<'info>,
    /// CHECK: Personal position state
    #[account(mut)]
    pub raydium_personal_position: UncheckedAccount<'info>,
    /// CHECK: Protocol position state
    #[account(mut)]
    pub raydium_protocol_position: UncheckedAccount<'info>,
    /// CHECK: Tick array lower
    #[account(mut)]
    pub raydium_tick_array_lower: UncheckedAccount<'info>,
    /// CHECK: Tick array upper
    #[account(mut)]
    pub raydium_tick_array_upper: UncheckedAccount<'info>,

    pub token_2022_program: Program<'info, Token2022>,

    pub raydium_program: Program<'info, AmmV3>,
    pub quote_token_program: Program<'info, Token>,
    pub base_token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

/// Adds initial liquidity to Raydium CLMM pool
///
/// Requires 400,000-600,000 compute units due to complex CPI operations with Raydium.
/// Caller must add ComputeBudgetProgram::setComputeUnitLimit instruction to transaction.
pub fn add_clmm_liquidity<'info>(
    ctx: Context<'_, '_, '_, 'info, AddClmmLiquidity<'info>>,
) -> Result<()> {
    let bitmap = &ctx.accounts.launch_bitmap;
    let withdrawn = &ctx.accounts.withdrawn_ranges;

    let active_tickets = bitmap.bits_allocated - withdrawn.total_withdrawn();
    let total_deposited = checked_mul!(active_tickets as u64, ctx.accounts.launch_preset.tau_lamports)?;
    require!(
        total_deposited >= ctx.accounts.launch_preset.min_raise_lamports,
        ErrorCode::MinRaiseNotMet
    );

    ctx.accounts.pool_state.claims_ready = true;
    add_initial_liquidity_impl(ctx, total_deposited)?;
    Ok(())
}

fn add_initial_liquidity_impl<'info>(
    ctx: Context<'_, '_, '_, 'info, AddClmmLiquidity<'info>>,
    total_deposited: u64,
) -> Result<()> {
    let order = ClmmOrder::from_inputs(
        &ctx.accounts.launch_preset,
        total_deposited,
        &ctx.accounts.quote_mint,
        &ctx.accounts.base_mint,
        &ctx.accounts.raydium_quote_vault,
        &ctx.accounts.raydium_base_vault,
        &ctx.accounts.base_token_program,
        &ctx.accounts.quote_token_program,
        Some(&ctx.accounts.base_escrow_ata),
        Some(&ctx.accounts.quote_escrow_ata),
    )?;

    let range =
        get_liquidity_range_impl(ctx.accounts.raydium_amm_config.tick_spacing, order.price_ratio);

    let launch_key = ctx.accounts.launch_state.key();
    let escrow_authority_seeds = &[
        SEED_ROOT,
        b"escrow_authority",
        launch_key.as_ref(),
        &[ctx.bumps.escrow_authority],
    ];
    let signers = &[&escrow_authority_seeds[..]];

    anchor_lang::system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.escrow_authority.to_account_info(),
                to: ctx.accounts.quote_escrow_ata.to_account_info(),
            },
            signers,
        ),
        order.quote_supply,
    )?;

    anchor_spl::token_interface::sync_native(CpiContext::new(
        ctx.accounts.quote_token_program.to_account_info(),
        anchor_spl::token_interface::SyncNative {
            account: ctx.accounts.quote_escrow_ata.to_account_info(),
        },
    ))?;

    let cpi_accounts = raydium_amm_v3::cpi::accounts::OpenPositionWithToken22Nft {
        payer: ctx.accounts.escrow_authority.to_account_info(),
        position_nft_owner: ctx.accounts.escrow_authority.to_account_info(),
        position_nft_mint: ctx.accounts.raydium_position_nft_mint.to_account_info(),
        position_nft_account: ctx.accounts.raydium_position_nft_account.to_account_info(),
        pool_state: ctx.accounts.raydium_pool_state.to_account_info(),
        protocol_position: ctx.accounts.raydium_protocol_position.to_account_info(),
        tick_array_lower: ctx.accounts.raydium_tick_array_lower.to_account_info(),
        tick_array_upper: ctx.accounts.raydium_tick_array_upper.to_account_info(),
        personal_position: ctx.accounts.raydium_personal_position.to_account_info(),
        token_account_0: order.token_source_0.expect("Expected token source to be"),
        token_account_1: order.token_source_1.expect("Expected token source to be"),
        token_vault_0: order.token_vault_0,
        token_vault_1: order.token_vault_1,
        rent: ctx.accounts.rent.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
        token_program: ctx.accounts.base_token_program.to_account_info(),
        associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
        token_program_2022: ctx.accounts.token_2022_program.to_account_info(),
        vault_0_mint: order.token_mint_0,
        vault_1_mint: order.token_mint_1,
    };

    let cpi_context = CpiContext::new_with_signer(
        ctx.accounts.raydium_program.to_account_info(),
        cpi_accounts,
        signers,
    )
    .with_remaining_accounts(ctx.remaining_accounts.to_vec());

    raydium_amm_v3::cpi::open_position_with_token22_nft(
        cpi_context,
        range.tick_array_lower,
        range.tick_array_upper,
        range.tick_array_lower_start_index,
        range.tick_array_upper_start_index,
        0,
        order.token_0_supply,
        order.token_1_supply,
        false,
        order.base_flag,
    )?;

    ctx.accounts.launch_state.raydium_position_nft_mint =
        Some(ctx.accounts.raydium_position_nft_mint.key());
    Ok(())
}
