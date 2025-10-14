#![allow(unexpected_cfgs)]
use anchor_lang::prelude::*;

mod constants;
mod errors;
mod events;
mod instructions;
mod state;
mod types;
mod utils;

use crate::instructions::*;

declare_id!("DhKVzFTjzax7MeLEqiEXmEhm6ERSjehYaamqai5oPKZ7");

pub use constants::*;
pub use state::*;
pub use types::*;

#[program]
pub mod engine {
    use super::*;

    /// Create launch + PDAs (escrow, mint authority PDA is derived, not stored).
    pub fn init_launch(
        ctx: Context<InitLaunch>,
        params: InitLaunchParams,
    ) -> Result<()> {
        init_launch::handler(ctx, params)
    }

    /// Initialize roster account.
    pub fn init_roster(ctx: Context<InitRoster>) -> Result<()> {
        init_roster::handler(ctx)
    }

    /// Permissionless seed setter using recent blockhash.
    pub fn set_seed(ctx: Context<SetSeed>) -> Result<()> {
        set_seed::handler(ctx)
    }

    /// Permissionless crank: process up to max_items tickets (t = processed ..).
    pub fn process_batch(ctx: Context<ProcessBatch>, max_items: u16) -> Result<()> {
        process_batch::handler(ctx, max_items)
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

    /// Create pool with blockhash verification
    /// Checks if any of the last 10 blockhashes meets the probability threshold
    pub fn create_pool(ctx: Context<CreatePool>) -> Result<()> {
        create_pool::handler(ctx)
    }

    pub fn create_clmm_pool(ctx: Context<CreateClmmPool>) -> Result<()> {
        create_clmm_pool::create_clmm_pool(ctx)
    }

    pub fn add_clmm_liquidity(ctx: Context<AddClmmLiquidity>) -> Result<()> {
        add_clmm_liquidity::add_clmm_liquidity(ctx)
    }
}
