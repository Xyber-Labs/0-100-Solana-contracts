use anchor_lang::prelude::*;
use raydium_amm_v3::states::AmmConfig;

use crate::{
    AMM_CONFIG_INDEX,
    instructions::{get_liquidity_range_impl, LiquidityRange}, LaunchState, RAYDIUM_CLMM_PROGRAM_ID,
};

#[derive(Accounts)]
pub struct GetLiquidityRange<'info> {
    pub launch_state: Account<'info, LaunchState>,
    #[account(seeds = [b"amm_config", &AMM_CONFIG_INDEX.to_be_bytes()], bump, seeds::program = RAYDIUM_CLMM_PROGRAM_ID)]
    pub raydium_amm_config: Account<'info, AmmConfig>,
}

pub fn get_liquidity_range(
    ctx: Context<GetLiquidityRange>,
    sqrt_price_lower_x64: u128,
) -> Result<LiquidityRange> {
    let tick_spacing = ctx.accounts.raydium_amm_config.tick_spacing;
    Ok(get_liquidity_range_impl(
        tick_spacing,
        7.18 * 10f64.powi(-7),
        ctx.accounts.launch_state.straight,
        sqrt_price_lower_x64,
    ))
}

#[cfg(test)]
mod tests {
    use raydium_amm_v3::libraries::tick_math;

    use crate::instructions::{get_liquidity_range_impl, LiquidityRange};

    #[test]
    fn test_range_utilizes_both_tokens() {
        use raydium_amm_v3::libraries::fixed_point_64;

        let base_amount = 440_000_000u64;
        let quote_amount = 300u64;

        let price_ratio = 7.18 * 10f64.powi(-7);
        let straight = true;
        let price = if straight {
            price_ratio
        } else {
            1f64 / price_ratio
        } * 1.15;
        let price_lower = price * f64::powf(10.0, -5.0);
        let sqrt_price_lower_x64 = (price_lower.sqrt() * fixed_point_64::Q64 as f64) as u128;

        let LiquidityRange {
            tick_array_lower,
            tick_array_upper,
            tick_array_lower_start_index,
            tick_array_upper_start_index,
        } = get_liquidity_range_impl(1, price_ratio, straight, sqrt_price_lower_x64);

        assert_eq!(tick_array_lower, tick_math::MIN_TICK);
        assert_eq!(tick_array_upper, tick_math::MAX_TICK);
        assert_eq!(tick_array_lower_start_index, -443640);
        assert_eq!(tick_array_upper_start_index, 443580);
    }
    //
    // #[test]
    // fn test_range_with_different_ratios() {
    //     let test_cases = vec![
    //         (68920, 440_000_000u64, 300u64),
    //         (68920, 440_000_000u64, 433u64),
    //         (68920, 440_000_000u64, 500u64),
    //     ];
    //
    //     for (tick_current, base_amount, quote_amount) in test_cases {
    //         let result = calculate_range(tick_current, base_amount, quote_amount);
    //
    //         let sqrt_price_current = tick_math::get_sqrt_price_at_tick(tick_current).unwrap();
    //         let sqrt_price_lower = tick_math::get_sqrt_price_at_tick(result.tick_lower).unwrap();
    //         let sqrt_price_upper = tick_math::get_sqrt_price_at_tick(result.tick_upper).unwrap();
    //
    //         let base_amount_with_decimals = base_amount as u64 * 1_000_000_000;
    //         let quote_amount_with_decimals = quote_amount as u64 * 1_000_000_000;
    //
    //         let liquidity_from_base = liquidity_math::get_liquidity_from_amount_0(
    //             sqrt_price_current,
    //             sqrt_price_upper,
    //             base_amount_with_decimals,
    //         );
    //         let liquidity_from_quote = liquidity_math::get_liquidity_from_amount_1(
    //             sqrt_price_lower,
    //             sqrt_price_current,
    //             quote_amount_with_decimals,
    //         );
    //
    //         let liquidity = liquidity_from_base.min(liquidity_from_quote);
    //
    //         let amount0_used = liquidity_math::get_delta_amount_0_unsigned(
    //             sqrt_price_current,
    //             sqrt_price_upper,
    //             liquidity,
    //             false,
    //         )
    //         .unwrap();
    //         let amount1_used = liquidity_math::get_delta_amount_1_unsigned(
    //             sqrt_price_lower,
    //             sqrt_price_current,
    //             liquidity,
    //             false,
    //         )
    //         .unwrap();
    //
    //         let base_utilization = (amount0_used as f64 / base_amount_with_decimals as f64) * 100.0;
    //         let quote_utilization = (amount1_used as f64 / quote_amount_with_decimals as f64) * 100.0;
    //
    //         println!("\nQuote/Base ratio: {:.2}", quote_amount as f64 / base_amount as f64);
    //         println!("Tick range: [{}, {}]", result.tick_lower, result.tick_upper);
    //         println!("Liquidity from base: {}", liquidity_from_base);
    //         println!("Liquidity from quote: {}", liquidity_from_quote);
    //         println!("Base utilization: {:.2}%", base_utilization);
    //         println!("Quote utilization: {:.2}%", quote_utilization);
    //
    //         assert!(
    //             quote_utilization > 95.0,
    //             "Quote utilization too low: {:.2}%",
    //             quote_utilization
    //         );
    //     }
    //}
}
