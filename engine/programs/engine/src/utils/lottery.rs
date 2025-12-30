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
            let mut set_count = 0u64;
            let n = active_tickets as u32;
            for batch_idx in 0..capacity.div_ceil(8) {
                let rolls = Self::hash_roll_batch(seed, batch_idx);
                for roll in rolls {
                    if set_count >= capacity {
                        break;
                    }
                    self.set_bit((roll % n) as u64, withdrawn).ok_or(ErrorCode::BitmapFull)?;
                    set_count += 1;
                }
            }
            capacity
        };

        self.status = LotteryStatus::Finalized {
            tokens_per_ticket: total_tokens / winners,
        };

        Ok(winners)
    }

    fn hash_roll_batch(seed: &[u8; 32], i: u64) -> [u32; 8] {
        let mut data = [0u8; 40];
        data[..32].copy_from_slice(seed);
        data[32..40].copy_from_slice(&i.to_le_bytes());
        let h = hash(&data);
        [
            u32::from_le_bytes([h.0[0], h.0[1], h.0[2], h.0[3]]),
            u32::from_le_bytes([h.0[4], h.0[5], h.0[6], h.0[7]]),
            u32::from_le_bytes([h.0[8], h.0[9], h.0[10], h.0[11]]),
            u32::from_le_bytes([h.0[12], h.0[13], h.0[14], h.0[15]]),
            u32::from_le_bytes([h.0[16], h.0[17], h.0[18], h.0[19]]),
            u32::from_le_bytes([h.0[20], h.0[21], h.0[22], h.0[23]]),
            u32::from_le_bytes([h.0[24], h.0[25], h.0[26], h.0[27]]),
            u32::from_le_bytes([h.0[28], h.0[29], h.0[30], h.0[31]]),
        ]
    }
}

impl Reallocatable for Lottery {
    fn required_space(&self) -> usize {
        8 + Self::INIT_SPACE + self.bits.len() * 8
    }
}

pub struct LotteryRaw<T>(pub T);

impl<T> LotteryRaw<T> {
    pub const BITS_PER_WORD: u64 = 64;
    const BITS_ALLOCATED_OFFSET: usize = 0;
    const INACTIVE_OFFSET: usize = 8;
    const STATUS_OFFSET: usize = 16;
    const VEC_LEN_OFFSET: usize = 25;
    const BITS_DATA_OFFSET: usize = 29;

    pub fn new(data: T) -> Self {
        Self(data)
    }

    #[inline]
    pub fn required_words(total_bits: u64) -> usize {
        total_bits.div_ceil(Self::BITS_PER_WORD) as usize
    }

    pub fn required_space(bits_allocated: u64) -> usize {
        Self::BITS_DATA_OFFSET + Self::required_words(bits_allocated) * 8
    }

    fn hash_roll_batch(seed: &[u8; 32], i: u64) -> [u32; 8] {
        let mut buf = [0u8; 40];
        buf[..32].copy_from_slice(seed);
        buf[32..40].copy_from_slice(&i.to_le_bytes());
        let h = hash(&buf);
        [
            u32::from_le_bytes([h.0[0], h.0[1], h.0[2], h.0[3]]),
            u32::from_le_bytes([h.0[4], h.0[5], h.0[6], h.0[7]]),
            u32::from_le_bytes([h.0[8], h.0[9], h.0[10], h.0[11]]),
            u32::from_le_bytes([h.0[12], h.0[13], h.0[14], h.0[15]]),
            u32::from_le_bytes([h.0[16], h.0[17], h.0[18], h.0[19]]),
            u32::from_le_bytes([h.0[20], h.0[21], h.0[22], h.0[23]]),
            u32::from_le_bytes([h.0[24], h.0[25], h.0[26], h.0[27]]),
            u32::from_le_bytes([h.0[28], h.0[29], h.0[30], h.0[31]]),
        ]
    }
}

impl<T: AsRef<[u8]>> LotteryRaw<T> {
    #[inline]
    pub fn bits_allocated(&self) -> u64 {
        let data = self.0.as_ref();
        u64::from_le_bytes(
            data[Self::BITS_ALLOCATED_OFFSET..Self::BITS_ALLOCATED_OFFSET + 8].try_into().unwrap(),
        )
    }

    #[inline]
    pub fn inactive(&self) -> u64 {
        let data = self.0.as_ref();
        u64::from_le_bytes(
            data[Self::INACTIVE_OFFSET..Self::INACTIVE_OFFSET + 8].try_into().unwrap(),
        )
    }

    #[inline]
    pub fn active_tickets(&self) -> u64 {
        self.bits_allocated() - self.inactive()
    }

    #[inline]
    fn status_tag(&self) -> u8 {
        self.0.as_ref()[Self::STATUS_OFFSET]
    }

