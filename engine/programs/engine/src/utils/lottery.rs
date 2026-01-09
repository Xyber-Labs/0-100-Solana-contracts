use anchor_lang::{prelude::*, solana_program::keccak::hash};

use crate::{
    errors::ErrorCode,
    state::{LaunchPhase, LaunchState, PoolStatus, TicketRange},
};

pub struct LotteryRaw<C, W, I> {
    pub control: C,
    pub winners_bitmap: W,
    pub inactive_bitmap: I,
}

impl<C, W, I> LotteryRaw<C, W, I> {
    const BITS_PER_WORD: u64 = 64;

    pub fn new(control: C, winners_bitmap: W, inactive_bitmap: I) -> Self {
        Self {
            control,
            winners_bitmap,
            inactive_bitmap,
        }
    }

    #[inline]
    fn required_words(total_bits: u64) -> usize {
        total_bits.div_ceil(Self::BITS_PER_WORD) as usize
    }

    pub fn required_bitmap_space(bits_allocated: u64) -> usize {
        Self::required_words(bits_allocated) * 8
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

    #[inline]
    fn get_bitmap_bit(data: &[u8], index: u64, vec_len: u32) -> bool {
        let word_idx = (index / Self::BITS_PER_WORD) as usize;
        let bit_pos = index % Self::BITS_PER_WORD;
        if word_idx >= vec_len as usize {
            return false;
        }
        let word_offset = word_idx * 8;
        let word = u64::from_le_bytes(data[word_offset..word_offset + 8].try_into().unwrap());
        (word >> bit_pos) & 1 == 1
    }

    #[inline]
    fn write_bitmap_bit(data: &mut [u8], index: u64, value: bool) {
        let word_idx = (index / Self::BITS_PER_WORD) as usize;
        let bit_pos = index % Self::BITS_PER_WORD;
        let word_offset = word_idx * 8;
        assert!(word_offset + 8 <= data.len(), "write_bitmap_bit: index out of bounds");
        let mut word = u64::from_le_bytes(data[word_offset..word_offset + 8].try_into().unwrap());
        if value {
            word |= 1u64 << bit_pos;
        } else {
            word &= !(1u64 << bit_pos);
        }
        data[word_offset..word_offset + 8].copy_from_slice(&word.to_le_bytes());
    }
}

impl<C: AsRef<LaunchState>, W: AsRef<[u8]>, I: AsRef<[u8]>> LotteryRaw<C, W, I> {
    #[inline]
    pub fn bits_allocated(&self) -> u64 {
        self.control.as_ref().bits_allocated
    }

    #[inline]
    fn active_tickets(&self) -> u64 {
        self.control.as_ref().active_tickets()
    }

    #[inline]
    fn is_finalized(&self) -> bool {
        self.control.as_ref().is_finalized()
    }

    #[inline]
    fn tokens_per_ticket(&self) -> u64 {
        match self.control.as_ref().phase {
            LaunchPhase::Funding { .. } => 0,
            LaunchPhase::Seeded { .. } => 0,
            LaunchPhase::Finalized {
                tokens_per_ticket, ..
            } => tokens_per_ticket,
            LaunchPhase::Cancelled => 0,
        }
    }

    #[inline]
    pub fn claims_opened_at(&self) -> Option<i64> {
        match self.control.as_ref().phase {
            LaunchPhase::Finalized {
                claims_opened_at, ..
            } => Some(claims_opened_at),
            _ => None,
        }
    }

    #[inline]
    fn vec_len(&self) -> u32 {
        Self::required_words(self.bits_allocated()) as u32
    }

    #[inline]
    fn get_winner_bit(&self, index: u64) -> bool {
        Self::get_bitmap_bit(self.winners_bitmap.as_ref(), index, self.vec_len())
    }

    #[inline]
    fn is_inactive(&self, index: u64) -> bool {
        Self::get_bitmap_bit(self.inactive_bitmap.as_ref(), index, self.vec_len())
    }

