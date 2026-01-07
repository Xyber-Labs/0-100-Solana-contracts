#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

use constants::*;
pub use constants::WSOL_MINT;
use state::*;

use crate::{instructions::*, utils::clmm::LiquidityRange};

pub mod constants;
pub mod errors;
mod events;
mod instructions;
pub mod state;
pub mod utils;

#[cfg(feature = "devnet")]
declare_id!("DhKVzFTjzax7MeLEqiEXmEhm6ERSjehYaamqai5oPKZ7");

#[cfg(not(feature = "devnet"))]
declare_id!("xybbtDz3bo6zgUHEnM8sgX7ZeftDhdRi1Hw8tBncu3p");

#[program]
pub mod engine {
    use super::*;

    /// Permissionless seed setter using recent blockhash.
    pub fn set_seed(ctx: Context<SetSeed>) -> Result<()> {
        instructions::set_seed(ctx)
    }

    // -------------------------------
    // User (UI)
    // -------------------------------

    /// Create AMM pool
    pub fn prepare_pool_creation(ctx: Context<CreatePool>) -> Result<()> {
        instructions::prepare_pool_creation(ctx)
    }

    pub fn init_launch_from_preset(
        ctx: Context<InitLaunchFromPreset>,
        preset_id: u8,
        project_id: u64,
        sale_start_time_timestamp: i64,
        meta: TokenMetadataInput,
    ) -> Result<()> {
        instructions::init_launch_from_preset(
            ctx,
            preset_id,
            project_id,
            sale_start_time_timestamp,
            meta,
        )
    }

    pub fn init_launch_preset(
        ctx: Context<InitLaunchPreset>,
        id: u8,
        params: InitLaunchPresetParams,
    ) -> Result<()> {
        instructions::init_launch_preset(ctx, id, params)
    }

    /// Deposit lamports (must be multiple of τ); allocate tickets in bitmap; move lamports to escrow.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit(ctx, amount)
    }

    /// Withdraw during funding window (reduces ticket_count and returns lamports).
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        instructions::withdraw(ctx, amount)
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        instructions::refund(ctx)
    }

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

    pub fn init_engine_config(
        ctx: Context<InitEngineConfig>,
        params: InitEngineConfigParams,
    ) -> Result<()> {
        instructions::init_engine_config(ctx, params)
    }

    pub fn claim_clmm_fees<'info>(
        ctx: Context<'_, '_, '_, 'info, ClaimClmmFees<'info>>,
    ) -> Result<()> {
        instructions::claim_clmm_fees(ctx)
    }
}
