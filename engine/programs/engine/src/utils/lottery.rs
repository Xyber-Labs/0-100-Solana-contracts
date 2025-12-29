use anchor_lang::{prelude::*, solana_program::keccak::hash};

use crate::{errors::ErrorCode, state::TicketRange, utils::realloc::Reallocatable};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Debug)]
pub enum LotteryStatus {
    InProgress { _padding: u64 },
    Finalized { tokens_per_ticket: u64 },
    Cancelled { _padding: u64 },
}

impl Default for LotteryStatus {
    fn default() -> Self {
        LotteryStatus::InProgress { _padding: 0 }
    }
}

#[account]
#[derive(Default, InitSpace)]
pub struct Lottery {
    pub bits_allocated: u64,
    pub inactive: u64,
    pub status: LotteryStatus,
    #[max_len(0)]
    pub bits: Vec<u64>,
}

impl Lottery {
    pub const BITS_PER_WORD: u64 = 64;

    pub fn is_in_progress(&self) -> bool {
        matches!(self.status, LotteryStatus::InProgress { .. })
    }

    pub fn is_finalized(&self) -> bool {
        matches!(self.status, LotteryStatus::Finalized { .. })
    }

    pub fn is_cancelled(&self) -> bool {
        matches!(self.status, LotteryStatus::Cancelled { .. })
    }

    pub fn active_tickets(&self) -> u64 {
        self.bits_allocated - self.inactive
    }

    pub fn sale_allocation(&self, ranges: &[TicketRange]) -> u64 {
        let LotteryStatus::Finalized { tokens_per_ticket } = self.status else {
            panic!("Expected be finalized")
        };
        self.count_winning_in_ranges(ranges) * tokens_per_ticket
    }

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

    pub fn count_winning_in_ranges(&self, ranges: &[TicketRange]) -> u64 {
        ranges.iter().map(|r| self.count_ones(r)).sum()
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

    pub fn finalize(
        &mut self,
        seed: &[u8; 32],
        capacity: u64,
        withdrawn: &[TicketRange],
        total_tokens: u64,
    ) -> Result<u64> {
        assert!(self.bits_allocated > 0);

        let active_tickets = self.active_tickets();

        let winners = if capacity >= active_tickets {
            for i in 0..self.bits_allocated {
                self.set_bit(i, withdrawn);
            }
            active_tickets
        } else {
            for i in 0..capacity {
                let roll = Self::hash_roll(seed, i, active_tickets);
                self.set_bit(roll, withdrawn).ok_or(ErrorCode::BitmapFull)?;
            }
            capacity
        };

        self.status = LotteryStatus::Finalized {
            tokens_per_ticket: total_tokens / winners,
        };

        Ok(winners)
    }

    fn hash_roll(seed: &[u8; 32], i: u64, n: u64) -> u64 {
        let mut data = [0u8; 40];
        data[..32].copy_from_slice(seed);
        data[32..40].copy_from_slice(&i.to_le_bytes());
        let h = hash(&data);
        let val = u64::from_le_bytes([
            h.0[0], h.0[1], h.0[2], h.0[3], h.0[4], h.0[5], h.0[6], h.0[7],
        ]);
        val % n
    }
}

impl Reallocatable for Lottery {
    fn required_space(&self) -> usize {
        8 + Self::INIT_SPACE + self.bits.len() * 8
    }
}

pub struct LotteryRaw;

impl LotteryRaw {
    pub const BITS_PER_WORD: u64 = 64;
    const BITS_ALLOCATED_OFFSET: usize = 0;
    const INACTIVE_OFFSET: usize = 8;
    const STATUS_OFFSET: usize = 16;
    const VEC_LEN_OFFSET: usize = 25;
    const BITS_DATA_OFFSET: usize = 29;

    #[inline]
    pub fn required_words(total_bits: u64) -> usize {
        total_bits.div_ceil(Self::BITS_PER_WORD) as usize
    }

    #[inline]
    pub fn read_bits_allocated(data: &[u8]) -> u64 {
        u64::from_le_bytes(
            data[Self::BITS_ALLOCATED_OFFSET..Self::BITS_ALLOCATED_OFFSET + 8].try_into().unwrap(),
        )
    }

