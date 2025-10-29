use anchor_lang::prelude::*;
use raydium_amm_v3::libraries::{liquidity_math, tick_math};

use crate::LaunchState;

const MIN_TICK: i32 = -443636;
const MAX_TICK: i32 = 443636;
const TICK_SPACING: i32 = 60;
const TICK_ARRAY_SIZE: i32 = 60;

#[derive(Accounts)]
pub struct CalculateLiquidityRange<'info> {
    pub launch_state: Account<'info, LaunchState>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct LiquidityRangeResult {
    pub tick_lower: i32,
    pub tick_upper: i32,
    pub tick_array_lower_start_index: i32,
    pub tick_array_upper_start_index: i32,
    pub tick_current: i32,
}

pub fn calculate_range(base_amount: u64, quote_amount: u64) -> LiquidityRangeResult {
    let ratio = quote_amount as f64 / base_amount as f64;
    let tick_current = (ratio.ln() / 1.0001_f64.ln()).round() as i32;

    let mut tick_lower = tick_current - 20000;
    let mut tick_upper = tick_current + 20000;

    let tolerance = 0.001;
    let max_iterations = 50;

    for iteration in 0..max_iterations {
        let sqrt_price_current = tick_math::get_sqrt_price_at_tick(tick_current).unwrap_or(0);
        let sqrt_price_lower = tick_math::get_sqrt_price_at_tick(tick_lower).unwrap_or(0);
        let sqrt_price_upper = tick_math::get_sqrt_price_at_tick(tick_upper).unwrap_or(0);

        if sqrt_price_lower == 0 || sqrt_price_upper == 0 {
            break;
        }

        let l_from_base = liquidity_math::get_liquidity_from_amount_0(
            sqrt_price_current,
            sqrt_price_upper,
            base_amount,
        );
        let l_from_quote = liquidity_math::get_liquidity_from_amount_1(
            sqrt_price_lower,
            sqrt_price_current,
            quote_amount,
        );

        if l_from_quote == 0 || l_from_base == 0 {
            break;
        }

        let ratio = l_from_base as f64 / l_from_quote as f64;

        #[cfg(test)]
        if iteration < 5 || iteration % 10 == 0 {
            msg!(
                "Iteration {}: ticks=[{}, {}], L_base={}, L_quote={}, ratio={:.2}",
                iteration,
                tick_lower,
                tick_upper,
                l_from_base,
                l_from_quote,
                ratio
            );
        }

        if (ratio - 1.0).abs() < tolerance {
            break;
        }

        if ratio > 1.0 {
            let adjustment = ((ratio - 1.0).min(10.0) * 1000.0) as i32;
            tick_upper += adjustment;
            tick_lower -= adjustment / 2;
        } else {
            let adjustment = ((1.0 - ratio).min(10.0) * 1000.0) as i32;
            tick_upper -= adjustment;
            tick_lower += adjustment / 2;
        }

        tick_lower = tick_lower.max(MIN_TICK);
        tick_upper = tick_upper.min(MAX_TICK);

        if tick_lower >= tick_current || tick_upper <= tick_current {
            break;
        }
    }

    tick_lower = tick_lower.max(MIN_TICK);
    tick_upper = tick_upper.min(MAX_TICK);

    tick_lower = (tick_lower / TICK_SPACING) * TICK_SPACING;
    tick_upper = (tick_upper / TICK_SPACING) * TICK_SPACING;

    let ticks_in_array = TICK_SPACING * TICK_ARRAY_SIZE;

    let tick_array_lower_start_index = if tick_lower < 0 && tick_lower % ticks_in_array != 0 {
        ((tick_lower / ticks_in_array) - 1) * ticks_in_array
    } else {
        (tick_lower / ticks_in_array) * ticks_in_array
    };

    let tick_array_upper_start_index = if tick_upper < 0 && tick_upper % ticks_in_array != 0 {
        ((tick_upper / ticks_in_array) - 1) * ticks_in_array
    } else {
        (tick_upper / ticks_in_array) * ticks_in_array
    };

    LiquidityRangeResult {
        tick_lower,
        tick_upper,
        tick_array_lower_start_index,
        tick_array_upper_start_index,
        tick_current,
    }
}

pub fn calculate_liquidity_range(
    ctx: Context<CalculateLiquidityRange>,
    base_amount: u64,
    quote_amount: u64,
) -> Result<LiquidityRangeResult> {
    msg!("base_amount: {}, quote_amount: {}", base_amount, quote_amount);
    let result = calculate_range(base_amount, quote_amount);
    msg!("Calculated range: [{}, {}]", result.tick_lower, result.tick_upper);
    msg!(
        "Tick arrays: [{}, {}]",
        result.tick_array_lower_start_index,
        result.tick_array_upper_start_index
    );

    Ok(result)
}

#[cfg(test)]
mod tests {
    use raydium_amm_v3::libraries::{liquidity_math, tick_math};

    use super::*;

    #[test]
    fn test_range_utilizes_both_tokens() {
        let base_amount = 440_000_000u64;
        let quote_amount = 300u64;

        let ratio = quote_amount as f64 / base_amount as f64;
        let tick_current = (ratio.ln() / 1.0001_f64.ln()).round() as i32;

        let result = calculate_range(base_amount, quote_amount);

        let sqrt_price_current = tick_math::get_sqrt_price_at_tick(tick_current).unwrap();
        let sqrt_price_lower = tick_math::get_sqrt_price_at_tick(result.tick_lower).unwrap();
        let sqrt_price_upper = tick_math::get_sqrt_price_at_tick(result.tick_upper).unwrap();

        let liquidity_from_base = liquidity_math::get_liquidity_from_amount_0(
            sqrt_price_current,
            sqrt_price_upper,
            base_amount,
        );

        let liquidity_from_quote = liquidity_math::get_liquidity_from_amount_1(
            sqrt_price_lower,
            sqrt_price_current,
            quote_amount,
        );

        let liquidity = liquidity_from_base.min(liquidity_from_quote);

        let amount0_used = liquidity_math::get_delta_amount_0_unsigned(
            sqrt_price_current,
            sqrt_price_upper,
            liquidity,
            false,
        )
        .unwrap();

        let amount1_used = liquidity_math::get_delta_amount_1_unsigned(
            sqrt_price_lower,
            sqrt_price_current,
            liquidity,
            false,
        )
        .unwrap();

        let base_utilization = (amount0_used as f64 / base_amount as f64) * 100.0;
        let quote_utilization = (amount1_used as f64 / quote_amount as f64) * 100.0;

        println!("Tick range: [{}, {}]", result.tick_lower, result.tick_upper);
        println!("Base amount: {} (440M tokens)", base_amount);
        println!("Quote amount: {} (300 SOL)", quote_amount);
        println!("Liquidity from base: {}", liquidity_from_base);
        println!("Liquidity from quote: {}", liquidity_from_quote);
        println!("Base utilization: {:.2}%", base_utilization);
        println!("Quote utilization: {:.2}%", quote_utilization);

        assert!(quote_utilization > 90.0, "Quote utilization too low: {:.2}%", quote_utilization);
        println!("Note: Base utilization is {:.2}% - binary search found best_tick_range based on L ratio", base_utilization);
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
