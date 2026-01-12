#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

use constants::*;
pub use constants::WSOL_MINT;
use state::*;

use crate::{instructions::*, utils::clmm::LiquidityRange};

pub mod constants;
pub mod errors;
mod instructions;
pub mod state;
pub mod utils;

#[cfg(feature = "devnet")]
declare_id!("DhKVzFTjzax7MeLEqiEXmEhm6ERSjehYaamqai5oPKZ7");

#[cfg(not(feature = "devnet"))]
declare_id!("xybbtDz3bo6zgUHEnM8sgX7ZeftDhdRi1Hw8tBncu3p");

#[cfg(feature = "devnet")]
#[constant]
pub const DEPLOYER: Pubkey = pubkey!("3paTDrXrsXjh9J3KLwSNup3nMPRSbSjS1h3iYTKPfqbP");

#[cfg(not(feature = "devnet"))]
#[constant]
pub const DEPLOYER: Pubkey = pubkey!("DFjKPfGgJP9N7eAXfiEdniboRMHEoUFwjtVvtrcrm7o6");

#[program]
pub mod engine {
    use super::*;

    /// Initialize or update global engine configuration (treasury, xyber_mint, multisig).
    pub fn init_engine_config(
        ctx: Context<InitEngineConfig>,
        params: EngineConfig,
        realloc_fund_lamports: u64,
    ) -> Result<()> {
        instructions::init_engine_config(ctx, params, realloc_fund_lamports)
    }

    /// Permissionless seed setter using recent blockhash.
    pub fn set_seed(ctx: Context<SetSeed>) -> Result<()> {
        instructions::set_seed(ctx)
    }

    /// Finalize lottery - select winners and open claims
    pub fn finalize_lottery(ctx: Context<FinalizeLottery>) -> Result<()> {
        instructions::finalize_lottery(ctx)
    }

    pub fn init_launch(
        ctx: Context<InitLaunch>,
        preset_id: u8,
        project_id: u64,
        sale_start_time_timestamp: i64,
        meta: TokenMetadataInput,
    ) -> Result<()> {
        instructions::init_launch(ctx, preset_id, project_id, sale_start_time_timestamp, meta)
    }

    pub fn init_launch_preset(ctx: Context<InitLaunchPreset>, params: LaunchPreset) -> Result<()> {
        instructions::init_launch_preset(ctx, params)
    }

    /// Deposit lamports (must be multiple of τ); allocate tickets in bitmap; move lamports to escrow.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit(ctx, amount)
    }

    /// Withdraw during funding window (reduces ticket_count and returns lamports).
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        instructions::withdraw(ctx, amount)
    }

    /// Refunds SOL to participants for non-winning lottery tickets.
    /// Requires lottery to be finalized and claims to be open.
    /// Delegates to `instructions::refund`.
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        instructions::refund(ctx)
    }

    /// Claims tokens from a specified bucket after lottery finalization.
    /// `bucket` specifies which allocation to claim: `Sale` for lottery winners
    /// or `Team` for team allocation. Requires claims to be open.
    /// Delegates to `instructions::claim`.
    pub fn claim(ctx: Context<Claim>, bucket: Bucket) -> Result<()> {
        instructions::claim(ctx, bucket)
    }

    pub fn create_clmm_pool(ctx: Context<CreateClmmPool>) -> Result<()> {
        instructions::create_clmm_pool(ctx)
    }

    pub fn add_clmm_liquidity<'info>(
        ctx: Context<'_, '_, '_, 'info, AddClmmLiquidity<'info>>,
    ) -> Result<()> {
        instructions::add_clmm_liquidity(ctx)
    }

    pub fn get_liquidity_range(ctx: Context<GetLiquidityRange>) -> Result<LiquidityRange> {
        instructions::get_liquidity_range(ctx)
    }

    pub fn claim_clmm_fees<'info>(
        ctx: Context<'_, '_, '_, 'info, ClaimClmmFees<'info>>,
    ) -> Result<()> {
        instructions::claim_clmm_fees(ctx)
    }

    pub fn close_clmm_position<'info>(
        ctx: Context<'_, '_, '_, 'info, CloseClmmPosition<'info>>,
    ) -> Result<()> {
        instructions::close_clmm_position(ctx)
    }
}

const MYRIAD: u128 = 10000;
