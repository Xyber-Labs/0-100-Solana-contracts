use anchor_lang::prelude::*;
use raydium_amm_v3::states::AmmConfig;

use crate::{
    constants::{AMM_CONFIG_INDEX, RAYDIUM_CLMM_PROGRAM_ID, WSOL_MINT},
    LaunchState,
    utils::clmm::{get_liquidity_range_impl, LiquidityRange},
};

#[derive(Accounts)]
pub struct GetLiquidityRange<'info> {
    #[account(constraint = launch_state.to_account_info().owner == &crate::ID @ ErrorCode::InvalidAuthority)]
    pub launch_state: Account<'info, LaunchState>,
    #[account(
        seeds = [b"amm_config", &AMM_CONFIG_INDEX.to_be_bytes()],
        bump,
        seeds::program = RAYDIUM_CLMM_PROGRAM_ID
    )]
    pub raydium_amm_config: Account<'info, AmmConfig>,
}

pub fn get_liquidity_range(
    ctx: Context<GetLiquidityRange>,
    sqrt_price_lower_x64: u128,
) -> Result<LiquidityRange> {
    let tick_spacing = ctx.accounts.raydium_amm_config.tick_spacing;
    let straight = match ctx.accounts.launch_state.clmm_base_mint {
        Some(base) => base < WSOL_MINT,
        None => true,
    };
    Ok(get_liquidity_range_impl(
        tick_spacing,
        7.16 * 10f64.powi(-7),
        straight,
        sqrt_price_lower_x64,
    ))
}