    fn count_ones(&self, range: &TicketRange) -> u64 {
        let mut result = 0u64;
        for i in range.start..range.end {
            if self.get_winner_bit(i) {
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

impl<C: AsMut<LaunchState>, W, I> LotteryRaw<C, W, I> {
    #[inline]
    pub fn add_inactive(&mut self, count: u64) {
        self.control.as_mut().inactive_count += count;
    }

    #[inline]
    fn set_phase_finalized(&mut self, tokens_per_ticket: u64, claims_opened_at: i64) {
        self.control.as_mut().phase = LaunchPhase::Finalized {
            tokens_per_ticket,
            claims_opened_at,
            pool: PoolStatus::NotCreated,
        };
    }
}

impl<C, W: AsMut<[u8]>, I> LotteryRaw<C, W, I> {
    #[inline]
    pub(super) fn set_winner_bit(&mut self, index: u64) {
        Self::write_bitmap_bit(self.winners_bitmap.as_mut(), index, true);
    }

    pub(crate) fn set_range(&mut self, range: TicketRange, value: bool) {
        msg!("Range: {:?}", range);
        for i in range.start..range.end {
            Self::write_bitmap_bit(self.winners_bitmap.as_mut(), i, value);
        }
    }

    pub(crate) fn clear_range(&mut self, range: &TicketRange) {
        for i in range.start..range.end {
            Self::write_bitmap_bit(self.winners_bitmap.as_mut(), i, false);
        }
    }
}

impl<C: AsMut<LaunchState> + AsRef<LaunchState>, W, I> LotteryRaw<C, W, I> {
    pub fn allocate_tickets(&mut self, count: u64) -> TicketRange {
        let start = self.control.as_ref().bits_allocated;
        let end = start.checked_add(count).expect("ticket allocation overflow");
        self.control.as_mut().bits_allocated = end;
        TicketRange::new(start, end)
    }
}

impl<C, W, I: AsMut<[u8]>> LotteryRaw<C, W, I> {
    #[inline]
    pub fn set_inactive_bit(&mut self, index: u64) {
        Self::write_bitmap_bit(self.inactive_bitmap.as_mut(), index, true);
    }
}

impl<C: AsMut<LaunchState> + AsRef<LaunchState>, W: AsRef<[u8]>, I: AsMut<[u8]> + AsRef<[u8]>>
    LotteryRaw<C, W, I>
{
    pub(crate) fn take_tickets(&mut self, count: u64) -> Vec<TicketRange> {
        let mut taken = Vec::new();
        if self.control.as_ref().inactive_count == 0 || count == 0 {
            return taken;
        }

        let bits_allocated = self.control.as_ref().bits_allocated;
        let vec_len = self.vec_len() as usize;
        let mut collected = 0u64;
        let mut current: Option<TicketRange> = None;

        'outer: for word_idx in 0..vec_len {
            let mut word = read_word(self.inactive_bitmap.as_ref(), word_idx);

            while word != 0 && collected < count {
                let bit = word.trailing_zeros() as u64;
                let idx = word_idx as u64 * Self::BITS_PER_WORD + bit;
                if idx >= bits_allocated {
                    break 'outer;
                }
                word &= !(1u64 << bit);
                let off = word_idx * 8;
                self.inactive_bitmap.as_mut()[off..off + 8].copy_from_slice(&word.to_le_bytes());
                match &mut current {
                    None => current = Some(TicketRange::new(idx, idx + 1)),
                    Some(r) if idx == r.end => r.end = idx + 1,
                    Some(r) => {
                        taken.push(*r);
                        current = Some(TicketRange::new(idx, idx + 1));
                    }
                }
                collected += 1;
            }

            if collected >= count {
                break;
            }
        }

        if let Some(r) = current {
            taken.push(r);
        }

        self.control.as_mut().inactive_count -= collected;
        taken
    }
}

fn read_word(bitmap: &[u8], word_idx: usize) -> u64 {
    let off = word_idx * 8;
    u64::from_le_bytes(bitmap[off..off + 8].try_into().expect("Bitmap word access out of bounds"))
}

impl<C: AsMut<LaunchState> + AsRef<LaunchState>, W: AsMut<[u8]> + AsRef<[u8]>, I: AsRef<[u8]>>
    LotteryRaw<C, W, I>
{
    pub(super) fn try_set_winner_bit(&mut self, index: u64) -> Option<u64> {
        let bits_allocated = self.bits_allocated();
        if index >= bits_allocated {
            return None;
        }
        let start_word = index / Self::BITS_PER_WORD;
        let start_bit = index % Self::BITS_PER_WORD;

        for i in 0..=self.vec_len() as u64 {
            let word_idx = (start_word + i) as usize % self.vec_len() as usize;
            let winners = read_word(self.winners_bitmap.as_ref(), word_idx);
            let inactive = read_word(self.inactive_bitmap.as_ref(), word_idx);
            let mask = if i == 0 { u64::MAX << start_bit } else { u64::MAX };
            let avail = !(winners | inactive) & mask;
            if avail != 0 {
                let bit_pos = avail.trailing_zeros();
                let off = word_idx * 8;
                self.winners_bitmap.as_mut()[off..off + 8]
                    .copy_from_slice(&(winners | (1u64 << bit_pos)).to_le_bytes());
                return Some(word_idx as u64 * Self::BITS_PER_WORD + bit_pos as u64);
            }
        }
        None
    }

    pub(crate) fn finalize(
        &mut self,
        seed: &[u8; 32],
        capacity: u64,
        total_tokens: u64,
        claims_opened_at: i64,
    ) -> Result<u64> {
        let bits_allocated = self.bits_allocated();
        assert!(bits_allocated > 0);

        let active_tickets = self.active_tickets();

        let winners = if capacity >= active_tickets {
            for i in 0..bits_allocated {
                if self.is_inactive(i) {
                    continue;
                }
                self.set_winner_bit(i);
            }
            active_tickets
        } else {
            let mut set_count = 0u64;
            for batch_idx in 0..capacity.div_ceil(8) {
                let rolls = Self::hash_roll_batch(seed, batch_idx);
                for roll in rolls {
                    if set_count >= capacity {
                        break;
                    }
                    self.try_set_winner_bit(roll as u64 % active_tickets)
                        .ok_or(ErrorCode::BitmapFull)?;
                    set_count += 1;
                }
            }
            capacity
        };

        let tokens_per_ticket = total_tokens / winners;
        self.set_phase_finalized(tokens_per_ticket, claims_opened_at);

        Ok(winners)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_bitmap(words: &[u64]) -> Vec<u8> {
        let mut data = vec![0u8; words.len() * 8];
        for (i, word) in words.iter().enumerate() {
            data[i * 8..(i + 1) * 8].copy_from_slice(&word.to_le_bytes());
        }
        data
    }

    fn empty_bitmap(word_count: usize) -> Vec<u8> {
        vec![0u8; word_count * 8]
    }

    fn state(bits_allocated: u64, inactive_count: u64) -> LaunchState {
        LaunchState {
            bits_allocated,
            inactive_count,
            phase: LaunchPhase::default(),
            ..Default::default()
        }
    }

    #[test]
    fn test_get_winner_bit() {
        let s = state(64, 0);
        let winners = make_bitmap(&[0b1010]);
        let inactive = empty_bitmap(1);
        let raw = LotteryRaw::new(&s, &winners[..], &inactive[..]);
        assert!(!raw.get_winner_bit(0));
        assert!(raw.get_winner_bit(1));
        assert!(!raw.get_winner_bit(2));
        assert!(raw.get_winner_bit(3));
        assert!(!raw.get_winner_bit(100));
    }

    #[test]
    fn test_get_winner_bit_second_word() {
        let s = state(128, 0);
        let winners = make_bitmap(&[0b0, 0b101]);
        let inactive = empty_bitmap(2);
        let raw = LotteryRaw::new(&s, &winners[..], &inactive[..]);
        assert!(!raw.get_winner_bit(63));
        assert!(raw.get_winner_bit(64));
        assert!(!raw.get_winner_bit(65));
        assert!(raw.get_winner_bit(66));
    }

    #[test]
    fn test_try_set_winner_bit_simple() {
        let mut s = state(128, 0);
        let mut winners = empty_bitmap(2);
        let inactive = empty_bitmap(2);
        let mut raw = LotteryRaw::new(&mut s, &mut winners[..], &inactive[..]);
        assert_eq!(raw.try_set_winner_bit(5), Some(5));
        assert!(raw.get_winner_bit(5));
    }

    #[test]
    fn test_try_set_winner_bit_collision() {
        let mut s = state(64, 0);
        let mut winners = make_bitmap(&[0b111]);
        let inactive = empty_bitmap(1);
        let mut raw = LotteryRaw::new(&mut s, &mut winners[..], &inactive[..]);
        assert_eq!(raw.try_set_winner_bit(0), Some(3));
    }

    #[test]
    fn test_try_set_winner_bit_skips_inactive() {
        let mut s = state(64, 3);
        let mut winners = empty_bitmap(1);
        let inactive = make_bitmap(&[0b111]);
        let mut raw = LotteryRaw::new(&mut s, &mut winners[..], &inactive[..]);
        assert_eq!(raw.try_set_winner_bit(0), Some(3));
    }

    #[test]
    fn test_try_set_winner_bit_collision_cross_word() {
        let mut s = state(128, 0);
        let mut winners = make_bitmap(&[u64::MAX, 0b0]);
        let inactive = empty_bitmap(2);
        let mut raw = LotteryRaw::new(&mut s, &mut winners[..], &inactive[..]);
        assert_eq!(raw.try_set_winner_bit(60), Some(64));
    }

    #[test]
    fn test_try_set_winner_bit_wraparound() {
        let mut s = state(64, 0);
        let mut winners = make_bitmap(&[!0b11]);
        let inactive = empty_bitmap(1);
        let mut raw = LotteryRaw::new(&mut s, &mut winners[..], &inactive[..]);
        assert_eq!(raw.try_set_winner_bit(60), Some(0));
    }

    #[test]
    fn test_try_set_winner_bit_full() {
        let mut s = state(64, 0);
        let mut winners = make_bitmap(&[u64::MAX]);
        let inactive = empty_bitmap(1);
        let mut raw = LotteryRaw::new(&mut s, &mut winners[..], &inactive[..]);
        assert_eq!(raw.try_set_winner_bit(0), None);
    }

    #[test]
    fn test_try_set_winner_bit_out_of_bounds() {
        let mut s = state(64, 0);
        let mut winners = empty_bitmap(1);
        let inactive = empty_bitmap(1);
        let mut raw = LotteryRaw::new(&mut s, &mut winners[..], &inactive[..]);
        assert_eq!(raw.try_set_winner_bit(100), None);
    }

    #[test]
    fn test_count_ones() {
        let s = state(64, 0);
        let winners = make_bitmap(&[0b11111]);
        let inactive = empty_bitmap(1);
        let raw = LotteryRaw::new(&s, &winners[..], &inactive[..]);
        assert_eq!(raw.count_ones(&TicketRange::new(0, 10)), 5);
    }

    #[test]
    fn test_count_ones_cross_word() {
        let s = state(128, 0);
        let winners = make_bitmap(&[u64::MAX, 0b1111]);
        let inactive = empty_bitmap(2);
        let raw = LotteryRaw::new(&s, &winners[..], &inactive[..]);
        assert_eq!(raw.count_ones(&TicketRange::new(60, 70)), 8);
    }

    #[test]
    fn test_finalize_all_winners() {
        let seed = [1u8; 32];
        let mut s = state(64, 0);
        let mut winners = empty_bitmap(1);
        let inactive = empty_bitmap(1);
        let mut raw = LotteryRaw::new(&mut s, &mut winners[..], &inactive[..]);
        let winners_count = raw.finalize(&seed, 100, 64000, 1000).unwrap();
        assert_eq!(winners_count, 64);
        assert_eq!(raw.count_ones(&TicketRange::new(0, 64)), 64);
        assert!(raw.is_finalized());
        assert_eq!(raw.tokens_per_ticket(), 1000);
    }

    #[test]
    fn test_finalize_partial_winners() {
        let seed = [2u8; 32];
        let mut s = state(128, 0);
        let mut winners = empty_bitmap(2);
        let inactive = empty_bitmap(2);
        let mut raw = LotteryRaw::new(&mut s, &mut winners[..], &inactive[..]);
        let winners_count = raw.finalize(&seed, 50, 50000, 1000).unwrap();
        assert_eq!(winners_count, 50);
        assert_eq!(raw.count_ones(&TicketRange::new(0, 128)), 50);
        assert!(raw.is_finalized());
        assert_eq!(raw.tokens_per_ticket(), 1000);
    }

    #[test]
    fn test_finalize_with_inactive() {
        let seed = [4u8; 32];
        let mut s = state(100, 20);
        let mut winners = empty_bitmap(2);
        let inactive = make_bitmap(&[0xFFFFF, 0]);
        let mut raw = LotteryRaw::new(&mut s, &mut winners[..], &inactive[..]);
        let winners_count = raw.finalize(&seed, 50, 50000, 1000).unwrap();
        assert_eq!(winners_count, 50);
        assert!(raw.is_finalized());
    }

    #[test]
    fn test_sale_allocation() {
        let s = LaunchState {
            bits_allocated: 64,
            inactive_count: 0,
            phase: LaunchPhase::Finalized {
                tokens_per_ticket: 1000,
                claims_opened_at: 1000,
                pool: PoolStatus::NotCreated,
            },
            ..Default::default()
        };
        let winners = make_bitmap(&[0b1111]);
        let inactive = empty_bitmap(1);
        let raw = LotteryRaw::new(&s, &winners[..], &inactive[..]);
        assert_eq!(raw.sale_allocation(&[TicketRange::new(0, 4)]), 4000);
    }

    #[test]
    fn test_sale_allocation_partial() {
        let s = LaunchState {
            bits_allocated: 64,
            inactive_count: 0,
            phase: LaunchPhase::Finalized {
                tokens_per_ticket: 500,
                claims_opened_at: 1000,
                pool: PoolStatus::NotCreated,
            },
            ..Default::default()
        };
        let winners = make_bitmap(&[0b1010]);
        let inactive = empty_bitmap(1);
        let raw = LotteryRaw::new(&s, &winners[..], &inactive[..]);
        assert_eq!(raw.sale_allocation(&[TicketRange::new(0, 4)]), 1000);
    }

    #[test]
    #[should_panic(expected = "Expected be finalized")]
    fn test_sale_allocation_not_finalized() {
        let s = state(64, 0);
        let winners = make_bitmap(&[0b1111]);
        let inactive = empty_bitmap(1);
        let raw = LotteryRaw::new(&s, &winners[..], &inactive[..]);
        raw.sale_allocation(&[TicketRange::new(0, 4)]);
    }

    #[test]
    fn test_clear_range() {
        let mut s = state(64, 0);
        let mut winners = make_bitmap(&[u64::MAX]);
        let mut inactive = empty_bitmap(1);
        {
            let mut raw = LotteryRaw::new(&mut s, &mut winners[..], &mut inactive[..]);
            raw.clear_range(&TicketRange::new(10, 20));
        }
        let raw = LotteryRaw::new(&s, &winners[..], &inactive[..]);
        for i in 10..20 {
            assert!(!raw.get_winner_bit(i));
        }
        assert!(raw.get_winner_bit(9));
        assert!(raw.get_winner_bit(20));
    }

    #[test]
    fn test_set_range() {
        let mut s = state(64, 0);
        let mut winners = empty_bitmap(1);
        let mut inactive = empty_bitmap(1);
        {
            let mut raw = LotteryRaw::new(&mut s, &mut winners[..], &mut inactive[..]);
            raw.set_range(TicketRange::new(10, 20), true);
        }
        let raw = LotteryRaw::new(&s, &winners[..], &inactive[..]);
        for i in 10..20 {
            assert!(raw.get_winner_bit(i));
        }
        assert!(!raw.get_winner_bit(9));
        assert!(!raw.get_winner_bit(20));
    }

    #[test]
    fn test_set_range_false() {
        let mut s = state(64, 0);
        let mut winners = empty_bitmap(1);
        let mut inactive = empty_bitmap(1);
        {
            let mut raw = LotteryRaw::new(&mut s, &mut winners[..], &mut inactive[..]);
            raw.set_range(TicketRange::new(10, 20), false);
        }
        let raw = LotteryRaw::new(&s, &winners[..], &inactive[..]);
        for i in 10..20 {
            assert!(!raw.get_winner_bit(i));
        }
    }

    #[test]
    fn test_is_inactive() {
        let s = state(64, 2);
        let winners = empty_bitmap(1);
        let inactive = make_bitmap(&[0b1010]);
        let raw = LotteryRaw::new(&s, &winners[..], &inactive[..]);
        assert!(!raw.is_inactive(0));
        assert!(raw.is_inactive(1));
        assert!(!raw.is_inactive(2));
        assert!(raw.is_inactive(3));
    }
}
