use anchor_lang::prelude::*;

#[event]
pub struct LaunchInitialized {
    pub launch: Pubkey,
    pub project_id: u64,
    pub creator: Pubkey,
    pub preset_id: u8,
    pub funding_start: i64,
    pub pending_key: [u8; 32],
}

#[event]
pub struct DepositMade {
    pub launch: Pubkey,
    pub contributor: Pubkey,
    pub amount: u64,
}

#[event]
pub struct Withdrawn {
    pub launch: Pubkey,
    pub contributor: Pubkey,
    pub amount: u64,
}

#[event]
pub struct SeedSet {
    pub launch: Pubkey,
    pub seed_hash: [u8; 32],
}

#[event]
pub struct SelectionFinalized {
    pub launch: Pubkey,
    pub k_capacity: u64,
}

#[event]
pub struct RefundClaimed {
    pub launch: Pubkey,
    pub contributor: Pubkey,
    pub refunded_lamports: u64,
    pub y_approved: u64,
}

#[event]
pub struct TokensClaimed {
    pub launch: Pubkey,
    pub contributor: Pubkey,
    pub amount: u64,
    pub y_approved: u64,
}

#[event]
pub struct PoolCreated {
    pub launch: Pubkey,
    pub pool_id: u64,
    pub project_id: u64,
    pub blockhash: [u8; 32],
    pub slot: u64,
}

#[event]
pub struct CreatorClaimed {
    pub launch: Pubkey,
    pub creator: Pubkey,
    pub tickets_claimed: u64,
    pub lamports_equiv: u64,
    pub tokens_minted: u64,
    pub day_index: i64,
    pub remaining_tickets: u64,
}

#[event]
pub struct TeamVestingInitialized {
    pub launch: Pubkey,
    pub total_allocation: u64,
    pub duration_sec: i64,
}

#[event]
pub struct TeamClaimed {
    pub launch: Pubkey,
    pub creator: Pubkey,
    pub amount: u64,
    pub claimed_total: u64,
    pub remaining: u64,
    pub at: i64,
}
