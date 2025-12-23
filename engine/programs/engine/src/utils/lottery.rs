use anchor_lang::prelude::*;

use crate::{errors::ErrorCode, state::TicketRange, utils::bitmap::TicketBitmap};

pub fn count_winning_in_ranges(bitmap: &TicketBitmap, ranges: &[TicketRange]) -> u64 {
    ranges.iter().map(|r| bitmap.count_ones(r)).sum()
}

pub fn conduct_lottery(
    seed: &[u8; 32],
    capacity: u64,
    bitmap: &mut TicketBitmap,
    withdrawn: &[TicketRange],
) -> Result<u64> {
    let total_withdrawn: u64 = withdrawn.iter().map(|r| r.count()).sum();
    let active_tickets = checked_sub!(bitmap.bits_allocated, total_withdrawn)?;

    if capacity >= active_tickets {
        for i in 0..bitmap.bits_allocated {
            bitmap.set_bit(i, withdrawn);
        }
        return Ok(active_tickets);
    }

    for i in 0..capacity {
        let roll = hash_roll(seed, i, active_tickets);
        bitmap.set_bit(roll, withdrawn).ok_or(ErrorCode::BitmapFull)?;
    }

    Ok(capacity)
}

fn hash_roll(seed: &[u8; 32], i: u64, n: u64) -> u64 {
    use anchor_lang::solana_program::keccak::hash;
    let mut data = [0u8; 40];
    data[..32].copy_from_slice(seed);
    data[32..40].copy_from_slice(&i.to_le_bytes());
    let h = hash(&data);
    let val = u64::from_le_bytes([h.0[0], h.0[1], h.0[2], h.0[3], h.0[4], h.0[5], h.0[6], h.0[7]]);
    val % n
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_no_overflow() {
        let seed = [1u8; 32];
        let mut bm = TicketBitmap { bits_allocated: 64, bits: vec![0] };
        let winners = conduct_lottery(&seed, 100, &mut bm, &[]).unwrap();
        assert_eq!(winners, 64);
        assert_eq!(bm.count_ones(&TicketRange::new(0, 64)), 64);
    }

    #[test]
    fn test_overflow() {
        let seed = [2u8; 32];
        let mut bm = TicketBitmap { bits_allocated: 128, bits: vec![0; 2] };
        let winners = conduct_lottery(&seed, 50, &mut bm, &[]).unwrap();
        assert_eq!(winners, 50);
        assert_eq!(bm.count_ones(&TicketRange::new(0, 128)), 50);
    }

    #[test]
    fn test_zero_tickets() {
        let seed = [3u8; 32];
        let mut bm = TicketBitmap { bits_allocated: 0, bits: vec![] };
        assert_eq!(conduct_lottery(&seed, 50, &mut bm, &[]).unwrap(), 0);
    }

    #[test]
    fn test_with_withdrawn() {
        let seed = [4u8; 32];
        let mut bm = TicketBitmap { bits_allocated: 100, bits: vec![0; 2] };
        let withdrawn = vec![TicketRange::new(10, 30)];
        let winners = conduct_lottery(&seed, 50, &mut bm, &withdrawn).unwrap();
        assert_eq!(winners, 50);
        for i in 10..30 {
            assert!(!bm.get_bit(i));
        }
    }

    #[test]
    fn test_with_withdrawn_all_win() {
        let seed = [5u8; 32];
        let mut bm = TicketBitmap { bits_allocated: 100, bits: vec![0; 2] };
        let withdrawn = vec![TicketRange::new(20, 40)];
        let winners = conduct_lottery(&seed, 100, &mut bm, &withdrawn).unwrap();
        assert_eq!(winners, 80);
        for i in 20..40 {
            assert!(!bm.get_bit(i));
        }
        assert_eq!(bm.count_ones(&TicketRange::new(0, 100)), 80);
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
            TicketRange::new(20, 25),
        ];
        assert_eq!(count_winning_in_ranges(&bm, &ranges), 0);
    }

    #[test]
    fn test_count_winning_in_ranges_all_winners() {
        let bm = TicketBitmap { bits_allocated: 64, bits: vec![u64::MAX] };
        let ranges = vec![
            TicketRange::new(0, 10),
            TicketRange::new(20, 25),
        ];
        assert_eq!(count_winning_in_ranges(&bm, &ranges), 15);
    }

    #[test]
    fn test_count_winning_in_ranges_partial() {
        let bm = TicketBitmap { bits_allocated: 64, bits: vec![0b11111111] };
        let ranges = vec![
            TicketRange::new(0, 10),
            TicketRange::new(20, 25),
        ];
        assert_eq!(count_winning_in_ranges(&bm, &ranges), 8);
    }
}
