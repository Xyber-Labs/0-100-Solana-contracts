use anchor_lang::prelude::*;

use crate::state::TicketRange;
use crate::utils::bitmap::TicketBitmap;

pub fn count_winning_in_ranges(bitmap: &TicketBitmap, ranges: &[TicketRange]) -> u32 {
    let mut total = 0u32;
    for range in ranges {
        total += bitmap.count_ones(range.start, range.count);
    }
    total
}

pub fn conduct_lottery(
    seed: &[u8; 32],
    total_tickets: u32,
    capacity: u32,
    bitmap: &mut TicketBitmap,
) -> Result<u32> {
    if capacity >= total_tickets {
        for i in 0..total_tickets {
            bitmap.set_bit(i).ok_or(crate::errors::ErrorCode::BitmapFull)?;
        }
        return Ok(total_tickets);
    }
    for i in 0..capacity {
        let roll = hash_roll(seed, i, total_tickets);
        bitmap.set_bit(roll).ok_or(crate::errors::ErrorCode::BitmapFull)?;
    }
    Ok(capacity)
}

fn hash_roll(seed: &[u8; 32], i: u32, n: u32) -> u32 {
    use anchor_lang::solana_program::keccak::hash;
    let mut data = [0u8; 36];
    data[..32].copy_from_slice(seed);
    data[32..36].copy_from_slice(&i.to_le_bytes());
    let h = hash(&data);
    let val = u32::from_le_bytes([h.0[0], h.0[1], h.0[2], h.0[3]]);
    val % n
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_no_overflow() {
        let seed = [1u8; 32];
        let mut bm = TicketBitmap { bits_allocated: 64, bits: vec![0] };
        let winners = conduct_lottery(&seed, 50, 100, &mut bm).unwrap();
        assert_eq!(winners, 50);
        assert_eq!(bm.count_ones(0, 64), 50);
    }

    #[test]
    fn test_overflow() {
        let seed = [2u8; 32];
        let mut bm = TicketBitmap { bits_allocated: 128, bits: vec![0; 2] };
        let winners = conduct_lottery(&seed, 100, 50, &mut bm).unwrap();
        assert_eq!(winners, 50);
        assert_eq!(bm.count_ones(0, 128), 50);
    }

    #[test]
    fn test_zero_tickets() {
        let seed = [3u8; 32];
        let mut bm = TicketBitmap { bits_allocated: 64, bits: vec![0] };
        assert_eq!(conduct_lottery(&seed, 0, 50, &mut bm).unwrap(), 0);
    }

    #[test]
    fn test_count_winning_in_ranges_empty() {
        let bm = TicketBitmap { bits_allocated: 64, bits: vec![0] };
        assert_eq!(count_winning_in_ranges(&bm, &[]), 0);
    }

    #[test]
    fn test_count_winning_in_ranges_no_winners() {
        let bm = TicketBitmap { bits_allocated: 64, bits: vec![0] };
        let ranges = vec![
            TicketRange::new(0, 10),
            TicketRange::new(20, 5),
        ];
        assert_eq!(count_winning_in_ranges(&bm, &ranges), 0);
    }

    #[test]
    fn test_count_winning_in_ranges_all_winners() {
        let bm = TicketBitmap { bits_allocated: 64, bits: vec![u64::MAX] };
        let ranges = vec![
            TicketRange::new(0, 10),
            TicketRange::new(20, 5),
        ];
        assert_eq!(count_winning_in_ranges(&bm, &ranges), 15);
    }

    #[test]
    fn test_count_winning_in_ranges_partial() {
        let bm = TicketBitmap { bits_allocated: 64, bits: vec![0b11111111] };
        let ranges = vec![
            TicketRange::new(0, 10),
            TicketRange::new(20, 5),
        ];
        assert_eq!(count_winning_in_ranges(&bm, &ranges), 8);
    }
}
