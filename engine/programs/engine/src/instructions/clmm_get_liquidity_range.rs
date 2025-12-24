use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};
use raydium_amm_v3::states::AmmConfig;

use crate::{
    checked_mul,
    constants::AMM_CONFIG_INDEX,
    errors::ErrorCode,
    LaunchState,
    RAYDIUM_CLMM_PROGRAM_ID, SEED_ROOT, state::LaunchPreset, utils::{lottery::Lottery, clmm::{ClmmOrder, get_liquidity_range_impl, LiquidityRange}},
};

#[derive(Accounts)]
pub struct GetLiquidityRange<'info> {
    #[account(constraint = launch_state.to_account_info().owner == &crate::ID @ ErrorCode::InvalidAuthority)]
    pub launch_state: Box<Account<'info, LaunchState>>,

    #[account(address = launch_state.preset @ ErrorCode::MalformedPreset)]
    pub launch_preset: Account<'info, LaunchPreset>,

    #[account(seeds = [SEED_ROOT, b"lottery", launch_state.key().as_ref()], bump)]
    pub lottery: Account<'info, Lottery>,

    /// CHECK:
    pub base_mint: Account<'info, Mint>,
    /// CHECK:
    pub quote_mint: Account<'info, Mint>,
    /// CHECK:
    pub raydium_quote_vault: UncheckedAccount<'info>,
    /// CHECK:
    pub raydium_base_vault: UncheckedAccount<'info>,
    /// CHECK:
    pub quote_token_program: Program<'info, Token>,
    /// CHECK:
    pub base_token_program: Program<'info, Token>,

    #[account(
        seeds = [b"amm_config", &AMM_CONFIG_INDEX.to_be_bytes()],
        bump,
        seeds::program = RAYDIUM_CLMM_PROGRAM_ID
    )]
    pub raydium_amm_config: Account<'info, AmmConfig>,
}

pub fn get_liquidity_range(ctx: Context<GetLiquidityRange>) -> Result<LiquidityRange> {
    let lottery = &ctx.accounts.lottery;

    let total_deposited = checked_mul!(lottery.active_tickets() as u64, ctx.accounts.launch_preset.tau_lamports)?;

    let tick_spacing = ctx.accounts.raydium_amm_config.tick_spacing;
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
    Ok(get_liquidity_range_impl(tick_spacing, order.price_ratio))
}
