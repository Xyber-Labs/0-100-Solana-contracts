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

    // Creator grant fields
    pub creator_reserved_tickets: u32,
    pub creator_grant_present: bool,
    pub claims_opened_at: Option<i64>,
    pub creator_claim_lock_period_sec: i64,
}

impl LaunchState {
    pub fn mint_auth_seeds<'a>(&'a self, launch_key: &'a Pubkey) -> [&'a [u8]; 2] {
        [b"mint_auth", launch_key.as_ref()]
    }
    
    pub fn mint_auth_bump(&self) -> u8 {
        // Get the canonical bump for the mint authority PDA
        // We need to derive the launch state key first
        let launch_key = Pubkey::find_program_address(
            &[crate::constants::SEED_ROOT, b"launch", self.sale_mint.as_ref()],
            &crate::ID,
        )
        .0;
        let (_, bump) = Pubkey::find_program_address(
            &[crate::constants::SEED_ROOT, b"mint_auth", launch_key.as_ref()],
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
    pub heap: Vec<crate::types::HeapEntry>, // size ≤ K
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

    // Timeslot for "claim day" (day index from claims start)
    pub last_claim_period: i64,
    pub claimed_in_period_tickets: u32,

    pub refunded: bool,
}
