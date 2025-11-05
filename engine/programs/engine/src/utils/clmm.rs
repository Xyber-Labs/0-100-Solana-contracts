use anchor_lang::prelude::*;
use raydium_amm_v3::{libraries::tick_math, states::TickArrayState};

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct LiquidityRange {
    pub tick_array_lower: i32,
    pub tick_array_lower_start_index: i32,
    pub tick_array_upper: i32,
    pub tick_array_upper_start_index: i32,
}

pub fn get_liquidity_range_impl(
    tick_spacing: u16,
    price_ratio: f64,
    straight: bool,
    _sqrt_price_lower_x64: u128,
) -> LiquidityRange {
    use raydium_amm_v3::libraries::fixed_point_64;

    let price = if straight { price_ratio } else { 1f64 / price_ratio } * 1.15;
    let price_lower = price * 10f64.powf(-10.0);
    let price_upper = price * 10f64.powf(4.512);

    let sqrt_price_lower_x64 = (price_lower.sqrt() * fixed_point_64::Q64 as f64) as u128;
    let sqrt_price_upper_x64 = (price_upper.sqrt() * fixed_point_64::Q64 as f64) as u128;

    let tick_lower_raw = tick_math::get_tick_at_sqrt_price(sqrt_price_lower_x64).unwrap();
    let tick_upper_raw = tick_math::get_tick_at_sqrt_price(sqrt_price_upper_x64).unwrap();

    let spacing = tick_spacing as i32;
    let tick_array_lower = (tick_lower_raw / spacing) * spacing;
    let tick_array_upper = ((tick_upper_raw + spacing - 1) / spacing) * spacing;

    let tick_array_lower_start_index = TickArrayState::get_array_start_index(tick_lower_raw, tick_spacing);
    let tick_array_upper_start_index = TickArrayState::get_array_start_index(tick_upper_raw, tick_spacing);

    LiquidityRange {
        tick_array_lower,
        tick_array_lower_start_index,
        tick_array_upper,
        tick_array_upper_start_index,
    }
}