    #[inline]
    pub fn write_bits_allocated(data: &mut [u8], value: u64) {
        data[Self::BITS_ALLOCATED_OFFSET..Self::BITS_ALLOCATED_OFFSET + 8]
            .copy_from_slice(&value.to_le_bytes());
    }

    #[inline]
    pub fn read_inactive(data: &[u8]) -> u64 {
        u64::from_le_bytes(
            data[Self::INACTIVE_OFFSET..Self::INACTIVE_OFFSET + 8].try_into().unwrap(),
        )
    }

    #[inline]
    pub fn write_inactive(data: &mut [u8], value: u64) {
        data[Self::INACTIVE_OFFSET..Self::INACTIVE_OFFSET + 8]
            .copy_from_slice(&value.to_le_bytes());
    }

    #[inline]
    pub fn active_tickets(data: &[u8]) -> u64 {
        Self::read_bits_allocated(data) - Self::read_inactive(data)
    }

    #[inline]
    pub fn read_status_tag(data: &[u8]) -> u8 {
        data[Self::STATUS_OFFSET]
    }

    #[inline]
    pub fn is_in_progress(data: &[u8]) -> bool {
        Self::read_status_tag(data) == 0
    }

    #[inline]
    pub fn is_finalized(data: &[u8]) -> bool {
        Self::read_status_tag(data) == 1
    }

    #[inline]
    pub fn is_cancelled(data: &[u8]) -> bool {
        Self::read_status_tag(data) == 2
    }

    #[inline]
    pub fn read_tokens_per_ticket(data: &[u8]) -> u64 {
        u64::from_le_bytes(
            data[Self::STATUS_OFFSET + 1..Self::STATUS_OFFSET + 9].try_into().unwrap(),
        )
    }

    #[inline]
    pub fn write_status_finalized(data: &mut [u8], tokens_per_ticket: u64) {
        data[Self::STATUS_OFFSET] = 1;
        data[Self::STATUS_OFFSET + 1..Self::STATUS_OFFSET + 9]
            .copy_from_slice(&tokens_per_ticket.to_le_bytes());
    }

    #[inline]
    pub fn read_vec_len(data: &[u8]) -> u32 {
        u32::from_le_bytes(data[Self::VEC_LEN_OFFSET..Self::VEC_LEN_OFFSET + 4].try_into().unwrap())
    }

    #[inline]
    pub fn write_vec_len(data: &mut [u8], len: u32) {
        data[Self::VEC_LEN_OFFSET..Self::VEC_LEN_OFFSET + 4].copy_from_slice(&len.to_le_bytes());
    }

    pub fn required_space(bits_allocated: u64) -> usize {
        Self::BITS_DATA_OFFSET + Self::required_words(bits_allocated) * 8
    }

    #[inline]
    pub fn get_bit(data: &[u8], index: u64) -> bool {
        let word_idx = (index / Self::BITS_PER_WORD) as usize;
        let bit_pos = index % Self::BITS_PER_WORD;
        let vec_len = Self::read_vec_len(data) as usize;
        if word_idx >= vec_len {
            return false;
        }
        let word_offset = Self::BITS_DATA_OFFSET + word_idx * 8;
        let word = u64::from_le_bytes(data[word_offset..word_offset + 8].try_into().unwrap());
        (word >> bit_pos) & 1 == 1
    }

    #[inline]
    fn set_bit_direct(data: &mut [u8], index: u64) {
        let word_idx = (index / Self::BITS_PER_WORD) as usize;
        let bit_pos = index % Self::BITS_PER_WORD;
        let word_offset = Self::BITS_DATA_OFFSET + word_idx * 8;
        let mut word = u64::from_le_bytes(data[word_offset..word_offset + 8].try_into().unwrap());
        word |= 1u64 << bit_pos;
        data[word_offset..word_offset + 8].copy_from_slice(&word.to_le_bytes());
    }

