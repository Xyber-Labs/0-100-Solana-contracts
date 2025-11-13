use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::Token;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{Mint as InterfaceMint, TokenAccount};
use engine::cpi as engine_cpi;
use raydium_amm_v3::libraries::big_num::U256;
use raydium_amm_v3::libraries::full_math::MulDiv;
use raydium_amm_v3::program::AmmV3;
use raydium_amm_v3::states::PoolState;

pub fn harvest_pool<'info>(ctx: Context<'_, '_, '_, 'info, HarvestPool<'info>>) -> Result<()> {
    // Get balances before claim
    let quote_balance_before = ctx.accounts.quote_vault.amount;
    let base_balance_before = ctx.accounts.base_vault.amount;

    let cpi_accounts = engine_cpi::accounts::ClaimClmmFees {
        income_dispatcher_authority: ctx.accounts.income_dispatcher_authority.to_account_info(),
        raydium_program: ctx.accounts.raydium_program.to_account_info(),
        launch_state: ctx.accounts.launch_state.to_account_info(),
        escrow_authority: ctx.accounts.escrow_authority.to_account_info(),
        position_nft_mint: ctx.accounts.position_nft_mint.to_account_info(),
        position_nft_account: ctx.accounts.position_nft_account.to_account_info(),
        personal_position: ctx.accounts.personal_position.to_account_info(),
        pool_state: ctx.accounts.pool_state.to_account_info(),
        protocol_position: ctx.accounts.protocol_position.to_account_info(),
        token_vault_0: ctx.accounts.token_vault_0.to_account_info(),
        token_vault_1: ctx.accounts.token_vault_1.to_account_info(),
        tick_array_lower: ctx.accounts.tick_array_lower.to_account_info(),
        tick_array_upper: ctx.accounts.tick_array_upper.to_account_info(),
        recipient_token_account_0: ctx.accounts.quote_vault.to_account_info(),
        recipient_token_account_1: ctx.accounts.base_vault.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
        token_program_2022: ctx.accounts.token_program_2022.to_account_info(),
        memo_program: ctx.accounts.memo_program.to_account_info(),
        vault_0_mint: ctx.accounts.quote_mint.to_account_info(),
        vault_1_mint: ctx.accounts.base_mint.to_account_info(),
    };

    let income_dispatcher_authority_seeds = &[
        crate::SEED_ROOT,
        b"authority",
        &[ctx.bumps.income_dispatcher_authority],
    ];
    let signers = &[&income_dispatcher_authority_seeds[..]];

    let cpi_context = CpiContext::new_with_signer(
        ctx.accounts.engine_program.to_account_info(),
        cpi_accounts,
        signers,
    )
    .with_remaining_accounts(ctx.remaining_accounts.to_vec());

    engine_cpi::claim_clmm_fees(cpi_context)?;

    // Reload accounts to get updated balances
    ctx.accounts.quote_vault.reload()?;
    ctx.accounts.base_vault.reload()?;

    // Calculate claimed amounts
    let quote_claimed = ctx.accounts.quote_vault.amount.saturating_sub(quote_balance_before);
    let base_claimed = ctx.accounts.base_vault.amount.saturating_sub(base_balance_before);

    // Update accumulators
    ctx.accounts.project_pool.total_quote_claimed =
        ctx.accounts.project_pool.total_quote_claimed.saturating_add(quote_claimed);
    ctx.accounts.project_pool.total_base_claimed =
        ctx.accounts.project_pool.total_base_claimed.saturating_add(base_claimed);

    // Calculate and log current pool price
    let pool_state_data =
        PoolState::try_deserialize(&mut &ctx.accounts.pool_state.data.borrow()[..])?;
    let price = calculate_price(pool_state_data.sqrt_price_x64)?;
    msg!("Current pool price (token_1/token_0): {:.10}", price);

    // Calculate equivalent values using the current price
    // price_float is in token_1/token_0 format (quote/base)
    let base_claimed_as_quote = (base_claimed as f64) * price;
    let quote_claimed_as_base = (quote_claimed as f64) / price;

    // Convert to u64 for storage (truncate fractional parts)
    let base_claimed_as_quote_u64 = base_claimed_as_quote as u64;
    let quote_claimed_as_base_u64 = quote_claimed_as_base as u64;

    // Update total claimed values
    ctx.accounts.project_pool.total_claimed_in_quote = ctx
        .accounts
        .project_pool
        .total_claimed_in_quote
        .saturating_add(base_claimed_as_quote_u64)
        .saturating_add(quote_claimed);

    ctx.accounts.project_pool.total_claimed_in_base = ctx
        .accounts
        .project_pool
        .total_claimed_in_base
        .saturating_add(quote_claimed_as_base_u64)
        .saturating_add(base_claimed);

    Ok(())
}

