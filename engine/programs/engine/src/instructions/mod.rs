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

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct LiquidityRange {
    tick_array_lower: i32,
    tick_array_lower_start_index: i32,
    tick_array_upper: i32,
    tick_array_upper_start_index: i32,
}

fn get_liquidity_range_impl(tick_spacing: u16, amount_0: u64, amount_1: u64) -> LiquidityRange {
    let tick_array_lower = tick_math::MIN_TICK;
    let tick_array_upper = tick_math::MAX_TICK;
    let tick_array_lower_start_index =
        TickArrayState::get_array_start_index(tick_array_lower, tick_spacing);
    let tick_array_upper_start_index =
        TickArrayState::get_array_start_index(tick_array_upper, tick_spacing);
    LiquidityRange {
        tick_array_lower,
        tick_array_lower_start_index,
        tick_array_upper,
        tick_array_upper_start_index,
    }
}
