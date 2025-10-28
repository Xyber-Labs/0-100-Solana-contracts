use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::Token,
    token_2022::Token2022,
    token_interface::{Mint as InterfaceMint, TokenAccount, TokenInterface},
};
use raydium_amm_v3::program::AmmV3;

use crate::{errors::ErrorCode, EscrowAccount, LaunchState, SEED_ROOT};

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

    #[account(
        mint::token_program = quote_token_program,
        address = anchor_lang::solana_program::pubkey ! ("So11111111111111111111111111111111111111112")
    )]
    pub quote_mint: Box<InterfaceAccount<'info, InterfaceMint>>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = quote_mint,
        associated_token::authority = escrow_authority,
        associated_token::token_program = quote_token_program,
    )]
    pub quote_token_ata: Box<InterfaceAccount<'info, TokenAccount>>,

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
    /// CHECK: Position metadata account
    #[account(mut)]
    pub raydium_metadata_account: UncheckedAccount<'info>,
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

    /// CHECK: Metadata program
    pub metadata_program: UncheckedAccount<'info>,

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
pub fn add_clmm_liquidity(ctx: Context<AddClmmLiquidity>) -> Result<()> {
    add_initial_liquidity(&ctx)?;
    Ok(())
}

fn add_initial_liquidity(ctx: &Context<AddClmmLiquidity>) -> Result<()> {
    let params = StakingCalculator::new(
        ctx.accounts.launch_state.total_deposited,
        ctx.accounts.launch_state.sale_allocation,
        ctx.accounts.launch_state.lp_allocation,
    )
    .get_pool_params()?;

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
                to: ctx.accounts.quote_token_ata.to_account_info(),
            },
            signers,
        ),
        params.quote_volume,
    )?;

    anchor_lang::solana_program::program::invoke(
        &anchor_spl::token::spl_token::instruction::sync_native(
            &ctx.accounts.quote_token_program.key(),
            &ctx.accounts.quote_token_ata.key(),
        )?,
        &[ctx.accounts.quote_token_ata.to_account_info()],
    )?;

    let order = TokenOrder::new(
        &ctx.accounts.quote_mint.to_account_info(),
        &ctx.accounts.base_mint.to_account_info(),
        &ctx.accounts.raydium_quote_vault.to_account_info(),
        &ctx.accounts.raydium_base_vault.to_account_info(),
        &ctx.accounts.quote_token_ata.to_account_info(),
        &ctx.accounts.base_escrow_ata.to_account_info(),
        params.quote_volume,
        params.base_volume,
    );

    let cpi_accounts = raydium_amm_v3::cpi::accounts::OpenPositionV2 {
        payer: ctx.accounts.escrow_authority.to_account_info(),
        position_nft_owner: ctx.accounts.escrow_authority.to_account_info(),
        position_nft_mint: ctx.accounts.raydium_position_nft_mint.to_account_info(),
        position_nft_account: ctx.accounts.raydium_position_nft_account.to_account_info(),
        metadata_account: ctx.accounts.raydium_metadata_account.to_account_info(),
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
        metadata_program: ctx.accounts.metadata_program.to_account_info(),
        token_program_2022: ctx.accounts.token_2022_program.to_account_info(),
        vault_0_mint: order.token_mint_0,
        vault_1_mint: order.token_mint_1,
    };

    let cpi_context = CpiContext::new_with_signer(
        ctx.accounts.raydium_program.to_account_info(),
        cpi_accounts,
        signers,
    );

    let is_token_0_quote = order.amount_0 == params.quote_volume;

    raydium_amm_v3::cpi::open_position_v2(
        cpi_context,
        params.tick_lower_index,
        params.tick_upper_index,
        params.tick_array_lower_start_index,
        params.tick_array_upper_start_index,
        0,
        order.amount_0,
        order.amount_1,
        false,
        Some(is_token_0_quote),
    )?;

    Ok(())
}

// TODO (@xykeeper) to be refined within the other issue processing
struct StakingCalculator {
    raised_lamports: u64,
    sale_allocation: u64,
    lp_allocation: u64,
}

struct RaydiumPoolParams {
    tick_lower_index: i32,
    tick_upper_index: i32,
    tick_array_lower_start_index: i32,
    tick_array_upper_start_index: i32,
    base_volume: u64,
    quote_volume: u64,
}

impl StakingCalculator {
    fn new(raised_lamports: u64, sale_allocation: u64, lp_allocation: u64) -> Self {
        Self {
            raised_lamports,
            sale_allocation,
            lp_allocation,
        }
    }

    fn get_pool_params(&self) -> Result<RaydiumPoolParams> {
        let tick_spacing = 60i32;
        let tick_array_size = 60i32;
        let ticks_in_array = tick_spacing * tick_array_size;

        let base_volume = self.lp_allocation;
        let quote_volume = u128::from(self.lp_allocation)
            .checked_mul(u128::from(self.raised_lamports))
            .and_then(|v| v.checked_div(u128::from(self.sale_allocation)))
            .and_then(|v| u64::try_from(v).ok())
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        let price = (self.raised_lamports as f64) / (self.sale_allocation as f64);
        let price_lower = price * 0.55;
        let price_upper = price * 5.5;

        let log_base = (1.0001_f64).ln();
        let tick_current_raw = price.ln() / log_base;
        let tick_lower_raw = price_lower.ln() / log_base;
        let tick_upper_raw = price_upper.ln() / log_base;

        let tick_current_index =
            (tick_current_raw / tick_spacing as f64).round() as i32 * tick_spacing;
        let tick_lower_index = (tick_lower_raw / tick_spacing as f64).floor() as i32 * tick_spacing;
        let tick_upper_index = (tick_upper_raw / tick_spacing as f64).ceil() as i32 * tick_spacing;

        let mut tick_array_lower_start = tick_lower_index / ticks_in_array;
        if tick_lower_index < 0 && tick_lower_index % ticks_in_array != 0 {
            tick_array_lower_start -= 1;
        }
        let tick_array_lower_start_index = tick_array_lower_start * ticks_in_array;

        let mut tick_array_upper_start = tick_upper_index / ticks_in_array;
        if tick_upper_index < 0 && tick_upper_index % ticks_in_array != 0 {
            tick_array_upper_start -= 1;
        }
        let tick_array_upper_start_index = tick_array_upper_start * ticks_in_array;

        Ok(RaydiumPoolParams {
            tick_lower_index,
            tick_upper_index,
            tick_array_lower_start_index,
            tick_array_upper_start_index,
            base_volume,
            quote_volume,
        })
    }
}

struct TokenOrder<'info> {
    token_mint_0: AccountInfo<'info>,
    token_mint_1: AccountInfo<'info>,
    token_vault_0: AccountInfo<'info>,
    token_vault_1: AccountInfo<'info>,
    token_account_0: AccountInfo<'info>,
    token_account_1: AccountInfo<'info>,
    amount_0: u64,
    amount_1: u64,
}

impl<'info> TokenOrder<'info> {
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
            }
        }
    }
}
