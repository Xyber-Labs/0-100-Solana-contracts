use anchor_lang::prelude::*;
use raydium_amm_v3::{
    libraries::tick_math,
    program::AmmV3,
    states::{AmmConfig, TickArrayState},
};

pub use add_clmm_liquidity::*;
pub use claim_creator_refund::*;
pub use claim_creator_tokens::*;
pub use claim_refund::*;
pub use claim_tokens::*;
pub use create_clmm_pool::*;
pub use create_pool::*;
pub use deposit::*;
pub use finalize_roster_shard::*;
pub use get_liquidity_range::*;
pub use init_launch::*;
pub use init_roster::*;
pub use init_roster_shard::*;
pub use open_claims::*;
pub use process_batch::*;
pub use set_seed::*;
pub use withdraw::*;

mod add_clmm_liquidity;
mod claim_creator_refund;
mod claim_creator_tokens;
mod claim_refund;
mod claim_tokens;
mod create_clmm_pool;
mod create_pool;
mod deposit;
mod finalize_roster_shard;
mod get_liquidity_range;
mod init_launch;
mod init_roster;
mod init_roster_shard;
mod open_claims;
mod process_batch;
mod set_seed;
mod withdraw;

struct RaydiumPositionCalculator;

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct LiquidityRange {
    tick_array_lower: i32,
    tick_array_lower_start_index: i32,
    tick_array_upper: i32,
    tick_array_upper_start_index: i32,
}

fn get_liquidity_range_impl(tick_spacing: u16, price_ratio: f64, straight: bool) -> LiquidityRange {
    use raydium_amm_v3::libraries::fixed_point_64;

    let price = if straight {
        price_ratio
    } else {
        1f64 / price_ratio
    } * 1.15;
    let price_lower = price * 10f64.powi(-4);
    let price_upper = price * 10f64.powi(5);

    let sqrt_price_lower_x64 = (price_lower.sqrt() * fixed_point_64::Q64 as f64) as u128;
    let sqrt_price_upper_x64 = (price_upper.sqrt() * fixed_point_64::Q64 as f64) as u128;

    let tick_lower_raw = tick_math::get_tick_at_sqrt_price(sqrt_price_lower_x64).unwrap();
    let tick_upper_raw = tick_math::get_tick_at_sqrt_price(sqrt_price_upper_x64).unwrap();

    let spacing = tick_spacing as i32;
    let tick_array_lower = (tick_lower_raw / spacing) * spacing;
    let tick_array_upper = ((tick_upper_raw + spacing - 1) / spacing) * spacing;

    let tick_array_lower_start_index =
        TickArrayState::get_array_start_index(tick_lower_raw, tick_spacing);
    let tick_array_upper_start_index =
        TickArrayState::get_array_start_index(tick_upper_raw, tick_spacing);

    LiquidityRange {
        tick_array_lower,
        tick_array_lower_start_index,
        tick_array_upper,
        tick_array_upper_start_index,
    }
}
