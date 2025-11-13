use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, transfer_checked, Mint, TokenAccount, TransferChecked};
use raydium_amm_v3::states::PoolState;

use super::harvest_pool::calculate_price;

pub fn claim(ctx: Context<Claim>) -> Result<()> {
    let project_pool = &mut ctx.accounts.project_pool;

    // Check if income calculator is configured
    let calculator = project_pool
        .income_calculator
        .as_ref()
        .ok_or(crate::errors::ErrorCode::IncomeCalculatorNotSet)?;

    // Calculate current market cap from Raydium pool price and token supply
    let pool_state_data =
        PoolState::try_deserialize(&mut &ctx.accounts.pool_state.data.borrow()[..])?;
    let price = calculate_price(pool_state_data.sqrt_price_x64)?;
    let total_supply = ctx.accounts.base_mint.supply;
    let market_cap = (price * total_supply as f64) as u128;
    msg!("Current market cap: {} (price: {:.10}, supply: {})", market_cap, price, total_supply);

    // Calculate distribution based on market cap and claimed amounts
    let distribution = calculator.get_distribution(
        market_cap,
        project_pool.total_base_claimed as u128,
        project_pool.total_quote_claimed as u128,
    )?;

    // Find the claimer's share in the distribution
    let claimer_key = ctx.accounts.claimer.key();
    let claimer_income = distribution
        .incomes
        .iter()
        .find(|income| income.recipient == claimer_key)
        .ok_or(crate::errors::ErrorCode::RecipientNotFound)?;

    // Calculate the difference between what user is entitled to and what they've already claimed
    let entitled_base = claimer_income.base_token as u64;
    let entitled_quote = claimer_income.quote_token as u64;

    let already_claimed_base = ctx.accounts.claimed_info.claimed_base;
    let already_claimed_quote = ctx.accounts.claimed_info.claimed_quote;

    let base_to_claim = entitled_base.saturating_sub(already_claimed_base);
    let quote_to_claim = entitled_quote.saturating_sub(already_claimed_quote);

    // Log the claim for transparency
    msg!("Claiming for recipient: {}", claimer_key);
    msg!("Entitled - Base tokens: {}, Quote tokens: {}", entitled_base, entitled_quote);
    msg!(
        "Already claimed - Base tokens: {}, Quote tokens: {}",
        already_claimed_base,
        already_claimed_quote
    );
    msg!("Transferring - Base tokens: {}, Quote tokens: {}", base_to_claim, quote_to_claim);

    // Transfer base tokens if any difference to claim
    if base_to_claim > 0 {
        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.base_vault.to_account_info(),
                    to: ctx.accounts.claimer_base_vault.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                    mint: ctx.accounts.base_mint.to_account_info(),
                },
            ),
            base_to_claim,
            project_pool.base_decimals,
        )?;
    }

    // Transfer quote tokens if any difference to claim
    if quote_to_claim > 0 {
        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.quote_vault.to_account_info(),
                    to: ctx.accounts.claimer_quote_vault.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                    mint: ctx.accounts.quote_mint.to_account_info(),
                },
            ),
            quote_to_claim,
            project_pool.quote_decimals,
        )?;
    }

    // Update claimed info with new totals
    ctx.accounts.claimed_info.claimed_base = entitled_base;
    ctx.accounts.claimed_info.claimed_quote = entitled_quote;

    Ok(())
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub claimer: Signer<'info>,

    #[account(
        mut,
        seeds = [crate::SEED_ROOT, b"project_pool", &project_pool.project_id.to_be_bytes()],
        bump,
    )]
    pub project_pool: Account<'info, crate::state::ProjectPool>,

    #[account(
        init_if_needed,
        payer = claimer,
        space = 8 + crate::state::ClaimedInfo::INIT_SPACE,
        seeds = [crate::SEED_ROOT, b"claimed_info", &project_pool.project_id.to_be_bytes(), claimer.key().as_ref()],
        bump,
    )]
    pub claimed_info: Account<'info, crate::state::ClaimedInfo>,

    /// CHECK: Vault authority PDA
    #[account(
        seeds = [crate::SEED_ROOT, b"project_authority", &project_pool.project_id.to_be_bytes()],
        bump,
    )]
    pub authority: AccountInfo<'info>,

    #[account(mut)]
    pub base_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub quote_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub claimer_base_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub claimer_quote_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        constraint = base_mint.key() == project_pool.base_mint @ crate::errors::ErrorCode::InvalidTokenMint
    )]
    pub base_mint: InterfaceAccount<'info, Mint>,

    #[account(
        constraint = quote_mint.key() == project_pool.quote_mint @ crate::errors::ErrorCode::InvalidTokenMint
    )]
    pub quote_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: Raydium pool state account
    #[account(
        constraint = pool_state.key() == project_pool.pool_state @ crate::errors::ErrorCode::InvalidPoolState
    )]
    pub pool_state: UncheckedAccount<'info>,

    pub token_program: Interface<'info, token_interface::TokenInterface>,
    pub system_program: Program<'info, System>,
}
