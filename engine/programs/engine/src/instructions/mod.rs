use raydium_amm_v3::libraries::tick_math;

pub use add_clmm_liquidity::*;
pub use calculate_liquidity_range::*;
pub use claim_creator_refund::*;
pub use claim_creator_tokens::*;
pub use claim_refund::*;
pub use claim_tokens::*;
pub use create_clmm_pool::*;
pub use create_pool::*;
pub use deposit::*;
pub use finalize_roster_shard::*;
pub use init_launch::*;
pub use init_roster::*;
pub use init_roster_shard::*;
pub use open_claims::*;
pub use process_batch::*;
pub use set_seed::*;
pub use withdraw::*;

mod add_clmm_liquidity;
mod calculate_liquidity_range;
mod claim_creator_refund;
mod claim_creator_tokens;
mod claim_refund;
mod claim_tokens;
mod create_clmm_pool;
mod create_pool;
mod deposit;
mod finalize_roster_shard;
mod init_launch;
mod init_roster;
mod init_roster_shard;
mod open_claims;
mod process_batch;
mod set_seed;
mod withdraw;

struct RaydiumPositionCalculator;

fn get_liquidity_range(amount_0: u64, amount_1: u64) -> (i32, i32) {
    let tick_lower = tick_math::MIN_TICK;
    let tick_upper = tick_math::MAX_TICK;
    (tick_lower, tick_upper)
}
