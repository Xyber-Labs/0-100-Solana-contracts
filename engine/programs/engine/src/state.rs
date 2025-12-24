use anchor_lang::{prelude::*, solana_program::sysvar::clock::Clock};

#[derive(Clone, Copy, PartialEq, Eq, Debug, AnchorSerialize, AnchorDeserialize, InitSpace)]
pub struct TicketRange {
    pub start: u64,
    pub end: u64,
}

impl TicketRange {
    pub fn new(start: u64, end: u64) -> Self {
        Self { start, end }
    }

    #[inline]
    pub fn count(&self) -> u64 {
        self.end - self.start
    }

    #[inline]
    pub fn contains(&self, index: u64) -> bool {
        index >= self.start && index < self.end
    }

    pub fn split_tail(&mut self, count: u64) -> Option<Self> {
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

// -------------------------------
// Account Structures
// -------------------------------

#[account]
#[derive(InitSpace)]
pub struct WithdrawnRanges {
    pub launch: Pubkey,
    #[max_len(0)]
    pub ranges: Vec<TicketRange>,
}

impl WithdrawnRanges {
    pub fn push(&mut self, range: TicketRange) {
        self.ranges.push(range);
    }

    pub fn total_withdrawn(&self) -> u64 {
        self.ranges.iter().map(|r| r.count()).sum()
    }

    pub fn take_tickets(&mut self, mut count: u64) -> Vec<TicketRange> {
        let mut taken = Vec::new();
        while count > 0 && !self.ranges.is_empty() {
            let last_idx = self.ranges.len() - 1;
            let range = &mut self.ranges[last_idx];
            let take = count.min(range.count());
            if let Some(tail) = range.split_tail(take) {
                taken.push(tail);
                count -= take;
            }
            if range.count() == 0 {
                self.ranges.pop();
            }
        }
        taken
    }
}

impl crate::utils::realloc::Reallocatable for WithdrawnRanges {
    fn required_space(&self) -> usize {
        let elements_space = self.ranges.len()
            .checked_mul(TicketRange::INIT_SPACE)
            .expect("overflow in required_space");
        8 + Self::INIT_SPACE + elements_space
    }
}

#[account]
#[derive(InitSpace)]
pub struct LaunchState {
    pub project_id: u64,
    pub creator: Pubkey,
    pub preset: Pubkey,

    pub base_mint: Option<Pubkey>,

    pub funding_start: i64,

    pub vrf_seed: Option<[u8; 32]>,

    pub claims_opened_at: Option<i64>,

    pub raydium_pool_state: Option<Pubkey>,
    pub raydium_position_nft_mint: Option<Pubkey>,
}

impl LaunchState {
    pub fn mint_auth_bump_for(launch_key: &Pubkey) -> u8 {
        let (_, bump) = Pubkey::find_program_address(
            &[
                crate::constants::SEED_ROOT,
                b"escrow_authority",
                launch_key.as_ref(),
            ],
            &crate::ID,
        );
        bump
    }

    pub fn funding_end(&self, funding_duration_seconds: i64) -> Option<i64> {
        self.funding_start.checked_add(funding_duration_seconds)
    }

    pub fn is_funding_active(&self, funding_duration_seconds: i64) -> bool {
        let now = Clock::get().map(|c| c.unix_timestamp).unwrap_or(0);
        let end = self.funding_end(funding_duration_seconds).unwrap_or(i64::MAX);
        now >= self.funding_start && now < end
    }

    pub fn is_funding_ended(&self, funding_duration_seconds: i64) -> bool {
        let now = Clock::get().map(|c| c.unix_timestamp).unwrap_or(0);
        let end = self.funding_end(funding_duration_seconds).unwrap_or(i64::MAX);
        now >= end
    }
}

#[account]
#[derive(InitSpace)]
pub struct EscrowAccount {
    pub launch: Pubkey,
    pub balance: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Contribution {
    pub tickets_claimed: u64,
    pub tickets_refunded: u64,
    pub withdraw_count: u8,
    #[max_len(10)]
    pub ticket_ranges: Vec<TicketRange>,
}

impl Contribution {
    pub fn total_tickets(&self) -> u64 {
        self.ticket_ranges.iter().map(|r| r.count()).sum()
    }

    pub fn remove_tickets(&mut self, mut count: u64) -> Vec<TicketRange> {
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
            tickets_claimed: 0,
            tickets_refunded: 0,
            withdraw_count: 0,
            ticket_ranges: vec![
                TicketRange::new(0, 10),
                TicketRange::new(20, 25),
                TicketRange::new(30, 38),
            ],
        };
        assert_eq!(uc.total_tickets(), 23);

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

    #[test]
    fn test_withdrawn_ranges_take_tickets_partial() {
        let mut wr = WithdrawnRanges {
            launch: Pubkey::default(),
            ranges: vec![
                TicketRange::new(0, 10),
                TicketRange::new(20, 30),
            ],
        };
        assert_eq!(wr.total_withdrawn(), 20);

        let taken = wr.take_tickets(5);
        assert_eq!(taken, vec![TicketRange::new(25, 30)]);
        assert_eq!(wr.ranges, vec![TicketRange::new(0, 10), TicketRange::new(20, 25)]);
        assert_eq!(wr.total_withdrawn(), 15);
    }

    #[test]
    fn test_withdrawn_ranges_take_tickets_exact_range() {
        let mut wr = WithdrawnRanges {
            launch: Pubkey::default(),
            ranges: vec![
                TicketRange::new(0, 10),
                TicketRange::new(20, 30),
            ],
        };

        let taken = wr.take_tickets(10);
        assert_eq!(taken, vec![TicketRange::new(20, 30)]);
        assert_eq!(wr.ranges, vec![TicketRange::new(0, 10)]);
    }

    #[test]
    fn test_withdrawn_ranges_take_tickets_cross_ranges() {
        let mut wr = WithdrawnRanges {
            launch: Pubkey::default(),
            ranges: vec![
                TicketRange::new(0, 10),
                TicketRange::new(20, 25),
                TicketRange::new(30, 38),
            ],
        };
        assert_eq!(wr.total_withdrawn(), 23);

        let taken = wr.take_tickets(12);
        assert_eq!(taken, vec![
            TicketRange::new(30, 38),
            TicketRange::new(21, 25),
        ]);
        assert_eq!(wr.ranges, vec![TicketRange::new(0, 10), TicketRange::new(20, 21)]);
        assert_eq!(wr.total_withdrawn(), 11);
    }

    #[test]
    fn test_withdrawn_ranges_take_tickets_all() {
        let mut wr = WithdrawnRanges {
            launch: Pubkey::default(),
            ranges: vec![
                TicketRange::new(0, 10),
                TicketRange::new(20, 30),
            ],
        };

        let taken = wr.take_tickets(20);
        assert_eq!(taken, vec![TicketRange::new(20, 30), TicketRange::new(0, 10)]);
        assert!(wr.ranges.is_empty());
    }

    #[test]
    fn test_withdrawn_ranges_take_tickets_more_than_available() {
        let mut wr = WithdrawnRanges {
            launch: Pubkey::default(),
            ranges: vec![TicketRange::new(0, 10)],
        };

        let taken = wr.take_tickets(100);
        assert_eq!(taken, vec![TicketRange::new(0, 10)]);
        assert!(wr.ranges.is_empty());
    }

    #[test]
    fn test_withdrawn_ranges_take_tickets_empty() {
        let mut wr = WithdrawnRanges {
            launch: Pubkey::default(),
            ranges: vec![],
        };

        let taken = wr.take_tickets(10);
        assert!(taken.is_empty());
    }

    #[test]
    fn test_withdrawn_ranges_take_tickets_zero() {
        let mut wr = WithdrawnRanges {
            launch: Pubkey::default(),
            ranges: vec![TicketRange::new(0, 10)],
        };

        let taken = wr.take_tickets(0);
        assert!(taken.is_empty());
        assert_eq!(wr.ranges, vec![TicketRange::new(0, 10)]);
    }
}

#[account]
#[derive(InitSpace)]
pub struct ProjectCounter {
    pub last_project_id: u64,
}

#[account]
#[derive(InitSpace)]
pub struct PoolState {
    pub launch: Pubkey,
    pub pool_id: u64,
    pub project_id: u64,
    pub created_slot: u64,
    pub created_blockhash: [u8; 32],
    pub created: bool,
    pub claims_ready: bool,
}

#[account]
#[derive(InitSpace)]
pub struct TeamVesting {
    pub launch: Pubkey,
    pub creator: Pubkey,
    pub total_allocation: u64,
    pub claimed: u64,
    pub start_ts: i64,
    pub duration_sec: i64,
    pub min_interval_sec: i64,
    pub last_claim_ts: i64,
}

#[account]
#[derive(InitSpace)]
pub struct EngineConfig {
    pub treasury: Pubkey,
    pub creation_fee: u64,
    pub xyber_mint: Pubkey,
    pub admins: [Pubkey; 3],
    pub threshold: u8,
}

#[account]
#[derive(InitSpace)]
pub struct TokenMetadataConfig {
    pub launch: Pubkey,
    #[max_len(64)]
    pub name: String,
    #[max_len(16)]
    pub symbol: String,
    #[max_len(256)]
    pub uri: String,
    pub is_mutable: bool,
    pub seller_fee_basis_points: u16,
}

#[account]
#[derive(InitSpace)]
pub struct LaunchPreset {
    pub id: u8,
    pub hard_cap_lamports: u64,
    pub min_raise_lamports: u64,
    pub per_wallet_cap: u64,
    pub tau_lamports: u64,
    pub base_total_allocation: u64,
    pub base_sale_basis_points: u64,
    pub team_allocation_basis_points: u64,
    pub funding_duration_seconds: i64,
    pub unlock_time_sec: i64,
    pub creator_initial_deposit_lamports: u64,
    pub creator_daily_lamports_limit: u64,
    pub creator_claim_lock_period_sec: i64,
    pub creator_max_deposit: u64,
    pub pool_creation_grace_period_sec: i64,
    pub team_vesting_duration_sec: i64,
    pub withdrawal_limit: u8,
}

impl LaunchPreset {
    pub fn is_valid(&self) -> bool {
        self.tau_lamports > 0
            && self.hard_cap_lamports % self.tau_lamports == 0
            && self.per_wallet_cap >= self.tau_lamports
            && self.min_raise_lamports >= crate::utils::clmm::AMMV3_CREATION_RESERVE
            && self.min_raise_lamports <= self.hard_cap_lamports
            && self.creator_claim_lock_period_sec > 0
            && self.funding_duration_seconds > 0
            && self.funding_duration_seconds <= 60 * 60 * 24 * 7
            && self.base_sale_basis_points <= 10_000
            && self.team_allocation_basis_points <= 10_000
    }

    pub fn sale_allocation(&self) -> u64 {
        (self.base_total_allocation as u128 * self.base_sale_basis_points as u128 / 10_000) as u64
    }

    pub fn k_capacity(&self) -> Result<u64> {
        Ok(crate::checked_div!(self.hard_cap_lamports, self.tau_lamports)?)
    }

    pub fn tokens_per_ticket(&self, active_tickets: u64) -> Result<u64> {
        let k_capacity = self.k_capacity()?;

        let sale_allocation_u128 = (self.base_total_allocation as u128)
            .checked_mul(self.base_sale_basis_points as u128)
            .and_then(|v| v.checked_div(10_000u128))
            .ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?;

        let divisor = active_tickets.min(k_capacity);
        require!(divisor > 0, crate::errors::ErrorCode::InvalidDivisor);

        let tokens_per_ticket_u128 = sale_allocation_u128
            .checked_div(divisor as u128)
            .ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?;
        require!(
            tokens_per_ticket_u128 <= u64::MAX as u128,
            crate::errors::ErrorCode::U64ConversionOverflow
        );

        Ok(tokens_per_ticket_u128 as u64)
    }
}
