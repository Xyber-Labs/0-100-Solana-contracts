use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::Token,
    token_2022::Token2022,
    token_interface::{Mint as InterfaceMint, TokenAccount, TokenInterface},
};
use raydium_amm_v3::{
    libraries::tick_math,
    program::AmmV3,
    states::{AmmConfig, TickArrayState},
};

use crate::{
    AMM_CONFIG_INDEX,
    EscrowAccount, instructions::{get_liquidity_range_impl, LiquidityRange}, LaunchState, SEED_ROOT,
};

#[derive(Accounts)]
pub struct AddClmmLiquidity<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub raydium_program: Program<'info, AmmV3>,

    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,

    #[account(
        constraint = launch_state.clmm_base_mint == Some(base_mint.key()),
        mint::token_program = base_token_program
    )]
    pub base_mint: Box<InterfaceAccount<'info, InterfaceMint>>,

    #[account(seeds = [SEED_ROOT, b"escrow", launch_state.key().as_ref()], bump)]
    pub escrow: Account<'info, EscrowAccount>,

    /// CHECK: Escrow authority PDA without data for token ownership and SOL transfers
    #[account(mut, seeds = [SEED_ROOT, b"escrow_authority", launch_state.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = escrow_authority,
        associated_token::token_program = base_token_program,
    )]
    pub base_escrow_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    // TODO: Uncomment WSOL constraint when reverting to WSOL
    #[account(
        mint::token_program = quote_token_program
        // address = anchor_lang::solana_program::pubkey ! ("So11111111111111111111111111111111111111112")
    )]
    pub quote_mint: Box<InterfaceAccount<'info, InterfaceMint>>,

    // TODO: to be initialized within the previous stages
    #[account(
        mut,
        associated_token::mint = quote_mint,
        associated_token::authority = escrow_authority,
        associated_token::token_program = quote_token_program,
    )]
    pub quote_token_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(seeds = [b"amm_config", &AMM_CONFIG_INDEX.to_be_bytes()], bump, seeds::program = raydium_program.key())]
    pub raydium_amm_config: Box<Account<'info, AmmConfig>>,
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

    pub quote_token_program: Interface<'info, TokenInterface>,
    pub base_token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

/// Adds initial liquidity to Raydium CLMM pool
///
/// Requires 400,000-600,000 compute units due to complex CPI operations with Raydium.
/// Caller must add ComputeBudgetProgram::setComputeUnitLimit instruction to transaction.
///
/// # Parameters
/// * `base_amount` - Amount of base tokens to add
/// * `quote_amount` - Amount of quote tokens to add
pub fn add_clmm_liquidity<'info>(
    ctx: Context<'_, '_, '_, 'info, AddClmmLiquidity<'info>>,
    base_amount: u64,
    quote_amount: u64,
) -> Result<()> {
    add_initial_liquidity(ctx, base_amount, quote_amount)
}

const RENT_RESERVE: u64 = 200_000_000;

fn add_initial_liquidity<'info>(
    ctx: Context<'_, '_, '_, 'info, AddClmmLiquidity<'info>>,
    base_amount: u64,
    quote_amount: u64,
) -> Result<()> {
    msg!("=== Input Parameters ===");
    msg!("Base amount: {}", base_amount);
    msg!("Quote amount: {}", quote_amount);

    let available_balance = ctx.accounts.escrow_authority.to_account_info().lamports();
    let transfer_amount = available_balance.saturating_sub(RENT_RESERVE);
    msg!("Available balance on escrow_authority: {}", available_balance);
    msg!("Transfer amount (after rent reserve): {}", transfer_amount);

    let launch_key = ctx.accounts.launch_state.key();
    let escrow_authority_seeds = &[
        SEED_ROOT,
        b"escrow_authority",
        launch_key.as_ref(),
        &[ctx.bumps.escrow_authority],
    ];
    let signers = &[&escrow_authority_seeds[..]];

    let mut order = OpenPositionOrder::new(
        &ctx.accounts.quote_mint.to_account_info(),
        &ctx.accounts.base_mint.to_account_info(),
        &ctx.accounts.raydium_quote_vault.to_account_info(),
        &ctx.accounts.raydium_base_vault.to_account_info(),
        &ctx.accounts.quote_token_ata.to_account_info(),
        &ctx.accounts.base_escrow_ata.to_account_info(),
        quote_amount,
        base_amount,
    );
    msg!("Token order - amount_0: {}, amount_1: {}", order.amount_0, order.amount_1);

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
        token_account_0: order.token_account_0,
        token_account_1: order.token_account_1,
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

    let token_0_value = order.amount_0;
    let token_1_value = order.amount_1;

    msg!("Order base flag: {}", order.base_flag.unwrap());

    let range = get_liquidity_range_impl(
        ctx.accounts.raydium_amm_config.tick_spacing,
        6.16 * 10f64.powi(-7),
        order.base_flag.unwrap(),
    );
    msg!("range: {:?}", range);

    raydium_amm_v3::cpi::open_position_with_token22_nft(
        cpi_context,
        range.tick_array_lower,
        range.tick_array_upper,
        range.tick_array_lower_start_index,
        range.tick_array_upper_start_index,
        0,
        token_0_value,
        token_1_value,
        true,
        order.base_flag,
    )?;

    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct LiquidityAccountsEvent {
    pub quote_token_ata_amount: u64,
    pub base_escrow_ata_amount: u64,
    pub expected_quote_amount: u64,
    pub expected_base_amount: u64,
}

struct OpenPositionOrder<'info> {
    token_mint_0: AccountInfo<'info>,
    token_mint_1: AccountInfo<'info>,
    token_vault_0: AccountInfo<'info>,
    token_vault_1: AccountInfo<'info>,
    token_account_0: AccountInfo<'info>,
    token_account_1: AccountInfo<'info>,
    amount_0: u64,
    amount_1: u64,
    base_flag: Option<bool>,
}

impl<'info> OpenPositionOrder<'info> {
    fn new(
        quote_mint: &AccountInfo<'info>,
        base_mint: &AccountInfo<'info>,
        quote_vault: &AccountInfo<'info>,
        base_vault: &AccountInfo<'info>,
        quote_account: &AccountInfo<'info>,
        base_account: &AccountInfo<'info>,
        quote_amount: u64,
        base_amount: u64,
    ) -> Self {
        if quote_mint.key() < base_mint.key() {
            Self {
                token_mint_0: quote_mint.clone(),
                token_mint_1: base_mint.clone(),
                token_vault_0: quote_vault.clone(),
                token_vault_1: base_vault.clone(),
                token_account_0: quote_account.clone(),
                token_account_1: base_account.clone(),
                amount_0: quote_amount,
                amount_1: base_amount,
                base_flag: Some(false),
            }
        } else {
            Self {
                token_mint_0: base_mint.clone(),
                token_mint_1: quote_mint.clone(),
                token_vault_0: base_vault.clone(),
                token_vault_1: quote_vault.clone(),
                token_account_0: base_account.clone(),
                token_account_1: quote_account.clone(),
                amount_0: base_amount,
                amount_1: quote_amount,
                base_flag: Some(true),
            }
        }
    }
}