    #[inline]
    fn clear_bit_direct(data: &mut [u8], index: u64) {
        let word_idx = (index / Self::BITS_PER_WORD) as usize;
        let bit_pos = index % Self::BITS_PER_WORD;
        let word_offset = Self::BITS_DATA_OFFSET + word_idx * 8;
        let mut word = u64::from_le_bytes(data[word_offset..word_offset + 8].try_into().unwrap());
        word &= !(1u64 << bit_pos);
        data[word_offset..word_offset + 8].copy_from_slice(&word.to_le_bytes());
    }

    fn try_set(data: &mut [u8], index: u64, withdrawn: &[TicketRange]) -> bool {
        // if withdrawn.iter().any(|r| r.contains(index)) {
        //     return false;
        // }
        if Self::get_bit(data, index) {
            return false;
        }
        Self::set_bit_direct(data, index);
        true
    }

    pub fn set_bit(data: &mut [u8], index: u64, withdrawn: &[TicketRange]) -> Option<u64> {
        let bits_allocated = Self::read_bits_allocated(data);
        if index >= bits_allocated {
            return None;
        }
        for i in index..bits_allocated {
            if Self::try_set(data, i, withdrawn) {
                return Some(i);
            }
        }
        for i in 0..index {
            if Self::try_set(data, i, withdrawn) {
                return Some(i);
            }
        }
        None
    }

    pub fn clear_range(data: &mut [u8], range: &TicketRange) {
        let vec_len = Self::read_vec_len(data) as usize;
        for i in range.start..range.end {
            let word_idx = (i / Self::BITS_PER_WORD) as usize;
            if word_idx < vec_len {
                Self::clear_bit_direct(data, i);
            }
        }
    }

    pub fn set_range(data: &mut [u8], range: &TicketRange) {
        let vec_len = Self::read_vec_len(data) as usize;
        for i in range.start..range.end {
            let word_idx = (i / Self::BITS_PER_WORD) as usize;
            if word_idx < vec_len {
                Self::set_bit_direct(data, i);
            }
        }
    }

    pub fn count_ones(data: &[u8], range: &TicketRange) -> u64 {
        let mut result = 0u64;
        for i in range.start..range.end {
            if Self::get_bit(data, i) {
                result += 1;
            }
        }
        result
    }

    pub fn count_winning_in_ranges(data: &[u8], ranges: &[TicketRange]) -> u64 {
        ranges.iter().map(|r| Self::count_ones(data, r)).sum()
    }

    fn hash_roll(seed: &[u8; 32], i: u64, n: u64) -> u64 {
        let mut buf = [0u8; 40];
        buf[..32].copy_from_slice(seed);
        buf[32..40].copy_from_slice(&i.to_le_bytes());
        let h = hash(&buf);
        let val = u64::from_le_bytes([
            h.0[0], h.0[1], h.0[2], h.0[3], h.0[4], h.0[5], h.0[6], h.0[7],
        ]);
        val % n
    }

    pub fn finalize(
        data: &mut [u8],
        seed: &[u8; 32],
        capacity: u64,
        withdrawn: &[TicketRange],
        total_tokens: u64,
    ) -> Result<u64> {
        let bits_allocated = Self::read_bits_allocated(data);
        assert!(bits_allocated > 0);

        let active_tickets = Self::active_tickets(data);

        let winners = if capacity >= active_tickets {
            for i in 0..bits_allocated {
                Self::set_bit(data, i, withdrawn);
            }
            active_tickets
        } else {
            for i in 0..capacity {
                let roll = Self::hash_roll(seed, i, active_tickets);
                Self::set_bit(data, roll, withdrawn).ok_or(ErrorCode::BitmapFull)?;
            }
            capacity
        };

        let tokens_per_ticket = total_tokens / winners;
        Self::write_status_finalized(data, tokens_per_ticket);

        Ok(winners)
    }

