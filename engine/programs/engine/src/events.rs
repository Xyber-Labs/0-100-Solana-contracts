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
pub struct Refunded {
    pub launch: Pubkey,
    pub contributor: Pubkey,
    pub refunded_lamports: u64,
}

#[event]
pub struct Claimed {
    pub launch: Pubkey,
    pub participant: Pubkey,
    pub bucket: u8,
    pub tokens: u64,
}
