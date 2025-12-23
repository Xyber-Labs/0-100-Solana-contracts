use anchor_lang::prelude::*;

use crate::state::TicketRange;
use crate::utils::realloc::Reallocatable;

#[account]
#[derive(Default, InitSpace)]
pub struct TicketBitmap {
    pub bits_allocated: u64,
    #[max_len(0)]
    pub bits: Vec<u64>,
}

impl TicketBitmap {
    pub const BITS_PER_WORD: u64 = 64;

    #[inline]
    pub fn required_words(total_bits: u64) -> usize {
        total_bits.div_ceil(Self::BITS_PER_WORD) as usize
    }

    #[inline]
    pub fn get_bit(&self, index: u64) -> bool {
        let word_idx = (index / Self::BITS_PER_WORD) as usize;
        let bit_pos = index % Self::BITS_PER_WORD;
        self.bits.get(word_idx).map_or(false, |w| (w >> bit_pos) & 1 == 1)
    }

    pub fn set_bit(&mut self, index: u64, withdrawn: &[TicketRange]) -> Option<u64> {
        if index >= self.bits_allocated {
            return None;
        }
        for i in index..self.bits_allocated {
            if self.try_set(i, withdrawn) {
                return Some(i);
            }
        }
        for i in 0..index {
            if self.try_set(i, withdrawn) {
                return Some(i);
            }
        }
        None
    }

    fn try_set(&mut self, index: u64, withdrawn: &[TicketRange]) -> bool {
        if withdrawn.iter().any(|r| r.contains(index)) {
            return false;
        }
        let word_idx = (index / Self::BITS_PER_WORD) as usize;
        let bit_pos = index % Self::BITS_PER_WORD;
        assert!(word_idx < self.bits.len(), "bit index out of bounds");
        let mask = 1u64 << bit_pos;
        if self.bits[word_idx] & mask != 0 {
            return false;
        }
        self.bits[word_idx] |= mask;
        true
    }

    pub fn clear_range(&mut self, range: &TicketRange) {
        for i in range.start..range.end {
            let word_idx = (i / Self::BITS_PER_WORD) as usize;
            let bit_pos = i % Self::BITS_PER_WORD;
            if word_idx < self.bits.len() {
                self.bits[word_idx] &= !(1u64 << bit_pos);
            }
        }
    }

    pub fn set_range(&mut self, range: &TicketRange) {
        for i in range.start..range.end {
            let word_idx = (i / Self::BITS_PER_WORD) as usize;
            let bit_pos = i % Self::BITS_PER_WORD;
            if word_idx < self.bits.len() {
                self.bits[word_idx] |= 1u64 << bit_pos;
            }
        }
    }

    pub fn count_ones(&self, range: &TicketRange) -> u64 {
        let mut result = 0u64;
        for i in range.start..range.end {
            if self.get_bit(i) {
                result += 1;
            }
        }
        result
    }

    pub fn allocate(&mut self, count: u64, winning: bool) -> Option<u64> {
        let start = self.bits_allocated;
        self.bits_allocated = self.bits_allocated.checked_add(count)?;
        self.bits.resize(Self::required_words(self.bits_allocated), 0);
        if winning {
            for i in start..self.bits_allocated {
                let word_idx = (i / Self::BITS_PER_WORD) as usize;
                let bit_pos = i % Self::BITS_PER_WORD;
                self.bits[word_idx] |= 1u64 << bit_pos;
            }
        }
        Some(start)
    }
}

