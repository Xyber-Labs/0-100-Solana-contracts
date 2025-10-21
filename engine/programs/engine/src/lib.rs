#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

use constants::*;
use state::*;

use crate::instructions::*;

mod constants;
pub mod errors;
mod events;
mod instructions;
mod state;
mod types;
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
    pub fn create_pool(ctx: Context<CreatePool>) -> Result<()> {
        instructions::create_pool(ctx)
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

    /// Create Orca CLMM pool
    pub fn create_clmm_pool(ctx: Context<CreateClmmPool>) -> Result<()> {
        instructions::create_clmm_pool(ctx)
    }

    /// Add liquidity to Orca CLMM pool
    pub fn add_clmm_liquidity<'info>(
        ctx: Context<'_, '_, '_, 'info, AddClmmLiquidity<'info>>,
    ) -> Result<()> {
        instructions::add_clmm_liquidity(ctx)
    }

    /// Wrap SOL into wSOL on escrow ATA (wraps 45% of available lamports)
    pub fn wrap_escrow_wsol(ctx: Context<WrapEscrowWsol>) -> Result<()> {
        instructions::wrap_escrow_wsol(ctx)
    }

    pub fn top_up_fee_payer(ctx: Context<TopUpFeePayer>, amount_lamports: u64) -> Result<()> {
        instructions::top_up_fee_payer(ctx, amount_lamports)
    }

    /// Create fee payer PDA as system account
    pub fn create_fee_payer_pda(ctx: Context<CreateFeePayerPda>, lamports: u64) -> Result<()> {
        instructions::create_fee_payer_pda(ctx, lamports)
    }

    /// Unwrap wSOL from escrow and transfer SOL to recipient
    pub fn unwrap_and_transfer_sol(
        ctx: Context<UnwrapAndTransferSol>,
        amount: u64,
    ) -> Result<()> {
        instructions::unwrap_and_transfer_sol(ctx, amount)
    }

    /// Dev helper: mint base (sale) tokens into escrow ATA for initial LP
    pub fn mint_lp_base_to_escrow(ctx: Context<MintLpBaseToEscrow>, amount: u64) -> Result<()> {
        instructions::mint_lp_base_to_escrow(ctx, amount)
    }
}

// test cache
