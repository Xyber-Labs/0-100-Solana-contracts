#![allow(unexpected_cfgs)]
use anchor_lang::prelude::borsh::BorshSchema;
use anchor_lang::prelude::*;

mod errors;
mod events;
mod instructions;
mod utils;

use instructions::claim_refund::*;
use instructions::claim_tokens::*;
use instructions::create_pool::*;
use instructions::deposit::*;
use instructions::init_launch::*;
use instructions::init_roster::*;
use instructions::set_seed::*;
use instructions::withdraw::*;

declare_id!("DhKVzFTjzax7MeLEqiEXmEhm6ERSjehYaamqai5oPKZ7");

#[constant]
pub const SEED_ROOT: &[u8] = b"root-0-100-1";

// -------------------------------
// Constants
// -------------------------------
const MIN_N: u64 = 100;
const MAX_N: u64 = 500_000;
const DEFAULT_N: u64 = 81_000;

// -------------------------------
// Events (moved to events.rs)
// -------------------------------

#[program]
pub mod engine {
    use super::*;
    use crate::instructions::*;

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

    // -------------------------------
    // User (UI)
    // -------------------------------

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
}

// -------------------------------
// Accounts & State
// -------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone, BorshSchema, InitSpace)]
pub struct HeapEntry {
    pub score: u128,
    pub wallet: Pubkey,
    pub local_j: u32,
}

#[account]
#[derive(InitSpace)]
pub struct LaunchState {
    // Project identification
    pub project_id: u64,

    // creator
    pub creator: Pubkey,

    // Config
    pub hard_cap_lamports: u64,
    pub min_raise_lamports: u64,
    pub per_wallet_cap: u64,
    pub tau_lamports: u64,
    pub num_blocks: u64, // N value for hash range calculation

    // Sale/LP (MVP)
    pub sale_mint: Pubkey,
    pub sale_allocation: u64,
    pub lp_allocation: u64,

    // Funding
    pub funding_period_end: i64, // Unix timestamp when funding period ends
    pub total_deposited: u64,
    pub total_tickets: u32,
    pub k_capacity: u32,

    // Selection
    pub vrf_seed: Option<[u8; 32]>,
    pub selection_processed: u32, // mirror, not used in MVP (kept in SelectionState)
    pub selection_finalized: bool,
    pub threshold_score: Option<u128>,

    // Claims
    pub claims_open: bool,
    pub tokens_per_ticket: Option<u64>,
}

impl LaunchState {
    pub fn mint_auth_seeds<'a>(&'a self, launch_key: &'a Pubkey) -> [&'a [u8]; 2] {
        [b"mint_auth", launch_key.as_ref()]
    }
    pub fn mint_auth_bump(&self) -> u8 {
        // Get the canonical bump for the mint authority PDA
        // We need to derive the launch state key first
        let launch_key = Pubkey::find_program_address(
            &[SEED_ROOT, b"launch", self.sale_mint.as_ref()],
            &crate::ID,
        )
        .0;
        let (_, bump) = Pubkey::find_program_address(
            &[SEED_ROOT, b"mint_auth", launch_key.as_ref()],
            &crate::ID,
        );
        bump
    }
}

#[account]
#[derive(InitSpace)]
pub struct UserContribution {
    pub launch: Pubkey,
    pub wallet: Pubkey,
    pub deposited: u64,
    pub ticket_count: u32,
    pub claimed_refund: bool,
    pub claimed_tokens: bool,
}

#[account]
#[derive(InitSpace)]
pub struct Roster {
    pub launch: Pubkey,

    // dynamic until close; then frozen
    #[max_len(100)]
    pub wallets: Vec<Pubkey>,
    #[max_len(100)]
    pub counts: Vec<u32>,

    // built at close
    #[max_len(100)]
    pub prefix: Vec<u32>, // prefix[u] = Σ counts[k], k<u
    pub total_in_shard: u32,
    pub shard_base: u32, // 0 in MVP
}

#[account]
#[derive(InitSpace)]
pub struct EscrowAccount {
    pub launch: Pubkey,
    pub balance: u64,
}

#[account]
#[derive(InitSpace)]
pub struct SelectionState {
    pub launch: Pubkey,
    pub vrf_seed: [u8; 32],
    pub processed: u32,
    pub finalized: bool,
    pub threshold: Option<u128>,
    #[max_len(100)]
    pub heap: Vec<HeapEntry>, // size ≤ K
}

#[account]
#[derive(InitSpace)]
pub struct ProjectCounter {
    pub last_project_id: u64,
    pub last_pool_id: u64,
}

#[account]
#[derive(InitSpace)]
pub struct PoolState {
    pub launch: Pubkey,
    pub pool_id: u64,
    pub project_id: u64,
    pub created_slot: u64,
    pub created_blockhash: [u8; 32],
    pub range_start: [u8; 32],
    pub range_end: [u8; 32],
    pub created: bool,
}

// -------------------------------
// Contexts (#[derive(Accounts)])
// -------------------------------



#[derive(Accounts)]
pub struct ProcessBatch<'info> {
    #[account(mut)]
    pub selection_state: Account<'info, SelectionState>,
    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,
    #[account(mut)]
    pub roster: Account<'info, Roster>,
}






// -------------------------------
// Utility / helpers
// -------------------------------

// -------------------------------
// Errors (moved to errors.rs)
// -------------------------------