    #[inline]
    pub fn is_in_progress(&self) -> bool {
        self.status_tag() == 0
    }

    #[inline]
    pub fn is_finalized(&self) -> bool {
        self.status_tag() == 1
    }

    #[inline]
    pub fn is_cancelled(&self) -> bool {
        self.status_tag() == 2
    }

    #[inline]
    pub fn tokens_per_ticket(&self) -> u64 {
        let data = self.0.as_ref();
        u64::from_le_bytes(
            data[Self::STATUS_OFFSET + 1..Self::STATUS_OFFSET + 9].try_into().unwrap(),
        )
    }

    #[inline]
    pub fn vec_len(&self) -> u32 {
        let data = self.0.as_ref();
        u32::from_le_bytes(data[Self::VEC_LEN_OFFSET..Self::VEC_LEN_OFFSET + 4].try_into().unwrap())
    }

    #[inline]
    pub fn get_bit(&self, index: u64) -> bool {
        let data = self.0.as_ref();
        let word_idx = (index / Self::BITS_PER_WORD) as usize;
        let bit_pos = index % Self::BITS_PER_WORD;
        let vec_len = self.vec_len() as usize;
        if word_idx >= vec_len {
            return false;
        }
        let word_offset = Self::BITS_DATA_OFFSET + word_idx * 8;
        let word = u64::from_le_bytes(data[word_offset..word_offset + 8].try_into().unwrap());
        (word >> bit_pos) & 1 == 1
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

    pub fn sale_allocation(&self, ranges: &[TicketRange]) -> u64 {
        assert!(self.is_finalized(), "Expected be finalized");
        self.count_winning_in_ranges(ranges) * self.tokens_per_ticket()
    }
}

impl<T: AsMut<[u8]> + AsRef<[u8]>> LotteryRaw<T> {
    #[inline]
    pub fn set_bits_allocated(&mut self, value: u64) {
        let data = self.0.as_mut();
        data[Self::BITS_ALLOCATED_OFFSET..Self::BITS_ALLOCATED_OFFSET + 8]
            .copy_from_slice(&value.to_le_bytes());
    }

    #[inline]
    pub fn set_inactive(&mut self, value: u64) {
        let data = self.0.as_mut();
        data[Self::INACTIVE_OFFSET..Self::INACTIVE_OFFSET + 8]
            .copy_from_slice(&value.to_le_bytes());
    }

    #[inline]
    fn set_status_finalized(&mut self, tokens_per_ticket: u64) {
        let data = self.0.as_mut();
        data[Self::STATUS_OFFSET] = 1;
        data[Self::STATUS_OFFSET + 1..Self::STATUS_OFFSET + 9]
            .copy_from_slice(&tokens_per_ticket.to_le_bytes());
    }

    #[inline]
    pub fn set_vec_len(&mut self, len: u32) {
        let data = self.0.as_mut();
        data[Self::VEC_LEN_OFFSET..Self::VEC_LEN_OFFSET + 4].copy_from_slice(&len.to_le_bytes());
    }

    #[inline]
    fn set_bit_direct(&mut self, index: u64) {
        let data = self.0.as_mut();
        let word_idx = (index / Self::BITS_PER_WORD) as usize;
        let bit_pos = index % Self::BITS_PER_WORD;
        let word_offset = Self::BITS_DATA_OFFSET + word_idx * 8;
        let mut word = u64::from_le_bytes(data[word_offset..word_offset + 8].try_into().unwrap());
        word |= 1u64 << bit_pos;
        data[word_offset..word_offset + 8].copy_from_slice(&word.to_le_bytes());
    }

    #[inline]
    fn clear_bit_direct(&mut self, index: u64) {
        let data = self.0.as_mut();
        let word_idx = (index / Self::BITS_PER_WORD) as usize;
        let bit_pos = index % Self::BITS_PER_WORD;
        let word_offset = Self::BITS_DATA_OFFSET + word_idx * 8;
        let mut word = u64::from_le_bytes(data[word_offset..word_offset + 8].try_into().unwrap());
        word &= !(1u64 << bit_pos);
        data[word_offset..word_offset + 8].copy_from_slice(&word.to_le_bytes());
    }

