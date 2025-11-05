use anchor_lang::prelude::*;

// -------------------------------
// Program Constants
// -------------------------------

#[constant]
pub const SEED_ROOT: &[u8] = b"root-0-100-1";

// -------------------------------
// Configuration Constants
// -------------------------------

pub const DEFAULT_N: u64 = 100; // Default value for N

#[constant]
pub const TEAM_BASIS_POINTS: u64 = 1_000;

#[constant]
pub const TEAM_VESTING_DURATION_SEC: i64 = 365 * 24 * 60 * 60;

#[constant]
pub const TEAM_CLAIM_MIN_INTERVAL_SEC: i64 = 1;
