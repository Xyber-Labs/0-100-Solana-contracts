#![allow(unexpected_cfgs)]
use anchor_lang::prelude::*;

mod constants;
mod errors;
mod events;
mod instructions;
mod state;
mod types;
mod utils;

use instructions::claim_creator_refund::*;
use instructions::claim_creator_tokens::*;
use instructions::claim_refund::*;
use instructions::claim_tokens::*;
use instructions::create_pool::*;
use instructions::deposit::*;
use instructions::finalize_roster_shard::*;
use instructions::init_launch::*;
use instructions::init_roster::*;
use instructions::init_roster_shard::*;
use instructions::open_claims::*;
use instructions::process_batch::*;
use instructions::set_seed::*;
use instructions::withdraw::*;

declare_id!("DhKVzFTjzax7MeLEqiEXmEhm6ERSjehYaamqai5oPKZ7");

// Re-export commonly used items for convenience
pub use constants::*;
pub use state::*;
pub use types::*;

#[program]
pub mod engine {
    use super::*;
    use crate::instructions::*;

    /// Create launch + PDAs (escrow, mint authority PDA is derived, not stored).
    pub fn init_launch(ctx: Context<InitLaunch>, params: InitLaunchParams) -> Result<()> {
        init_launch::handler(ctx, params)
    }

    /// Initialize roster account.
    pub fn init_roster(ctx: Context<InitRoster>) -> Result<()> {
        init_roster::handler(ctx)
    }

    /// Initialize roster shard account
    pub fn init_roster_shard(ctx: Context<InitRosterShard>, shard_id: u16) -> Result<()> {
        init_roster_shard::handler(ctx, shard_id)
    }

    /// Permissionless seed setter using recent blockhash.
    pub fn set_seed(ctx: Context<SetSeed>) -> Result<()> {
        set_seed::handler(ctx)
    }

    /// Permissionless crank: process up to max_items tickets (t = processed ..).
    pub fn process_batch(ctx: Context<ProcessBatch>, max_items: u16) -> Result<()> {
        process_batch::handler(ctx, max_items)
    }

    /// Finalize roster shard (compute prefix, set shard_base, bump totals)
    pub fn finalize_roster_shard(ctx: Context<FinalizeRosterShard>, shard_id: u16) -> Result<()> {
        finalize_roster_shard::handler(ctx, shard_id)
    }

    /// Open claims after all shards finalized
    pub fn open_claims(ctx: Context<OpenClaims>) -> Result<()> {
        open_claims::handler(ctx)
    }

    // -------------------------------
    // User (UI)
    // -------------------------------

    /// Create AMM pool
    pub fn create_pool(ctx: Context<CreatePool>) -> Result<()> {
        create_pool::handler(ctx)
    }

    /// Deposit lamports (must be multiple of τ); update user + roster; move lamports to escrow.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        deposit::handler(ctx, amount)
    }

    /// Withdraw during funding window (reduces ticket_count and returns lamports).
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        withdraw::handler(ctx, amount)
    }

    /// Claim refund after selection finalized: recompute y_i and pay back (deposited - y_i*τ).
    pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
        claim_refund::handler(ctx)
    }

    /// Claim tokens (post open_claims): mint tokens_per_ticket * y_i to user ATA.
    pub fn claim_tokens(ctx: Context<ClaimTokens>) -> Result<()> {
        claim_tokens::handler(ctx)
    }

    /// Claim creator tokens with daily limits
    pub fn claim_creator_tokens(ctx: Context<ClaimCreatorTokens>) -> Result<()> {
        claim_creator_tokens::handler(ctx)
    }

    /// Claim creator refund for failed launches
    pub fn claim_creator_refund(ctx: Context<ClaimCreatorRefund>) -> Result<()> {
        claim_creator_refund::handler(ctx)
    }
}
