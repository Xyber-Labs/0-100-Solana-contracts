use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Debug)]
pub enum LotteryStatus {
    InProgress { claimed_tickets: u64 },
    Completed,
    Closed,
}

impl Default for LotteryStatus {
    fn default() -> Self {
        LotteryStatus::InProgress { claimed_tickets: 0 }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Debug, Default)]
pub struct Lottery {
    pub bits_allocated: u64,
    pub inactive_count: u64,
    pub total_winning_tickets: u64,
    pub status: LotteryStatus,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Debug, Default)]
pub enum PoolStatus {
    #[default]
    NotCreated,
    Created {
        base_mint: Pubkey,
        pool_state: Pubkey,
    },
    LiquidityAdded {
        base_mint: Pubkey,
        pool_state: Pubkey,
        position_nft_mint: Pubkey,
    },
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Debug)]
pub enum LaunchPhase {
    Funding {
        started_at: i64,
    },
    Seeded {
        seed: [u8; 32],
        funding_ended_at: i64,
    },
    Finalized {
        tokens_per_ticket: u64,
        claims_opened_at: i64,
        pool: PoolStatus,
    },
    Cancelled,
}

impl Default for LaunchPhase {
    fn default() -> Self {
        LaunchPhase::Funding { started_at: 0 }
    }
}

#[account]
#[derive(InitSpace, Default)]
pub struct LaunchState {
    pub created_at: i64,
    pub project_id: u64,
    pub creator: Pubkey,
    pub preset: Pubkey,
    pub phase: LaunchPhase,
    pub lottery: Lottery,
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
    pub(crate) fn is_funding(&self) -> bool {
        matches!(self.phase, LaunchPhase::Funding { .. })
    }

    pub(crate) fn is_seeded(&self) -> bool {
        matches!(self.phase, LaunchPhase::Seeded { .. })
    }

    pub(crate) fn is_finalized(&self) -> bool {
        matches!(self.phase, LaunchPhase::Finalized { .. })
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        matches!(self.phase, LaunchPhase::Cancelled)
    }

    pub(crate) fn is_lottery_in_progress(&self) -> bool {
        matches!(
            self,
            LaunchState {
                phase: LaunchPhase::Finalized { .. },
                lottery: Lottery {
                    status: LotteryStatus::InProgress { .. },
                    ..
                },
                ..
            }
        )
    }

    pub(crate) fn is_lottery_completed(&self) -> bool {
        matches!(self.lottery.status, LotteryStatus::Completed)
    }

    pub(crate) fn set_funding_started_at(&mut self, started_at: i64) {
        self.phase = LaunchPhase::Funding { started_at };
    }

    pub(crate) fn set_seeded(&mut self, seed: [u8; 32], funding_ended_at: i64) {
        self.phase = LaunchPhase::Seeded {
            seed,
            funding_ended_at,
        };
    }

    pub(crate) fn set_cancelled(&mut self) {
        self.phase = LaunchPhase::Cancelled;
    }

    pub(crate) fn get_seed(&self) -> Option<[u8; 32]> {
        match self.phase {
            LaunchPhase::Seeded { seed, .. } => Some(seed),
            _ => None,
        }
    }

    pub(crate) fn funding_started_at(&self) -> Option<i64> {
        match self.phase {
            LaunchPhase::Funding { started_at } => Some(started_at),
            _ => None,
        }
    }

    pub(crate) fn funding_ended_at(&self) -> Option<i64> {
        match self.phase {
            LaunchPhase::Seeded {
                funding_ended_at, ..
            } => Some(funding_ended_at),
            _ => None,
        }
    }

    pub(crate) fn is_funding_active(&self, funding_duration_seconds: i64, now_ts: i64) -> bool {
        match self.phase {
            LaunchPhase::Funding { started_at } => {
                let end = started_at.saturating_add(funding_duration_seconds);
                now_ts >= started_at && now_ts < end
            }
            _ => false,
        }
    }

    pub(crate) fn is_funding_ended(&self, funding_duration_seconds: i64, now_ts: i64) -> bool {
        match self.phase {
            LaunchPhase::Funding { started_at } => {
                let end = started_at.saturating_add(funding_duration_seconds);
                now_ts >= end
            }
            _ => true,
        }
    }

    pub(crate) fn active_tickets(&self) -> u64 {
        assert!(self.lottery.bits_allocated >= self.lottery.inactive_count);
        self.lottery.bits_allocated - self.lottery.inactive_count
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

    pub(crate) fn position_nft_mint(&self) -> Option<Pubkey> {
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

    pub(crate) fn is_pool_created(&self) -> bool {
        matches!(
            self.phase,
            LaunchPhase::Finalized {
                pool: PoolStatus::Created { .. } | PoolStatus::LiquidityAdded { .. },
                ..
            }
        )
    }

    pub(crate) fn set_pool_created(&mut self, base_mint: Pubkey, pool_state: Pubkey) {
        if let LaunchPhase::Finalized { pool, .. } = &mut self.phase {
            *pool = PoolStatus::Created {
                base_mint,
                pool_state,
            };
        }
    }

    pub(crate) fn set_liquidity_added(&mut self, position_nft_mint: Pubkey) {
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
