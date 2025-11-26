use anchor_lang::prelude::*;

// -------------------------------
// Program Constants
// -------------------------------

#[constant]
pub const SEED_ROOT: &[u8] = b"root-0-100-1";

#[cfg(not(feature = "devnet"))]
#[constant]
pub const AMM_CONFIG_INDEX: u16 = 4;

#[cfg(feature = "devnet")]
#[constant]
pub const AMM_CONFIG_INDEX: u16 = 2;

#[cfg(feature = "devnet")]
#[constant]
pub const RAYDIUM_CLMM_PROGRAM_ID: Pubkey = pubkey!("DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH");

#[cfg(not(feature = "devnet"))]
#[constant]
pub const RAYDIUM_CLMM_PROGRAM_ID: Pubkey = pubkey!("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");

pub const WSOL_MINT: Pubkey =
    anchor_lang::solana_program::pubkey!("So11111111111111111111111111111111111111112");

#[constant]
pub const INCOME_DISPATCHER_SEED_ROOT: &[u8] = b"income-dispatcher";

pub const INCOME_DISPATCHER_PROGRAM_ID: Pubkey =
    anchor_lang::solana_program::pubkey!("DPwfwgErHSmKLjGkadA4EL1zcCKU1ZhdaMUyUzJtTqCN");

// -------------------------------
// Configuration Constants
// -------------------------------

pub const DEFAULT_N: u64 = 100; // Default value for N

#[constant]
pub const TEAM_BASIS_POINTS: u64 = 1_000;

#[constant]
pub const TEAM_VESTING_DURATION_SEC: i64 = 365 * 24 * 60 * 60;
// pub const TEAM_VESTING_DURATION_SEC: i64 = 1;

#[constant]
pub const TEAM_CLAIM_MIN_INTERVAL_SEC: i64 = 1;
