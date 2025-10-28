use anchor_lang::prelude::*;

#[event]
pub struct LaunchInitialized {
    pub project_id: u64,
    pub creator: Pubkey,
    pub base_mint: Pubkey,
    pub hard_cap_lamports: u64,
    pub min_raise_lamports: u64,
    pub per_wallet_cap: u64,
    pub tau_lamports: u64,
    pub sale_allocation: u64,
    pub lp_allocation: u64,
    pub num_partitions: u64,
}

#[event]
pub struct RosterInitialized {
    pub launch: Pubkey,
}

#[event]
pub struct FundingPeriodStarted {
    pub launch: Pubkey,
    pub funding_period_end: i64,
}

#[event]
pub struct DepositMade {
    pub launch: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub tickets_before: u32,
    pub tickets_after: u32,
    pub total_deposited: u64,
    pub total_tickets: u32,
}

#[event]
pub struct Withdrawn {
    pub launch: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub tickets_before: u32,
    pub tickets_after: u32,
    pub total_deposited: u64,
    pub total_tickets: u32,
}

#[event]
pub struct SeedSet {
    pub launch: Pubkey,
    pub seed_hash: [u8; 32],
}

#[event]
pub struct BatchProcessed {
    pub launch: Pubkey,
    pub from_t: u32,
    pub processed: u32,
    pub heap_len: u32,
}

#[event]
pub struct SelectionFinalized {
    pub launch: Pubkey,
    pub k_capacity: u32,
}

#[event]
pub struct RefundClaimed {
    pub launch: Pubkey,
    pub user: Pubkey,
    pub refunded_lamports: u64,
    /// Number of tickets that were approved for token allocation.
    /// If the min raise was not met, this will be 0.
    pub y_approved: u32,
}

#[event]
pub struct TokensClaimed {
    pub launch: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    /// Number of winning tickets.
    pub y_approved: u32,
}

#[event]
pub struct PoolCreated {
    pub launch: Pubkey,
    pub pool_id: u64,
    pub project_id: u64,
    pub blockhash: [u8; 32],
    pub slot: u64,
    pub range_start: [u8; 32],
    pub range_end: [u8; 32],
}

#[event]
pub struct CreatorGranted {
    pub launch: Pubkey,
    pub creator: Pubkey,
    pub locked_lamports: u64,
    pub reserved_tickets: u32,
    pub daily_lamports_limit: u64,
}

#[event]
pub struct CreatorClaimed {
    pub launch: Pubkey,
    pub creator: Pubkey,
    pub tickets_claimed: u32,
    pub lamports_equiv: u64,
    pub tokens_minted: u64,
    pub day_index: i64,
    pub remaining_tickets: u32,
}

#[event]
pub struct ClaimsOpened {
    pub launch: Pubkey,
    pub opened_at: i64,
}

#[event]
pub struct RosterShardInitialized {
    pub launch: Pubkey,
    pub shard_id: u16,
}

#[event]
pub struct RosterShardFinalized {
    pub launch: Pubkey,
    pub shard_id: u16,
    pub total_in_shard: u32,
    pub shard_base: u32,
}
