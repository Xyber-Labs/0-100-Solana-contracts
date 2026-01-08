use anchor_lang::prelude::*;

use crate::{
    checked_add,
    errors::ErrorCode,
    utils::{
        lottery::{LaunchPhase, PoolStatus},
        realloc::Reallocatable,
    },
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Debug)]
pub enum VestingType {
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
    pub fn new(start: u64, end: u64) -> Self {
        assert!(start <= end, "TicketRange: start must be <= end");
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

#[account]
#[derive(InitSpace, Default)]
pub struct LaunchState {
    pub created_at: i64,
    pub project_id: u64,
    pub creator: Pubkey,
    pub preset: Pubkey,
    pub bits_allocated: u64,
    pub inactive_count: u64,
    pub phase: LaunchPhase,
}

impl AsRef<LaunchState> for LaunchState {
    fn as_ref(&self) -> &LaunchState {
        self
    }
}

impl AsMut<LaunchState> for LaunchState {
    fn as_mut(&mut self) -> &mut LaunchState {
        self
    }
}

impl LaunchState {
    pub fn is_funding(&self) -> bool {
        matches!(self.phase, LaunchPhase::Funding { .. })
    }

    pub fn is_seeded(&self) -> bool {
        matches!(self.phase, LaunchPhase::Seeded { .. })
    }

    pub fn is_finalized(&self) -> bool {
        matches!(self.phase, LaunchPhase::Finalized { .. })
    }

    pub fn is_cancelled(&self) -> bool {
        matches!(self.phase, LaunchPhase::Cancelled)
    }

    pub fn set_funding(&mut self, started_at: i64) {
        self.phase = LaunchPhase::Funding { started_at };
    }

    pub fn set_seeded(&mut self, seed: [u8; 32], funding_ended_at: i64) {
        self.phase = LaunchPhase::Seeded {
            seed,
            funding_ended_at,
        };
    }

    pub fn set_cancelled(&mut self) {
        self.phase = LaunchPhase::Cancelled;
    }

    pub fn get_seed(&self) -> Option<[u8; 32]> {
        match self.phase {
            LaunchPhase::Seeded { seed, .. } => Some(seed),
            _ => None,
        }
    }

    pub fn funding_started_at(&self) -> Option<i64> {
        match self.phase {
            LaunchPhase::Funding { started_at } => Some(started_at),
            _ => None,
        }
    }

    pub fn funding_ended_at(&self) -> Option<i64> {
        match self.phase {
            LaunchPhase::Seeded {
                funding_ended_at, ..
            } => Some(funding_ended_at),
            _ => None,
        }
    }

    pub fn is_funding_active(&self, funding_duration_seconds: i64, now_ts: i64) -> bool {
        match self.phase {
            LaunchPhase::Funding { started_at } => {
                let end = started_at.saturating_add(funding_duration_seconds);
                now_ts >= started_at && now_ts < end
            }
            _ => false,
        }
    }

    pub fn is_funding_ended(&self, funding_duration_seconds: i64, now_ts: i64) -> bool {
        match self.phase {
            LaunchPhase::Funding { started_at } => {
                let end = started_at.saturating_add(funding_duration_seconds);
                now_ts >= end
            }
            _ => true,
        }
    }

    pub fn active_tickets(&self) -> u64 {
        assert!(self.bits_allocated >= self.inactive_count);
        self.bits_allocated - self.inactive_count
    }

    pub fn pool_status(&self) -> Option<&PoolStatus> {
        match &self.phase {
            LaunchPhase::Finalized { pool, .. } => Some(pool),
            _ => None,
        }
    }

    pub fn base_mint(&self) -> Option<Pubkey> {
        match &self.phase {
            LaunchPhase::Finalized { pool, .. } => match pool {
                PoolStatus::Created { base_mint, .. } => Some(*base_mint),
                PoolStatus::LiquidityAdded { base_mint, .. } => Some(*base_mint),
                PoolStatus::NotCreated => None,
            },
            _ => None,
        }
    }

    pub fn pool_state(&self) -> Option<Pubkey> {
        match &self.phase {
            LaunchPhase::Finalized { pool, .. } => match pool {
                PoolStatus::Created { pool_state, .. } => Some(*pool_state),
                PoolStatus::LiquidityAdded { pool_state, .. } => Some(*pool_state),
                PoolStatus::NotCreated => None,
            },
            _ => None,
        }
    }

    pub fn position_nft_mint(&self) -> Option<Pubkey> {
        match &self.phase {
            LaunchPhase::Finalized {
                pool:
                    PoolStatus::LiquidityAdded {
                        position_nft_mint, ..
                    },
                ..
            } => Some(*position_nft_mint),
            _ => None,
        }
    }

    pub fn is_pool_created(&self) -> bool {
        matches!(
            self.phase,
            LaunchPhase::Finalized {
                pool: PoolStatus::Created { .. } | PoolStatus::LiquidityAdded { .. },
                ..
            }
        )
    }

    pub fn set_pool_created(&mut self, base_mint: Pubkey, pool_state: Pubkey) {
        if let LaunchPhase::Finalized { pool, .. } = &mut self.phase {
            *pool = PoolStatus::Created {
                base_mint,
                pool_state,
            };
        }
    }

    pub fn set_liquidity_added(&mut self, position_nft_mint: Pubkey) {
        if let LaunchPhase::Finalized { pool, .. } = &mut self.phase {
            if let PoolStatus::Created {
                base_mint,
                pool_state,
            } = *pool
            {
                *pool = PoolStatus::LiquidityAdded {
                    base_mint,
                    pool_state,
                    position_nft_mint,
                };
            }
        }
    }
}

#[account]
#[derive(InitSpace)]
pub struct EscrowAccount {
    pub launch: Pubkey,
    pub balance: u64,
}

#[account]
#[derive(InitSpace, Default)]
pub struct Contribution {
    pub tickets_refunded: u64,
    pub withdraw_count: u8,
    #[max_len(0)]
    pub ticket_ranges: Vec<TicketRange>,
}

impl Reallocatable for Contribution {
    fn required_space(&self) -> usize {
        Contribution::INIT_SPACE + self.ticket_ranges.len() * TicketRange::INIT_SPACE
    }
}

impl Contribution {
    pub fn total_tickets(&self) -> Result<u64> {
        let mut count: u64 = 0;
        for range in &self.ticket_ranges {
            count = checked_add!(count, range.count())?;
        }
        Ok(count)
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

#[account]
#[derive(InitSpace)]
pub struct ProjectCounter {
    pub last_project_id: u64,
}

#[account]
#[derive(InitSpace)]
pub struct EngineConfig {
    pub treasury: Pubkey,
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
    pub creator_period_unlock: u64,
    pub creator_period_sec: i64,
    pub creator_max_deposit: u64,
    pub pool_creation_grace_period_sec: i64,
    pub team_duration_sec: i64,
    pub team_period_sec: i64,
    pub contributor_duration_sec: i64,
    pub contributor_period_sec: i64,
    pub withdrawal_limit: u8,
    pub creation_fee: u64,
}

impl LaunchPreset {
    pub fn is_valid(&self) -> bool {
        self.tau_lamports > 0
            && self.base_total_allocation > 0
            && self.hard_cap_lamports % self.tau_lamports == 0
            && self.per_wallet_cap >= self.tau_lamports
            && self.per_wallet_cap <= self.hard_cap_lamports
            && self.per_wallet_cap % self.tau_lamports == 0
            && self.min_raise_lamports >= crate::utils::clmm::AMMV3_CREATION_RESERVE
            && self.min_raise_lamports <= self.hard_cap_lamports
            && self.min_raise_lamports % self.tau_lamports == 0
            && self.creator_period_sec > 0
            && self.creator_period_unlock > 0
            && self.creator_max_deposit >= self.tau_lamports
            && self.creator_max_deposit % self.tau_lamports == 0
            && self.funding_duration_seconds > 0
            && self.funding_duration_seconds <= 60 * 60 * 24 * 7
            && self.base_sale_basis_points + self.team_allocation_basis_points <= 10_000
            && self.team_period_sec > 0
            && self.team_duration_sec > 0
            && self.team_duration_sec % self.team_period_sec == 0
            && self.contributor_period_sec > 0
            && self.contributor_duration_sec > 0
            && self.contributor_duration_sec % self.contributor_period_sec == 0
    }

    pub fn sale_allocation(&self) -> u64 {
        (self.base_total_allocation as u128 * self.base_sale_basis_points as u128 / 10_000) as u64
    }

    pub fn team_allocation(&self) -> u64 {
        (self.base_total_allocation as u128 * self.team_allocation_basis_points as u128 / 10_000)
            as u64
    }

    pub fn team_vesting_params(&self) -> (u64, i64, i64) {
        (self.team_allocation(), self.team_duration_sec, self.team_period_sec)
    }

    pub fn contributor_vesting_params(&self) -> (i64, i64) {
        (self.contributor_duration_sec, self.contributor_period_sec)
    }

    pub fn creator_vesting_params(&self, deposit: u64) -> Result<(i64, i64)> {
        let period = self.creator_period_sec;
        let periods = crate::checked_div!(deposit, self.creator_period_unlock)?.max(1);
        let duration_u64 = crate::checked_mul!(periods, period as u64)?;
        let duration =
            i64::try_from(duration_u64).map_err(|_| error!(ErrorCode::ArithmeticOverflow))?;
        Ok((duration, period))
    }

    pub fn k_capacity(&self) -> Result<u64> {
        Ok(crate::checked_div!(self.hard_cap_lamports, self.tau_lamports)?)
    }

    pub fn tokens_per_ticket(&self, active_tickets: u64) -> Result<u64> {
        let k_capacity = self.k_capacity()?;

        let sale_allocation = self
            .base_total_allocation
            .checked_mul(self.base_sale_basis_points)
            .and_then(|v| v.checked_div(10_000))
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        let divisor = active_tickets.min(k_capacity);
        require!(divisor > 0, ErrorCode::InvalidDivisor);

        let tokens_per_ticket =
            sale_allocation.checked_div(divisor).ok_or(ErrorCode::ArithmeticOverflow)?;

        Ok(tokens_per_ticket)
    }
}
