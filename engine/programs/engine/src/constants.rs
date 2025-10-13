use anchor_lang::prelude::*;

// -------------------------------
// Program Constants
// -------------------------------

#[constant]
pub const SEED_ROOT: &[u8] = b"root-0-100-1";

// -------------------------------
// Configuration Constants
// -------------------------------
pub const MIN_N: u64 = 100;
pub const MAX_N: u64 = 500_000;
pub const DEFAULT_N: u64 = 81_000;

// Roster shard capacity (tuneable; 2048 or 4096)
pub const ROSTER_SHARD_CAP: usize = 100;
