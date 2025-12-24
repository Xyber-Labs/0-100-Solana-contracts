use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak::hash;

use crate::errors::ErrorCode;
use crate::state::TicketRange;
use crate::utils::realloc::Reallocatable;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, PartialEq, Debug)]
pub enum LotteryStatus {
    #[default]
    InProgress,
    Finalized {
        tokens_per_ticket: u64,
        sol_per_ticket: u64,
    },
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
        matches!(self.status, LotteryStatus::InProgress)
    }

    pub fn is_finalized(&self) -> bool {
        matches!(self.status, LotteryStatus::Finalized { .. })
    }

    pub fn active_tickets(&self) -> u64 {
        self.bits_allocated - self.inactive
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
        total_deposited: u64,
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
            sol_per_ticket: total_deposited / winners,
        };

        Ok(winners)
    }

    fn hash_roll(seed: &[u8; 32], i: u64, n: u64) -> u64 {
        let mut data = [0u8; 40];
        data[..32].copy_from_slice(seed);
        data[32..40].copy_from_slice(&i.to_le_bytes());
        let h = hash(&data);
        let val = u64::from_le_bytes([h.0[0], h.0[1], h.0[2], h.0[3], h.0[4], h.0[5], h.0[6], h.0[7]]);
        val % n
    }
}

impl Reallocatable for Lottery {
    fn required_space(&self) -> usize {
        8 + Self::INIT_SPACE + self.bits.len() * 8
    }
}