impl Reallocatable for TicketBitmap {
    fn required_space(&self) -> usize {
        8 + Self::INIT_SPACE + self.bits.len() * 8
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_required_words() {
        assert_eq!(TicketBitmap::required_words(0), 0);
        assert_eq!(TicketBitmap::required_words(1), 1);
        assert_eq!(TicketBitmap::required_words(64), 1);
        assert_eq!(TicketBitmap::required_words(65), 2);
        assert_eq!(TicketBitmap::required_words(128), 2);
        assert_eq!(TicketBitmap::required_words(129), 3);
        assert_eq!(TicketBitmap::required_words(1000), 16);
        assert_eq!(TicketBitmap::required_words(18000), 282);
    }

    #[test]
    fn test_get_bit() {
        let bm = TicketBitmap { bits_allocated: 64, bits: vec![0b1010] };
        assert!(!bm.get_bit(0));
        assert!(bm.get_bit(1));
        assert!(!bm.get_bit(2));
        assert!(bm.get_bit(3));
        assert!(!bm.get_bit(100));
    }

    #[test]
    fn test_get_bit_second_word() {
        let bm = TicketBitmap { bits_allocated: 128, bits: vec![0, 0b101] };
        assert!(!bm.get_bit(63));
        assert!(bm.get_bit(64));
        assert!(!bm.get_bit(65));
        assert!(bm.get_bit(66));
    }

    #[test]
    fn test_set_bit_simple() {
        let mut bm = TicketBitmap { bits_allocated: 128, bits: vec![0; 2] };
        assert_eq!(bm.set_bit(5, &[]), Some(5));
        assert!(bm.get_bit(5));
    }

    #[test]
    fn test_set_bit_second_word() {
        let mut bm = TicketBitmap { bits_allocated: 128, bits: vec![0; 2] };
        assert_eq!(bm.set_bit(70, &[]), Some(70));
        assert!(bm.get_bit(70));
    }

    #[test]
    fn test_set_bit_collision() {
        let mut bm = TicketBitmap { bits_allocated: 64, bits: vec![0b111] };
        assert_eq!(bm.set_bit(0, &[]), Some(3));
    }

    #[test]
    fn test_set_bit_collision_cross_word() {
        let mut bm = TicketBitmap { bits_allocated: 128, bits: vec![u64::MAX, 0] };
        assert_eq!(bm.set_bit(60, &[]), Some(64));
    }

    #[test]
    fn test_set_bit_wraparound() {
        let mut bm = TicketBitmap { bits_allocated: 64, bits: vec![!0b11] };
        assert_eq!(bm.set_bit(60, &[]), Some(0));
    }

    #[test]
    fn test_set_bit_wraparound_cross_word() {
        let mut bm = TicketBitmap { bits_allocated: 128, bits: vec![0b1, u64::MAX] };
        assert_eq!(bm.set_bit(100, &[]), Some(1));
    }

    #[test]
    fn test_set_bit_full() {
        let mut bm = TicketBitmap { bits_allocated: 64, bits: vec![u64::MAX] };
        assert_eq!(bm.set_bit(0, &[]), None);
    }

    #[test]
    fn test_set_bit_out_of_bounds() {
        let mut bm = TicketBitmap { bits_allocated: 64, bits: vec![0] };
        assert_eq!(bm.set_bit(100, &[]), None);
    }

    #[test]
    fn test_set_bit_skips_withdrawn() {
        let mut bm = TicketBitmap { bits_allocated: 64, bits: vec![0] };
        let withdrawn = vec![TicketRange::new(5, 10)];
        assert_eq!(bm.set_bit(5, &withdrawn), Some(10));
        assert!(!bm.get_bit(5));
        assert!(bm.get_bit(10));
    }

    #[test]
    fn test_set_bit_skips_withdrawn_wraparound() {
        let mut bm = TicketBitmap { bits_allocated: 64, bits: vec![0b1111] };
        let withdrawn = vec![TicketRange::new(4, 10)];
        assert_eq!(bm.set_bit(4, &withdrawn), Some(10));
    }

    #[test]
    fn test_count_ones_empty() {
        let bm = TicketBitmap { bits_allocated: 128, bits: vec![0; 2] };
        assert_eq!(bm.count_ones(&TicketRange::new(0, 128)), 0);
    }

    #[test]
    fn test_count_ones_all_set() {
        let bm = TicketBitmap { bits_allocated: 64, bits: vec![u64::MAX] };
        assert_eq!(bm.count_ones(&TicketRange::new(0, 64)), 64);
    }

    #[test]
    fn test_count_ones_partial() {
        let bm = TicketBitmap { bits_allocated: 64, bits: vec![0b11111] };
        assert_eq!(bm.count_ones(&TicketRange::new(0, 10)), 5);
        assert_eq!(bm.count_ones(&TicketRange::new(0, 5)), 5);
        assert_eq!(bm.count_ones(&TicketRange::new(2, 7)), 3);
    }

    #[test]
    fn test_count_ones_cross_word() {
        let bm = TicketBitmap { bits_allocated: 128, bits: vec![u64::MAX, 0b1111] };
        assert_eq!(bm.count_ones(&TicketRange::new(60, 70)), 8);
    }

    #[test]
    fn test_allocate() {
        let mut bm = TicketBitmap::default();
        assert_eq!(bm.allocate(10, false), Some(0));
        assert_eq!(bm.bits_allocated, 10);
        assert_eq!(bm.bits.len(), 1);

        assert_eq!(bm.allocate(60, false), Some(10));
        assert_eq!(bm.bits_allocated, 70);
        assert_eq!(bm.bits.len(), 2);
    }

    #[test]
    fn test_allocate_overflow() {
        let mut bm = TicketBitmap { bits_allocated: u64::MAX - 5, bits: vec![] };
        assert_eq!(bm.allocate(10, false), None);
    }

    #[test]
    fn test_allocate_winning() {
        let mut bm = TicketBitmap::default();
        bm.allocate(60, false);
        bm.allocate(10, true);
        bm.allocate(10, false);

        assert!(!bm.get_bit(0));
        assert!(!bm.get_bit(59));
        assert!(bm.get_bit(60));
        assert!(bm.get_bit(69));
        assert!(!bm.get_bit(70));
        assert_eq!(bm.count_ones(&TicketRange::new(0, 80)), 10);
    }

    #[test]
    fn test_clear_range() {
        let mut bm = TicketBitmap::default();
        bm.allocate(10, true);
        assert_eq!(bm.count_ones(&TicketRange::new(0, 10)), 10);

        bm.clear_range(&TicketRange::new(3, 7));
        assert!(bm.get_bit(2));
        assert!(!bm.get_bit(3));
        assert!(!bm.get_bit(6));
        assert!(bm.get_bit(7));
        assert_eq!(bm.count_ones(&TicketRange::new(0, 10)), 6);
    }
}
