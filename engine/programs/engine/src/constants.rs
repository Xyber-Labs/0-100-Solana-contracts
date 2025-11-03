use anchor_lang::prelude::*;

// -------------------------------
// Program Constants
// -------------------------------

#[constant]
pub const SEED_ROOT: &[u8] = b"root-0-100-1";

#[constant]
pub const AMM_CONFIG_INDEX: u16 = 4;

#[cfg(feature = "devnet")]
pub const RAYDIUM_CLMM_PROGRAM_ID: Pubkey = anchor_lang::solana_program::pubkey!("devi51mZmdwUJGU9hjN27vEz64Gps7uUefqxg27EAtH");

#[cfg(not(feature = "devnet"))]
pub const RAYDIUM_CLMM_PROGRAM_ID: Pubkey = anchor_lang::solana_program::pubkey!("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");

pub const WSOL_MINT: Pubkey = anchor_lang::solana_program::pubkey!("So11111111111111111111111111111111111111112");

// -------------------------------
// Configuration Constants
// -------------------------------
pub const MIN_N: u64 = 1;
pub const MAX_N: u64 = 1_000_000;
pub const DEFAULT_N: u64 = 100;

pub const TOTAL_SUPPLY: u64 = 1_000_000_000_000_000_000u64;
pub const LP_POOL_ALLOCATION: u64 = 440_000_000_000u64;