    pub fn set_bit(&mut self, index: u64) -> Option<u64> {
        let bits_allocated = self.bits_allocated();
        if index >= bits_allocated {
            return None;
        }
        let vec_len = self.vec_len() as usize;
        let start_word = (index / Self::BITS_PER_WORD) as usize;
        let start_bit = (index % Self::BITS_PER_WORD) as u32;

        for word_idx in start_word..vec_len {
            let off = Self::BITS_DATA_OFFSET + word_idx * 8;
            let data = self.0.as_mut();
            let word = u64::from_le_bytes(data[off..off + 8].try_into().unwrap());
            if word == u64::MAX {
                continue;
            }
            let from = if word_idx == start_word { start_bit } else { 0 };
            let mask = u64::MAX << from;
            let avail = !word & mask;
            if avail != 0 {
                let bit_pos = avail.trailing_zeros();
                data[off..off + 8].copy_from_slice(&(word | (1u64 << bit_pos)).to_le_bytes());
                return Some(word_idx as u64 * Self::BITS_PER_WORD + bit_pos as u64);
            }
        }
        for word_idx in 0..=start_word {
            let off = Self::BITS_DATA_OFFSET + word_idx * 8;
            let data = self.0.as_mut();
            let word = u64::from_le_bytes(data[off..off + 8].try_into().unwrap());
            if word == u64::MAX {
                continue;
            }
            let to = if word_idx == start_word { start_bit } else { 64 };
            let mask = if to == 0 { 0 } else { u64::MAX >> (64 - to) };
            let avail = !word & mask;
            if avail != 0 {
                let bit_pos = avail.trailing_zeros();
                data[off..off + 8].copy_from_slice(&(word | (1u64 << bit_pos)).to_le_bytes());
                return Some(word_idx as u64 * Self::BITS_PER_WORD + bit_pos as u64);
            }
        }
        None
    }

    pub fn clear_range(&mut self, range: &TicketRange) {
        let vec_len = self.vec_len() as usize;
        for i in range.start..range.end {
            let word_idx = (i / Self::BITS_PER_WORD) as usize;
            if word_idx < vec_len {
                self.clear_bit_direct(i);
            }
        }
    }

    pub fn set_range(&mut self, range: &TicketRange) {
        let vec_len = self.vec_len() as usize;
        for i in range.start..range.end {
            let word_idx = (i / Self::BITS_PER_WORD) as usize;
            if word_idx < vec_len {
                self.set_bit_direct(i);
            }
        }
    }

    pub fn finalize(
        &mut self,
        seed: &[u8; 32],
        capacity: u64,
        total_tokens: u64,
    ) -> Result<u64> {
        let bits_allocated = self.bits_allocated();
        assert!(bits_allocated > 0);

        let active_tickets = self.active_tickets();

        let winners = if capacity >= active_tickets {
            for i in 0..bits_allocated {
                self.set_bit(i);
            }
            active_tickets
        } else {
            let mut set_count = 0u64;
            let n = active_tickets as u32;
            for batch_idx in 0..capacity.div_ceil(8) {
                let rolls = Self::hash_roll_batch(seed, batch_idx);
                for roll in rolls {
                    if set_count >= capacity {
                        break;
                    }
                    self.set_bit((roll % n) as u64).ok_or(ErrorCode::BitmapFull)?;
                    set_count += 1;
                }
            }
            capacity
        };

        let tokens_per_ticket = total_tokens / winners;
        self.set_status_finalized(tokens_per_ticket);

        Ok(winners)
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
        let raw = LotteryRaw::new(&data);
        assert!(!raw.get_bit(0));
        assert!(raw.get_bit(1));
        assert!(!raw.get_bit(2));
        assert!(raw.get_bit(3));
        assert!(!raw.get_bit(100));
        assert_eq!(lottery.get_bit(0), raw.get_bit(0));
        assert_eq!(lottery.get_bit(1), raw.get_bit(1));
        assert_eq!(lottery.get_bit(2), raw.get_bit(2));
        assert_eq!(lottery.get_bit(3), raw.get_bit(3));
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
        let raw = LotteryRaw::new(&data);
        assert!(!raw.get_bit(63));
        assert!(raw.get_bit(64));
        assert!(!raw.get_bit(65));
        assert!(raw.get_bit(66));
        assert_eq!(lottery.get_bit(63), raw.get_bit(63));
        assert_eq!(lottery.get_bit(64), raw.get_bit(64));
        assert_eq!(lottery.get_bit(65), raw.get_bit(65));
        assert_eq!(lottery.get_bit(66), raw.get_bit(66));
    }

    #[test]
    fn test_raw_set_bit_simple() {
        let lottery = Lottery {
            bits_allocated: 128,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0b0; 2],
        };
        let mut data = lottery_to_bytes(&lottery);
        let mut raw = LotteryRaw::new(&mut data);
        assert_eq!(raw.set_bit(5), Some(5));
        assert!(raw.get_bit(5));
    }

