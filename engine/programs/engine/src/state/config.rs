use anchor_lang::prelude::*;

use crate::errors::ErrorCode;

#[account]
#[derive(InitSpace)]
pub struct EscrowAccount {
    pub launch: Pubkey,
    pub balance: u64,
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
    pub multisig: Pubkey,
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
    pub is_enabled: bool,
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
    pub(crate) fn is_valid(&self) -> bool {
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

    pub(crate) fn sale_allocation(&self) -> u64 {
        (self.base_total_allocation as u128 * self.base_sale_basis_points as u128 / 10_000) as u64
    }

    fn team_allocation(&self) -> u64 {
        (self.base_total_allocation as u128 * self.team_allocation_basis_points as u128 / 10_000)
            as u64
    }

    pub(crate) fn team_vesting_params(&self) -> (u64, i64, i64) {
        (self.team_allocation(), self.team_duration_sec, self.team_period_sec)
    }

    pub(crate) fn contributor_vesting_params(&self) -> (i64, i64) {
        (self.contributor_duration_sec, self.contributor_period_sec)
    }

    pub(crate) fn creator_vesting_params(&self, deposit: u64) -> Result<(i64, i64)> {
        let period = self.creator_period_sec;
        let periods = crate::checked_div!(deposit, self.creator_period_unlock)?.max(1);
        let duration_u64 = crate::checked_mul!(periods, period as u64)?;
        let duration =
            i64::try_from(duration_u64).map_err(|_| error!(ErrorCode::ArithmeticOverflow))?;
        Ok((duration, period))
    }

    pub(crate) fn k_capacity(&self) -> Result<u64> {
        Ok(crate::checked_div!(self.hard_cap_lamports, self.tau_lamports)?)
    }
}
