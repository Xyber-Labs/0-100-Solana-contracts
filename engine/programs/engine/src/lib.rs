#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub use constants::WSOL_MINT;
use constants::*;
use state::*;

use crate::{
    instructions::*,
    utils::{clmm::LiquidityRange, launch_core::InitLaunchParams},
};

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

    /// Create launch + PDAs (escrow, mint authority PDA is derived, not stored).
    pub fn init_launch(
        ctx: Context<InitLaunch>,
        params: InitLaunchParams,
        project_id: u64,
    ) -> Result<()> {
        instructions::init_launch(ctx, params, project_id)
    }

    /// Initialize roster shard account
    pub fn init_roster_shard(ctx: Context<InitRosterShard>, shard_id: u16) -> Result<()> {
        instructions::init_roster_shard(ctx, shard_id)
    }

    /// Permissionless seed setter using recent blockhash.
    pub fn set_seed(ctx: Context<SetSeed>) -> Result<()> {
        instructions::set_seed(ctx)
    }

    /// Finalize roster shard (compute prefix, set shard_base, bump totals)
    pub fn finalize_roster_shard(ctx: Context<FinalizeRosterShard>, shard_id: u16) -> Result<()> {
        instructions::finalize_roster_shard(ctx, shard_id)
    }

    /// Seal roster shard by snapshotting user ticket ranges into UserContribution
    pub fn seal_roster_shard<'info>(
        ctx: Context<'_, '_, '_, 'info, SealRosterShard<'info>>,
        shard_id: u16,
        from: u32,
        max: u16,
    ) -> Result<()> {
        instructions::seal_roster_shard(ctx, shard_id, from, max)
    }

    /// Close roster shard account after sealing
    pub fn close_roster_shard(ctx: Context<CloseRosterShard>, shard_id: u16) -> Result<()> {
        instructions::close_roster_shard(ctx, shard_id)
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
        sale_start_time_sec: i64,
        meta: TokenMetadataInput,
    ) -> Result<()> {
        instructions::init_launch_from_preset(ctx, preset_id, project_id, sale_start_time_sec, meta)
    }

    pub fn init_launch_preset(
        ctx: Context<InitLaunchPreset>,
        id: u8,
        params: InitLaunchPresetParams,
    ) -> Result<()> {
        instructions::init_launch_preset(ctx, id, params)
    }

    pub fn update_launch_preset(
        ctx: Context<UpdateLaunchPreset>,
        id: u8,
        patch: UpdateLaunchParams,
    ) -> Result<()> {
        instructions::update_launch_preset(ctx, id, patch)
    }

    /// Deposit lamports (must be multiple of τ); update user + roster; move lamports to escrow.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit(ctx, amount)
    }

    /// Withdraw during funding window (reduces ticket_count and returns lamports).
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        instructions::withdraw(ctx, amount)
    }

    /// Claim refund after selection finalized: recompute y_i and pay back (deposited - y_i*τ).
    pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
        instructions::claim_refund(ctx)
    }

    /// Claim tokens (post open_claims): mint tokens_per_ticket * y_i to user ATA.
    pub fn claim_tokens(ctx: Context<ClaimTokens>) -> Result<()> {
        instructions::claim_tokens(ctx)
    }

    /// Claim creator tokens with daily limits
    pub fn claim_creator_tokens(ctx: Context<ClaimCreatorTokens>) -> Result<()> {
        instructions::claim_creator_tokens(ctx)
    }

    /// Claim creator refund for failed launches
    pub fn claim_creator_refund(ctx: Context<ClaimCreatorRefund>) -> Result<()> {
        instructions::claim_creator_refund(ctx)
    }

    pub fn create_clmm_pool(ctx: Context<CreateClmmPool>) -> Result<()> {
        instructions::create_clmm_pool(ctx)
    }

    pub fn add_clmm_liquidity<'info>(
        ctx: Context<'_, '_, '_, 'info, AddClmmLiquidity<'info>>,
    ) -> Result<()> {
        instructions::add_clmm_liquidity(ctx)
    }

    /// Creator can increase special deposit during funding window
    pub fn creator_deposit(ctx: Context<CreatorDeposit>, amount: u64) -> Result<()> {
        instructions::creator_deposit(ctx, amount)
    }

    /// Creator can decrease special deposit during funding window
    pub fn creator_withdraw(ctx: Context<CreatorWithdraw>, amount: u64) -> Result<()> {
        instructions::creator_withdraw(ctx, amount)
    }

    #[cfg(feature = "test")]
    pub fn mint_for_test(ctx: Context<MintForTest>) -> Result<()> {
        instructions::mint_for_test(ctx)
    }

    pub fn init_team_vesting(ctx: Context<InitTeamVesting>) -> Result<()> {
        instructions::init_team_vesting(ctx)
    }

    pub fn claim_team_tokens(ctx: Context<ClaimTeamTokens>) -> Result<()> {
        instructions::claim_team_tokens(ctx)
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

    pub fn update_engine_config(
        ctx: Context<UpdateEngineConfig>,
        params: UpdateEngineConfigParams,
    ) -> Result<()> {
        instructions::update_engine_config(ctx, params)
    }

    pub fn claim_clmm_fees<'info>(
        ctx: Context<'_, '_, '_, 'info, ClaimClmmFees<'info>>,
    ) -> Result<()> {
        instructions::claim_clmm_fees(ctx)
    }
}
