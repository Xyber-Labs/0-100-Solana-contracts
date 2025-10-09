use crate::errors::ErrorCode;
use crate::types::HeapEntry;
use crate::state::Roster;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;

/// Domain separation for score hashing (fix this constant).
const SCORE_DOMAIN: &[u8] = b"0-100/selection/v1";

/// Map global t to (wallet, local_j).
pub fn ticket_at(t: u32, roster: &Account<Roster>) -> Result<(Pubkey, u32)> {
    require!(t < roster.total_in_shard, ErrorCode::TOutOfRange);
    // binary search for prefix[u] ≤ t < prefix[u] + count[u]
    let idx = match roster.prefix.binary_search(&t) {
        Ok(i) => i, // exact boundary = start of some user's block
        Err(i) => {
            // i = index of first prefix > t, so user = i - 1
            i.checked_sub(1).ok_or(ErrorCode::ArithmeticOverflow)?
        }
    };
    let start = roster.prefix[idx];
    let c = roster.counts[idx];
    require!(
        t < start.checked_add(c).ok_or(ErrorCode::ArithmeticOverflow)?,
        ErrorCode::MappingError
    );
    let wallet = roster.wallets[idx];
    let local_j = t.checked_sub(start).ok_or(ErrorCode::ArithmeticOverflow)?;
    Ok((wallet, local_j))
}

/// Deterministic score from seed + (wallet, local_j).
pub fn ticket_score(seed: &[u8; 32], wallet: &Pubkey, local_j: u32) -> u128 {
    let parts: [&[u8]; 4] = [SCORE_DOMAIN, seed, wallet.as_ref(), &local_j.to_le_bytes()];
    let h = keccak::hashv(&parts);
    // take first 16 bytes as little-endian u128
    let mut arr = [0u8; 16];
    arr.copy_from_slice(&h.0[0..16]);
    u128::from_le_bytes(arr)
}

pub fn tuple_lt(a: (Pubkey, u32), b: (Pubkey, u32)) -> bool {
    if a.0 == b.0 {
        a.1 < b.1
    } else {
        a.0.to_bytes() < b.0.to_bytes()
    }
}

pub fn tuple_gt(a: (Pubkey, u32), b: (Pubkey, u32)) -> bool {
    if a.0 == b.0 {
        a.1 > b.1
    } else {
        a.0.to_bytes() > b.0.to_bytes()
    }
}

/// Tie-break demo: in MVP we accept any with score < threshold.
/// If == threshold, we check whether (wallet, j) exists in heap (edge winners).
pub fn tie_break_wins(wallet: Pubkey, j: u32, threshold: u128, heap: &[HeapEntry]) -> bool {
    heap.iter()
        .any(|e| e.score == threshold && e.wallet == wallet && e.local_j == j)
}