    pub fn sale_allocation(data: &[u8], ranges: &[TicketRange]) -> u64 {
        assert!(Self::is_finalized(data), "Expected be finalized");
        let tokens_per_ticket = Self::read_tokens_per_ticket(data);
        Self::count_winning_in_ranges(data, ranges) * tokens_per_ticket
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn finalized_lottery(tokens_per_ticket: u64, bits: Vec<u64>) -> Lottery {
        Lottery {
            bits_allocated: bits.len() as u64 * 64,
            inactive: 0,
            status: LotteryStatus::Finalized { tokens_per_ticket },
            bits,
        }
    }

    fn lottery_to_bytes(lottery: &Lottery) -> Vec<u8> {
        let mut data = vec![0u8; 29 + lottery.bits.len() * 8];
        data[0..8].copy_from_slice(&lottery.bits_allocated.to_le_bytes());
        data[8..16].copy_from_slice(&lottery.inactive.to_le_bytes());
        match lottery.status {
            LotteryStatus::InProgress { .. } => data[16] = 0,
            LotteryStatus::Finalized { tokens_per_ticket } => {
                data[16] = 1;
                data[17..25].copy_from_slice(&tokens_per_ticket.to_le_bytes());
            }
            LotteryStatus::Cancelled { .. } => data[16] = 2,
        }
        data[25..29].copy_from_slice(&(lottery.bits.len() as u32).to_le_bytes());
        for (i, word) in lottery.bits.iter().enumerate() {
            data[29 + i * 8..29 + (i + 1) * 8].copy_from_slice(&word.to_le_bytes());
        }
        data
    }

    #[test]
    fn test_sale_allocation_all_winning() {
        let lottery = finalized_lottery(1000, vec![0b1111]);
        let ranges = vec![TicketRange::new(0, 4)];
        assert_eq!(lottery.sale_allocation(&ranges), 4 * 1000);
    }

    #[test]
    fn test_sale_allocation_partial_winning() {
        let lottery = finalized_lottery(500, vec![0b1010]);
        let ranges = vec![TicketRange::new(0, 4)];
        assert_eq!(lottery.sale_allocation(&ranges), 2 * 500);
    }

    #[test]
    fn test_sale_allocation_no_winning() {
        let lottery = finalized_lottery(1000, vec![0b0000]);
        let ranges = vec![TicketRange::new(0, 4)];
        assert_eq!(lottery.sale_allocation(&ranges), 0);
    }

    #[test]
    fn test_sale_allocation_multiple_ranges() {
        let lottery = finalized_lottery(100, vec![0b11111111]);
        let ranges = vec![TicketRange::new(0, 3), TicketRange::new(5, 8)];
        assert_eq!(lottery.sale_allocation(&ranges), 6 * 100);
    }

    #[test]
    #[should_panic(expected = "Expected be finalized")]
    fn test_sale_allocation_not_finalized() {
        let lottery = Lottery::default();
        let ranges = vec![TicketRange::new(0, 4)];
        lottery.sale_allocation(&ranges);
    }

    #[test]
    fn test_raw_get_bit() {
        let lottery = Lottery {
            bits_allocated: 64,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0b1010],
        };
        let data = lottery_to_bytes(&lottery);
        assert!(!LotteryRaw::get_bit(&data, 0));
        assert!(LotteryRaw::get_bit(&data, 1));
        assert!(!LotteryRaw::get_bit(&data, 2));
        assert!(LotteryRaw::get_bit(&data, 3));
        assert!(!LotteryRaw::get_bit(&data, 100));
        assert_eq!(lottery.get_bit(0), LotteryRaw::get_bit(&data, 0));
        assert_eq!(lottery.get_bit(1), LotteryRaw::get_bit(&data, 1));
        assert_eq!(lottery.get_bit(2), LotteryRaw::get_bit(&data, 2));
        assert_eq!(lottery.get_bit(3), LotteryRaw::get_bit(&data, 3));
    }

    #[test]
    fn test_raw_get_bit_second_word() {
        let lottery = Lottery {
            bits_allocated: 128,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0b0, 0b101],
        };
        let data = lottery_to_bytes(&lottery);
        assert!(!LotteryRaw::get_bit(&data, 63));
        assert!(LotteryRaw::get_bit(&data, 64));
        assert!(!LotteryRaw::get_bit(&data, 65));
        assert!(LotteryRaw::get_bit(&data, 66));
        assert_eq!(lottery.get_bit(63), LotteryRaw::get_bit(&data, 63));
        assert_eq!(lottery.get_bit(64), LotteryRaw::get_bit(&data, 64));
        assert_eq!(lottery.get_bit(65), LotteryRaw::get_bit(&data, 65));
        assert_eq!(lottery.get_bit(66), LotteryRaw::get_bit(&data, 66));
    }

