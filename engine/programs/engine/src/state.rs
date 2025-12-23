use anchor_lang::prelude::*;

// -------------------------------
// Account Structures
// -------------------------------

#[account]
#[derive(InitSpace)]
pub struct LaunchState {
    /// Unix timestamp (seconds) when the launch was created
    pub created_at: i64,

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
    pub roster_initialized_up_to: i32, // 0 until first shard initialized; then last initialized shard_id
    pub roster_finalized_up_to: i32,   // 0 until finalization starts; then last finalized shard_id
    pub public_total_tickets: u32,     // sum of total_in_shard over finalized shards
    pub roster_shard_cap: u16,
    pub roster_highest_used_shard: u16, // Highest shard id that has at least one wallet (used to allow partial finalization)

    // Claims
    pub tokens_per_ticket: Option<u64>,

    // Creator grant fields
    pub creator_reserved_tickets: u32,
    pub creator_grant_present: bool,
    pub claims_opened_at: Option<i64>,
    pub creator_claim_lock_period_sec: i64,
    pub creator_initial_deposit: u64,
    pub creator_max_deposit: u64,
    // --- appended for upgrade safety ---
    pub funding_period_start: i64,
    pub pool_creation_grace_period_sec: i64,
    pub team_allocation_basis_points: u64,
    pub team_vesting_duration_sec: i64,
    pub raydium_pool_state: Option<Pubkey>,
    pub raydium_position_nft_mint: Option<Pubkey>,
}

impl LaunchState {
    pub fn mint_auth_bump_for(launch_key: &Pubkey) -> u8 {
        let (_, bump) = Pubkey::find_program_address(
            &[
                crate::constants::SEED_ROOT,
                b"escrow_authority",
                launch_key.as_ref(),
            ],
            &crate::ID,
        );
        bump
    }
}

#[account]
#[derive(InitSpace)]
pub struct EscrowAccount {
    pub launch: Pubkey,
    pub balance: u64,
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

    // --- appended for upgrade safety: finalized snapshot for claims ---
    pub finalized_snapshot: bool, // default: false
    pub final_t_base: u32,        // shard_base + prefix[u]
    pub final_ticket_count: u32,  // counts[u] at seal time
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
    pub created_by: Pubkey,
    pub wallets: Vec<Pubkey>,
    pub counts: Vec<u32>,
    pub prefix: Vec<u32>,
    pub total_in_shard: u32,
    pub shard_base: u32,
    pub sealed_count: u32,
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

#[account]
#[derive(InitSpace)]
pub struct TeamVesting {
    pub launch: Pubkey,
    pub creator: Pubkey,
    pub total_allocation: u64,
    pub claimed: u64,
    pub start_ts: i64,
    pub duration_sec: i64,
    pub min_interval_sec: i64,
    pub last_claim_ts: i64,
}

#[account]
#[derive(InitSpace)]
pub struct EngineConfig {
    pub treasury: Pubkey,
    pub creation_fee: u64,
    pub xyber_mint: Pubkey,
    pub admins: [Pubkey; 3],
    pub threshold: u8,
}

#[account]
#[derive(InitSpace)]
pub struct TokenMetadataConfig {
    pub launch: Pubkey,
    #[max_len(64)]
    pub name: String,
    #[max_len(16)]
    pub symbol: String,
    #[max_len(256)]
    pub uri: String,
    pub is_mutable: bool,
    pub seller_fee_basis_points: u16,
}

#[account]
#[derive(InitSpace)]
pub struct LaunchPreset {
    pub id: u8,
    pub hard_cap_lamports: u64,
    pub min_raise_lamports: u64,
    pub per_wallet_cap: u64,
    pub tau_lamports: u64,
    pub base_total_allocation: u64,
    pub base_sale_basis_points: u64,
    pub team_allocation_basis_points: u64,
    pub funding_duration_seconds: i64,
    pub unlock_time_sec: i64,
    pub roster_shard_cap: u16,
    pub roster_shards_total: u16,
    pub creator_initial_deposit_lamports: u64,
    pub creator_daily_lamports_limit: u64,
    pub creator_claim_lock_period_sec: i64,
    pub creator_max_deposit: u64,
    pub pool_creation_grace_period_sec: i64,
    pub team_vesting_duration_sec: i64,
}

impl LaunchPreset {
    pub fn is_valid(&self) -> Result<()> {
        require!(self.tau_lamports > 0, crate::errors::ErrorCode::MalformedPreset);
        require!(
            self.hard_cap_lamports % self.tau_lamports == 0,
            crate::errors::ErrorCode::MalformedPreset
        );
        require!(
            self.per_wallet_cap >= self.tau_lamports,
            crate::errors::ErrorCode::MalformedPreset
        );
        require!(
            self.min_raise_lamports >= crate::utils::clmm::AMMV3_CREATION_RESERVE,
            crate::errors::ErrorCode::MalformedPreset
        );
        require!(
            self.min_raise_lamports <= self.hard_cap_lamports,
            crate::errors::ErrorCode::MalformedPreset
        );
        require!(self.creator_claim_lock_period_sec > 0, crate::errors::ErrorCode::MalformedPreset);
        require!(self.roster_shards_total > 0, crate::errors::ErrorCode::MalformedPreset);
        require!(
            self.funding_duration_seconds > 0 && self.funding_duration_seconds <= 60 * 60 * 24 * 7,
            crate::errors::ErrorCode::MalformedPreset
        );
        Ok(())
    }
}
