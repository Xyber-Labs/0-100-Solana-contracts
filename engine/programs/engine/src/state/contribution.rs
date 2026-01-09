use anchor_lang::prelude::*;

use crate::checked_add;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Debug)]
pub(crate) enum VestingType {
    Contributor,
    Creator,
    Team,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Debug)]
#[repr(u8)]
pub enum Bucket {
    Sale = 0,
    Team = 1,
}

#[account]
#[derive(InitSpace, Default)]
pub struct TicketsClaimed {
    pub value: u64,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, AnchorSerialize, AnchorDeserialize, InitSpace)]
pub struct TicketRange {
    pub start: u64,
    pub end: u64,
}

impl TicketRange {
    pub(crate) fn new(start: u64, end: u64) -> Self {
        assert!(start <= end, "TicketRange: start must be <= end");
        Self { start, end }
    }

    #[inline]
    pub(crate) fn count(&self) -> u64 {
        self.end - self.start
    }

    pub(crate) fn split_tail(&mut self, count: u64) -> Option<Self> {
        if count == 0 || count > self.count() {
            return None;
        }
        let split_point = self.end - count;
        let tail = Self {
            start: split_point,
            end: self.end,
        };
        self.end = split_point;
        Some(tail)
    }
}

#[account]
#[derive(InitSpace, Default)]
pub struct Contribution {
    pub tickets_refunded: u64,
    pub withdraw_count: u8,
    #[max_len(0)]
    pub ticket_ranges: Vec<TicketRange>,
}

impl Contribution {
    pub(crate) fn required_space(&self) -> usize {
        Contribution::INIT_SPACE + self.ticket_ranges.len() * TicketRange::INIT_SPACE
    }

    pub(crate) fn total_tickets(&self) -> Result<u64> {
        let mut count: u64 = 0;
        for range in &self.ticket_ranges {
            count = checked_add!(count, range.count())?;
        }
        Ok(count)
    }

    pub(crate) fn remove_tickets(&mut self, mut count: u64) -> Vec<TicketRange> {
        let mut removed = Vec::new();
        while count > 0 && !self.ticket_ranges.is_empty() {
            let last_idx = self.ticket_ranges.len() - 1;
            let range = &mut self.ticket_ranges[last_idx];
            let take = count.min(range.count());
            if let Some(tail) = range.split_tail(take) {
                removed.push(tail);
                count -= take;
            }
            if range.count() == 0 {
                self.ticket_ranges.pop();
            }
        }
        removed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_remove_tickets() {
        let mut uc = Contribution {
            tickets_refunded: 0,
            withdraw_count: 0,
            ticket_ranges: vec![
                TicketRange::new(0, 10),
                TicketRange::new(20, 25),
                TicketRange::new(30, 38),
            ],
        };
        assert_eq!(uc.total_tickets(), Ok(23));

        let removed = uc.remove_tickets(3);
        assert_eq!(removed, vec![TicketRange::new(35, 38)]);
        assert_eq!(
            uc.ticket_ranges,
            vec![
                TicketRange::new(0, 10),
                TicketRange::new(20, 25),
                TicketRange::new(30, 35),
            ]
        );

        let removed = uc.remove_tickets(7);
        assert_eq!(removed, vec![TicketRange::new(30, 35), TicketRange::new(23, 25),]);
        assert_eq!(uc.ticket_ranges, vec![TicketRange::new(0, 10), TicketRange::new(20, 23),]);

        let removed = uc.remove_tickets(100);
        assert_eq!(removed, vec![TicketRange::new(20, 23), TicketRange::new(0, 10),]);
        assert!(uc.ticket_ranges.is_empty());
    }
}
