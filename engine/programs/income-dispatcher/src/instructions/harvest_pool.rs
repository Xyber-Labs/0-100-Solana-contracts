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

use crate::income_calculator::{IncomeCalculator, Role};

pub fn harvest_pool<'info>(ctx: Context<'_, '_, '_, 'info, HarvestPool<'info>>) -> Result<()> {
    // Populate project_pool
    {
        let project_pool = &mut ctx.accounts.project_pool;
        project_pool.project_id = ctx.accounts.launch_state.project_id;
        project_pool.base_mint = ctx.accounts.base_mint.key();
        project_pool.base_decimals = ctx.accounts.base_mint.decimals;
        project_pool.quote_mint = ctx.accounts.quote_mint.key();
        project_pool.quote_decimals = ctx.accounts.quote_mint.decimals;
    }
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

    // Initialize project_pool if newly created
    let project_pool = &mut ctx.accounts.project_pool;
    if project_pool.project_id == 0 {
        project_pool.project_id = ctx.accounts.launch_state.project_id;
        project_pool.base_mint = ctx.accounts.base_mint.key();
        project_pool.base_decimals = ctx.accounts.base_mint.decimals;
        project_pool.quote_mint = ctx.accounts.quote_mint.key();
        project_pool.quote_decimals = ctx.accounts.quote_mint.decimals;
        project_pool.pool_state = ctx.accounts.pool_state.key();
        // income_calculator: None
    }

    // Reload accounts to get updated balances
    ctx.accounts.quote_vault.reload()?;
    ctx.accounts.base_vault.reload()?;

    // Calculate claimed amounts
    let quote_claimed = ctx.accounts.quote_vault.amount.saturating_sub(quote_balance_before);
    let base_claimed = ctx.accounts.base_vault.amount.saturating_sub(base_balance_before);

    msg!("Claimed base: {}", base_claimed);
    msg!("Claimed quote: {}", quote_claimed);

    // Calculate and log current pool price
    let pool_state_data =
        PoolState::try_deserialize(&mut &ctx.accounts.pool_state.data.borrow()[..])?;
    let price =
        calculate_price(pool_state_data.sqrt_price_x64, ctx.accounts.project_pool.base_decimals)?;
    let price_float = (price as f64) / 10f64.powf(ctx.accounts.project_pool.base_decimals as f64);
    msg!("Current pool price (token_1/token_0): {:.10}", price_float);

    let base_decimals_pow = 10u128.pow(ctx.accounts.project_pool.base_decimals as u32);
    let supply_u128 = ctx.accounts.base_mint.supply as u128;
    let market_cap = price
        .checked_mul(supply_u128)
        .ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?
        .checked_div(base_decimals_pow)
        .ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?;

    let mut income_calculator = IncomeCalculator::new(ctx.accounts.project_pool.base_decimals)?;
    for rule in ctx.accounts.config.distribution_rules.iter() {
        income_calculator = income_calculator.add_rule(rule.clone());
    }
    let dist = income_calculator.get_distribution(
        market_cap,
        base_claimed as u128,
        quote_claimed as u128,
    )?;
    for income in dist.incomes {
        match income.recipient {
            Role::Platform => {
                ctx.accounts
                    .project_pool
                    .earned_base_by_platform
                    .checked_add(income.base_token as _)
                    .ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?;
                ctx.accounts
                    .project_pool
                    .earned_quote_by_platform
                    .checked_add(income.quote_token as _)
                    .ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?;
            }
            Role::Creator => {
                ctx.accounts
                    .project_pool
                    .earned_base_by_creator
                    .checked_add(income.base_token as _)
                    .ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?;
                ctx.accounts
                    .project_pool
                    .earned_quote_by_creator
                    .checked_add(income.quote_token as _)
                    .ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?;
            }
            Role::Community => {
                ctx.accounts
                    .project_pool
                    .earned_base_by_community
                    .checked_add(income.base_token as _)
                    .ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?;
                ctx.accounts
                    .project_pool
                    .earned_quote_by_community
                    .checked_add(income.quote_token as _)
                    .ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?;
            }
        }
    }

    // Add to total harvested
    ctx.accounts
        .project_pool
        .total_harvested_base
        .checked_add(base_claimed as _)
        .ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?;
    ctx.accounts
        .project_pool
        .total_harvested_quote
        .checked_add(quote_claimed as _)
        .ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?;

    Ok(())
}

pub fn calculate_price(sqrt_price_x64: u128, base_decimals: u8) -> Result<u128> {
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

    let ten_pow_decimals = U256::from(10u128).pow(U256::from(base_decimals));
    let price_q64_u256 = U256::from(price_q64);
    let scaled_u256 = price_q64_u256
        .checked_mul(ten_pow_decimals)
        .ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?;
    let price_scaled_u256 = scaled_u256 >> 64;
    if price_scaled_u256 > U256::from(u128::MAX) {
        return Err(crate::errors::ErrorCode::ArithmeticOverflow.into());
    }
    Ok(price_scaled_u256.as_u128())
}

#[derive(Accounts)]
pub struct HarvestPool<'info> {
    /// Anyone can call this instruction
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Config account
    #[account(
        seeds = [crate::SEED_ROOT, b"config"],
        bump,
    )]
    pub config: Box<Account<'info, crate::state::Config>>,

    /// Launch state account
    #[account(mut)]
    pub launch_state: Box<Account<'info, engine::state::LaunchState>>,

    /// Project pool account for tracking total claims
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + crate::state::ProjectPool::INIT_SPACE,
        seeds = [crate::SEED_ROOT, b"project_pool", &launch_state.project_id.to_be_bytes()],
        bump,
    )]
    pub project_pool: Box<Account<'info, crate::state::ProjectPool>>,

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
    pub quote_mint: InterfaceAccount<'info, InterfaceMint>,

    /// Base mint from project pool
    #[account(
        constraint = Some(base_mint.key()) == launch_state.base_mint @ crate::errors::ErrorCode::InvalidTokenMint
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