    #[test]
    fn test_raw_set_bit_simple() {
        let mut lottery = Lottery {
            bits_allocated: 128,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0b0; 2],
        };
        let mut data = lottery_to_bytes(&lottery);
        assert_eq!(LotteryRaw::set_bit(&mut data, 5, &[]), Some(5));
        assert_eq!(lottery.set_bit(5, &[]), Some(5));
        assert!(LotteryRaw::get_bit(&data, 5));
        assert!(lottery.get_bit(5));
    }

    #[test]
    fn test_raw_set_bit_collision() {
        let mut lottery = Lottery {
            bits_allocated: 64,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0b111],
        };
        let mut data = lottery_to_bytes(&lottery);
        assert_eq!(LotteryRaw::set_bit(&mut data, 0, &[]), Some(3));
        assert_eq!(lottery.set_bit(0, &[]), Some(3));
    }

    #[test]
    fn test_raw_set_bit_collision_cross_word() {
        let mut lottery = Lottery {
            bits_allocated: 128,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![u64::MAX, 0b0],
        };
        let mut data = lottery_to_bytes(&lottery);
        assert_eq!(LotteryRaw::set_bit(&mut data, 60, &[]), Some(64));
        assert_eq!(lottery.set_bit(60, &[]), Some(64));
    }

    #[test]
    fn test_raw_set_bit_wraparound() {
        let mut lottery = Lottery {
            bits_allocated: 64,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![!0b11],
        };
        let mut data = lottery_to_bytes(&lottery);
        assert_eq!(LotteryRaw::set_bit(&mut data, 60, &[]), Some(0));
        assert_eq!(lottery.set_bit(60, &[]), Some(0));
    }

    #[test]
    fn test_raw_set_bit_full() {
        let mut lottery = Lottery {
            bits_allocated: 64,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![u64::MAX],
        };
        let mut data = lottery_to_bytes(&lottery);
        assert_eq!(LotteryRaw::set_bit(&mut data, 0, &[]), None);
        assert_eq!(lottery.set_bit(0, &[]), None);
    }

    #[test]
    fn test_raw_set_bit_out_of_bounds() {
        let mut lottery = Lottery {
            bits_allocated: 64,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0b0],
        };
        let mut data = lottery_to_bytes(&lottery);
        assert_eq!(LotteryRaw::set_bit(&mut data, 100, &[]), None);
        assert_eq!(lottery.set_bit(100, &[]), None);
    }

    #[test]
    fn test_raw_set_bit_skips_withdrawn() {
        let mut lottery = Lottery {
            bits_allocated: 64,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0b0],
        };
        let mut data = lottery_to_bytes(&lottery);
        let withdrawn = vec![TicketRange::new(5, 10)];
        assert_eq!(LotteryRaw::set_bit(&mut data, 5, &withdrawn), Some(10));
        assert_eq!(lottery.set_bit(5, &withdrawn), Some(10));
        assert!(!LotteryRaw::get_bit(&data, 5));
        assert!(LotteryRaw::get_bit(&data, 10));
    }

    #[test]
    fn test_raw_count_ones() {
        let lottery = Lottery {
            bits_allocated: 64,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0b11111],
        };
        let data = lottery_to_bytes(&lottery);
        let range = TicketRange::new(0, 10);
        assert_eq!(LotteryRaw::count_ones(&data, &range), 5);
        assert_eq!(lottery.count_ones(&range), LotteryRaw::count_ones(&data, &range));
    }

    #[test]
    fn test_raw_count_ones_cross_word() {
        let lottery = Lottery {
            bits_allocated: 128,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![u64::MAX, 0b1111],
        };
        let data = lottery_to_bytes(&lottery);
        let range = TicketRange::new(60, 70);
        assert_eq!(LotteryRaw::count_ones(&data, &range), 8);
        assert_eq!(lottery.count_ones(&range), LotteryRaw::count_ones(&data, &range));
    }

    #[test]
    fn test_raw_finalize_no_overflow() {
        let seed = [1u8; 32];
        let mut lottery = Lottery {
            bits_allocated: 64,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0b0],
        };
        let mut data = lottery_to_bytes(&lottery);
        let raw_winners = LotteryRaw::finalize(&mut data, &seed, 100, &[], 64000).unwrap();
        let lottery_winners = lottery.finalize(&seed, 100, &[], 64000).unwrap();
        assert_eq!(raw_winners, 64);
        assert_eq!(lottery_winners, raw_winners);
        assert_eq!(LotteryRaw::count_ones(&data, &TicketRange::new(0, 64)), 64);
        assert!(LotteryRaw::is_finalized(&data));
        assert_eq!(LotteryRaw::read_tokens_per_ticket(&data), 1000);
    }

    #[test]
    fn test_raw_finalize_overflow() {
        let seed = [2u8; 32];
        let mut lottery = Lottery {
            bits_allocated: 128,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0b0; 2],
        };
        let mut data = lottery_to_bytes(&lottery);
        let raw_winners = LotteryRaw::finalize(&mut data, &seed, 50, &[], 50000).unwrap();
        let lottery_winners = lottery.finalize(&seed, 50, &[], 50000).unwrap();
        assert_eq!(raw_winners, 50);
        assert_eq!(lottery_winners, raw_winners);
        assert_eq!(LotteryRaw::count_ones(&data, &TicketRange::new(0, 128)), 50);
        assert!(LotteryRaw::is_finalized(&data));
        assert_eq!(LotteryRaw::read_tokens_per_ticket(&data), 1000);
    }

    #[test]
    fn test_raw_finalize_with_withdrawn() {
        let seed = [4u8; 32];
        let mut lottery = Lottery {
            bits_allocated: 100,
            inactive: 20,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0b0; 2],
        };
        let mut data = lottery_to_bytes(&lottery);
        let withdrawn = vec![TicketRange::new(10, 30)];
        let raw_winners = LotteryRaw::finalize(&mut data, &seed, 50, &withdrawn, 50000).unwrap();
        let lottery_winners = lottery.finalize(&seed, 50, &withdrawn, 50000).unwrap();
        assert_eq!(raw_winners, 50);
        assert_eq!(lottery_winners, raw_winners);
        for i in 10..30 {
            assert!(!LotteryRaw::get_bit(&data, i));
        }
        assert!(LotteryRaw::is_finalized(&data));
    }

    #[test]
    fn test_raw_sale_allocation() {
        let lottery = finalized_lottery(1000, vec![0b1111]);
        let data = lottery_to_bytes(&lottery);
        let ranges = vec![TicketRange::new(0, 4)];
        assert_eq!(LotteryRaw::sale_allocation(&data, &ranges), 4 * 1000);
        assert_eq!(lottery.sale_allocation(&ranges), LotteryRaw::sale_allocation(&data, &ranges));
    }

    #[test]
    fn test_raw_clear_range() {
        let mut lottery = Lottery {
            bits_allocated: 64,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![u64::MAX],
        };
        let mut data = lottery_to_bytes(&lottery);
        let range = TicketRange::new(10, 20);
        LotteryRaw::clear_range(&mut data, &range);
        lottery.clear_range(&range);
        for i in 10..20 {
            assert!(!LotteryRaw::get_bit(&data, i));
            assert!(!lottery.get_bit(i));
        }
        assert!(LotteryRaw::get_bit(&data, 9));
        assert!(LotteryRaw::get_bit(&data, 20));
    }

    #[test]
    fn test_raw_set_range() {
        let mut lottery = Lottery {
            bits_allocated: 64,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0b0],
        };
        let mut data = lottery_to_bytes(&lottery);
        let range = TicketRange::new(10, 20);
        LotteryRaw::set_range(&mut data, &range);
        lottery.set_range(&range);
        for i in 10..20 {
            assert!(LotteryRaw::get_bit(&data, i));
            assert!(lottery.get_bit(i));
        }
        assert!(!LotteryRaw::get_bit(&data, 9));
        assert!(!LotteryRaw::get_bit(&data, 20));
    }
}
