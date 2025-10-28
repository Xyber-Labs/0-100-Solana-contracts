use anchor_lang::prelude::*;

// -------------------------------
// Account Structures
// -------------------------------

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
    pub unlock_time_sec: i64,

    pub base_mint: Option<Pubkey>,
    pub base_total_allocation: u64,
    pub base_sale_basis_points: u64,

    // Funding
    pub funding_period_end: i64, // Unix timestamp when funding period ends
    pub total_deposited: u64,
    pub total_tickets: u32,
    pub k_capacity: u32,

    // Selection
    pub vrf_seed: Option<[u8; 32]>,
    pub selection_processed: u32,
    pub selection_finalized: bool,
    pub threshold_score: Option<u128>,

    // Sharded roster and permutation-based selection fields
    pub roster_shards: u16, // number of roster shards allocated for this launch
    pub roster_finalized_up_to: i32, // -1 until finalization starts; then last finalized shard_id
    pub public_total_tickets: u32, // sum of total_in_shard over finalized shards

    // Claims
    pub claims_open: bool,
    pub tokens_per_ticket: Option<u64>,

    // Creator grant fields
    pub creator_reserved_tickets: u32,
    pub creator_grant_present: bool,
    pub claims_opened_at: Option<i64>,
    pub creator_claim_lock_period_sec: i64,
    pub creator_initial_deposit: u64,
    pub roster_shard_cap: u16,
    pub clmm_base_mint: Option<Pubkey>,
}

impl LaunchState {
    pub fn mint_auth_bump_for(launch_key: &Pubkey) -> u8 {
        let (_, bump) = Pubkey::find_program_address(
            &[
                crate::constants::SEED_ROOT,
                b"mint_auth",
                launch_key.as_ref(),
            ],
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

    // Sharded roster placement (assigned on first deposit)
    pub shard_id: u16,
    pub idx_in_shard: u32,
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
    pub prefix: Vec<u32>,
    pub total_in_shard: u32,
    pub shard_base: u32,
}

// New sharded roster account
#[account]
pub struct RosterShard {
    pub launch: Pubkey,
    pub shard_id: u16,
    pub wallets: Vec<Pubkey>,
    pub counts: Vec<u32>,
    pub prefix: Vec<u32>,
    pub total_in_shard: u32,
    pub shard_base: u32,
}

#[account]
#[derive(InitSpace)]
pub struct ProjectCounter {
    pub last_project_id: u64,
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
    pub claims_ready: bool,
}

#[account]
#[derive(InitSpace)]
pub struct CreatorGrant {
    pub launch: Pubkey,
    pub creator: Pubkey,

    // Creator's special deposit locked in escrow
    pub locked_lamports: u64,

    // How many tickets are guaranteed (8 SOL / τ)
    pub reserved_tickets: u32,

    // Daily limit in lamports (usually = 1 SOL)
    pub daily_lamports_limit: u64,

    // Cap in tickets/day = floor(daily_lamports_limit / τ)
    pub daily_ticket_cap: u32,

    // How many "tickets" they have already claimed
    pub claimed_tickets: u32,

    pub refunded: bool,
}
