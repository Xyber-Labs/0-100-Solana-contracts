use anchor_lang::prelude::*;

// -------------------------------
// Program Constants
// -------------------------------

#[constant]
pub const SEED_ROOT: &[u8] = b"root-0-100-1";

// -------------------------------
// Configuration Constants
// -------------------------------
pub const MIN_N: u64 = 1;
pub const MAX_N: u64 = 1_000_000;
pub const DEFAULT_N: u64 = 100;

pub const TOTAL_SUPPLY: u64 = 1_000_000_000_000_000_000u64;
pub const LP_POOL_ALLOCATION: u64 = 440_000_000_000_000_000u64;
