use anchor_lang::prelude::*;

// -------------------------------
// Program Constants
// -------------------------------

#[constant]
pub const SEED_ROOT: &[u8] = b"root-0-100-1";

// -------------------------------
// Configuration Constants
// -------------------------------
pub const MIN_N: u64 = 1; // Min value for N (hash range calculation)
pub const MAX_N: u64 = 2000; // Max value for N
pub const DEFAULT_N: u64 = 100; // Default value for N
