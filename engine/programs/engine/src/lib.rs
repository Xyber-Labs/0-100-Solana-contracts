#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use constants::*;
use state::*;

use crate::instructions::*;

mod constants;
pub mod errors;
mod events;
#[cfg(test)]
mod income_calculator;
mod instructions;
mod state;
pub mod utils;

declare_id!("DhKVzFTjzax7MeLEqiEXmEhm6ERSjehYaamqai5oPKZ7");

#[program]
pub mod engine {
    use super::*;

    /// Create launch + PDAs (escrow, mint authority PDA is derived, not stored).
    pub fn init_launch(ctx: Context<InitLaunch>, params: InitLaunchParams) -> Result<()> {
        instructions::init_launch(ctx, params)
    }

    /// Initialize roster account.
    pub fn init_roster(ctx: Context<InitRoster>) -> Result<()> {
        instructions::init_roster(ctx)
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

    // -------------------------------
    // User (UI)
    // -------------------------------

    /// Create AMM pool
    pub fn prepare_pool_creation(ctx: Context<CreatePool>) -> Result<()> {
        instructions::prepare_pool_creation(ctx)
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

    pub fn add_clmm_liquidity(ctx: Context<AddClmmLiquidity>) -> Result<()> {
        instructions::add_clmm_liquidity(ctx)
    }

    #[cfg(feature = "test")]
    pub fn mint_for_test(ctx: Context<MintForTest>) -> Result<()> {
        instructions::mint_for_test(ctx)
    }
}