    #[test]
    fn test_raw_set_bit_collision() {
        let lottery = Lottery {
            bits_allocated: 64,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0b111],
        };
        let mut data = lottery_to_bytes(&lottery);
        let mut raw = LotteryRaw::new(&mut data);
        assert_eq!(raw.set_bit(0), Some(3));
    }

    #[test]
    fn test_raw_set_bit_collision_cross_word() {
        let lottery = Lottery {
            bits_allocated: 128,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![u64::MAX, 0b0],
        };
        let mut data = lottery_to_bytes(&lottery);
        let mut raw = LotteryRaw::new(&mut data);
        assert_eq!(raw.set_bit(60), Some(64));
    }

    #[test]
    fn test_raw_set_bit_wraparound() {
        let lottery = Lottery {
            bits_allocated: 64,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![!0b11],
        };
        let mut data = lottery_to_bytes(&lottery);
        let mut raw = LotteryRaw::new(&mut data);
        assert_eq!(raw.set_bit(60), Some(0));
    }

    #[test]
    fn test_raw_set_bit_full() {
        let lottery = Lottery {
            bits_allocated: 64,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![u64::MAX],
        };
        let mut data = lottery_to_bytes(&lottery);
        let mut raw = LotteryRaw::new(&mut data);
        assert_eq!(raw.set_bit(0), None);
    }

    #[test]
    fn test_raw_set_bit_out_of_bounds() {
        let lottery = Lottery {
            bits_allocated: 64,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0b0],
        };
        let mut data = lottery_to_bytes(&lottery);
        let mut raw = LotteryRaw::new(&mut data);
        assert_eq!(raw.set_bit(100), None);
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
        let raw = LotteryRaw::new(&data);
        let range = TicketRange::new(0, 10);
        assert_eq!(raw.count_ones(&range), 5);
        assert_eq!(lottery.count_ones(&range), raw.count_ones(&range));
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
        let raw = LotteryRaw::new(&data);
        let range = TicketRange::new(60, 70);
        assert_eq!(raw.count_ones(&range), 8);
        assert_eq!(lottery.count_ones(&range), raw.count_ones(&range));
    }

    #[test]
    fn test_raw_finalize_no_overflow() {
        let seed = [1u8; 32];
        let lottery = Lottery {
            bits_allocated: 64,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0b0],
        };
        let mut data = lottery_to_bytes(&lottery);
        let mut raw = LotteryRaw::new(&mut data);
        let raw_winners = raw.finalize(&seed, 100, 64000).unwrap();
        assert_eq!(raw_winners, 64);
        assert_eq!(raw.count_ones(&TicketRange::new(0, 64)), 64);
        assert!(raw.is_finalized());
        assert_eq!(raw.tokens_per_ticket(), 1000);
    }

    #[test]
    fn test_raw_finalize_overflow() {
        let seed = [2u8; 32];
        let lottery = Lottery {
            bits_allocated: 128,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0b0; 2],
        };
        let mut data = lottery_to_bytes(&lottery);
        let mut raw = LotteryRaw::new(&mut data);
        let raw_winners = raw.finalize(&seed, 50, 50000).unwrap();
        assert_eq!(raw_winners, 50);
        assert_eq!(raw.count_ones(&TicketRange::new(0, 128)), 50);
        assert!(raw.is_finalized());
        assert_eq!(raw.tokens_per_ticket(), 1000);
    }

    #[test]
    fn test_raw_finalize_with_inactive() {
        let seed = [4u8; 32];
        let lottery = Lottery {
            bits_allocated: 100,
            inactive: 20,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0b0; 2],
        };
        let mut data = lottery_to_bytes(&lottery);
        let mut raw = LotteryRaw::new(&mut data);
        let raw_winners = raw.finalize(&seed, 50, 50000).unwrap();
        assert_eq!(raw_winners, 50);
        assert!(raw.is_finalized());
    }

    #[test]
    fn test_raw_sale_allocation() {
        let lottery = finalized_lottery(1000, vec![0b1111]);
        let data = lottery_to_bytes(&lottery);
        let raw = LotteryRaw::new(&data);
        let ranges = vec![TicketRange::new(0, 4)];
        assert_eq!(raw.sale_allocation(&ranges), 4 * 1000);
        assert_eq!(lottery.sale_allocation(&ranges), raw.sale_allocation(&ranges));
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
        LotteryRaw::new(&mut data).clear_range(&range);
        lottery.clear_range(&range);
        let raw = LotteryRaw::new(&data);
        for i in 10..20 {
            assert!(!raw.get_bit(i));
            assert!(!lottery.get_bit(i));
        }
        assert!(raw.get_bit(9));
        assert!(raw.get_bit(20));
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
        LotteryRaw::new(&mut data).set_range(&range);
        lottery.set_range(&range);
        let raw = LotteryRaw::new(&data);
        for i in 10..20 {
            assert!(raw.get_bit(i));
            assert!(lottery.get_bit(i));
        }
        assert!(!raw.get_bit(9));
        assert!(!raw.get_bit(20));
    }
}