pub fn calculate_price(sqrt_price_x64: u128) -> Result<f64> {
    let sqrt_price_u256 = U256::from(sqrt_price_x64);
    let price_squared_u256 = sqrt_price_u256
        .mul_div_floor(sqrt_price_u256, U256::from(1u128))
        .ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?;
    let price_q64_u256 = price_squared_u256 >> 64;
    let price_q64 = if price_q64_u256 > U256::from(u128::MAX) {
        return Err(crate::errors::ErrorCode::ArithmeticOverflow.into());
    } else {
        price_q64_u256.as_u128()
    };

    let price_float = if price_q64 == 0 {
        0.0
    } else {
        const MAX_SAFE_FLOAT_EXPONENT: i32 = 308;
        const MIN_SAFE_FLOAT_EXPONENT: i32 = -308;

        let leading_zeros = price_q64.leading_zeros() as i32;
        let significant_bits = 128 - leading_zeros;
        let exponent = significant_bits - 64;

        if !(MIN_SAFE_FLOAT_EXPONENT..=MAX_SAFE_FLOAT_EXPONENT).contains(&exponent) {
            return Err(crate::errors::ErrorCode::ArithmeticOverflow.into());
        }

        (price_q64 as f64) / 2.0_f64.powi(64)
    };

    Ok(price_float)
}

#[derive(Accounts)]
pub struct HarvestPool<'info> {
    /// Anyone can call this instruction
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Launch state account to get project_id
    #[account(mut)]
    pub launch_state: Account<'info, engine::state::LaunchState>,

    /// Project pool account for tracking total claims
    #[account(
        mut,
        seeds = [crate::SEED_ROOT, b"project_pool", &launch_state.project_id.to_be_bytes()],
        bump,
    )]
    pub project_pool: Account<'info, crate::state::ProjectPool>,

    /// CHECK: Income dispatcher authority PDA - will be signer for engine call
    #[account(
        seeds = [crate::SEED_ROOT, b"authority"],
        bump,
        seeds::program = crate::ID
    )]
    pub income_dispatcher_authority: UncheckedAccount<'info>,

    /// CHECK: Project authority PDA derived from launch state's project_id
    #[account(
        seeds = [crate::SEED_ROOT, b"project_authority", &launch_state.project_id.to_be_bytes()],
        bump,
        seeds::program = crate::ID
    )]
    pub project_authority: UncheckedAccount<'info>,

    /// Quote mint from project pool
    #[account(
        constraint = quote_mint.key() == project_pool.quote_mint @ crate::errors::ErrorCode::InvalidTokenMint
    )]
    pub quote_mint: InterfaceAccount<'info, InterfaceMint>,

    /// Base mint from project pool
    #[account(
        constraint = base_mint.key() == project_pool.base_mint @ crate::errors::ErrorCode::InvalidTokenMint
    )]
    pub base_mint: InterfaceAccount<'info, InterfaceMint>,

    /// Quote vault - init-if-needed associated token account owned by project_authority
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = quote_mint,
        associated_token::authority = project_authority,
    )]
    pub quote_vault: InterfaceAccount<'info, TokenAccount>,

    /// Base vault - init-if-needed associated token account owned by project_authority
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = base_mint,
        associated_token::authority = project_authority,
    )]
    pub base_vault: InterfaceAccount<'info, TokenAccount>,

    pub engine_program: Program<'info, engine::program::Engine>,

    pub raydium_program: Program<'info, AmmV3>,

    /// CHECK: Escrow authority PDA - validated by engine CPI
    #[account(mut)]
    pub escrow_authority: UncheckedAccount<'info>,

    /// CHECK: Position NFT mint - validated by engine CPI
    #[account(mut)]
    pub position_nft_mint: UncheckedAccount<'info>,
    /// CHECK: Position NFT account - validated by engine CPI
    #[account(mut)]
    pub position_nft_account: UncheckedAccount<'info>,

    /// CHECK: Personal position state - validated by engine CPI
    #[account(mut)]
    pub personal_position: UncheckedAccount<'info>,
    /// CHECK: Pool state - validated by engine CPI and pool address constraint
    #[account(
        constraint = pool_state.key() == project_pool.pool_state @ crate::errors::ErrorCode::InvalidPoolState,
        constraint = {
            let pool_data = PoolState::try_deserialize(&mut &pool_state.data.borrow()[..])?;
            pool_data.token_mint_0 == base_mint.key() || pool_data.token_mint_1 == base_mint.key()
        } @ crate::errors::ErrorCode::InvalidPoolState,
        constraint = {
            let pool_data = PoolState::try_deserialize(&mut &pool_state.data.borrow()[..])?;
            pool_data.token_mint_0 == quote_mint.key() || pool_data.token_mint_1 == quote_mint.key()
        } @ crate::errors::ErrorCode::InvalidPoolState
    )]
    #[account(mut)]
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: Protocol position state - validated by engine CPI
    #[account(mut)]
    pub protocol_position: UncheckedAccount<'info>,

    /// CHECK: Token vault 0 - validated by engine CPI
    #[account(mut)]
    pub token_vault_0: UncheckedAccount<'info>,
    /// CHECK: Token vault 1 - validated by engine CPI
    #[account(mut)]
    pub token_vault_1: UncheckedAccount<'info>,

    /// CHECK: Lower tick array - validated by engine CPI
    #[account(mut)]
    pub tick_array_lower: UncheckedAccount<'info>,
    /// CHECK: Upper tick array - validated by engine CPI
    #[account(mut)]
    pub tick_array_upper: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub token_program_2022: Program<'info, Token2022>,

    /// CHECK: Memo program - validated by address constraint
    #[account(address = anchor_spl::memo::spl_memo::id())]
    pub memo_program: UncheckedAccount<'info>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
