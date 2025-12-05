use anchor_lang::prelude::*;
use anchor_spl::token::{transfer_checked, TransferChecked};

use super::{
    errors::ErrorCode,
    income_calculator::{IncomeCalculator, Role},
};

const PLATFORM_BUY_BACK_RATE: u64 = 8000;
const PLATFORM_TREASURE_RATE: u64 = BASIS_POINTS - PLATFORM_BUY_BACK_RATE;
const BASIS_POINTS: u64 = 10000;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Option<Pubkey>,
    pub platform_wallet: Pubkey,
    pub community_wallet: Pubkey,
    pub income_calculator: IncomeCalculator,
}

#[account]
#[derive(InitSpace)]
pub struct IncomeConfig {
    pub balances: [RoleBalance; 3],
    pub authorities: [Pubkey; 3],
    pub total_harvested_base: u64,
    pub total_harvested_quote: u64,
    pub total_claimed_base: u64,
    pub total_claimed_quote: u64,
}

impl IncomeConfig {
    pub(crate) fn quote_to_claim(&self, role: Role, limit: Option<u64>) -> Result<u64> {
        let balance = self.balances[role as usize];
        let quote_earned = if let Role::Platform = role {
            balance
                .earned_quote
                .checked_mul(BASIS_POINTS - PLATFORM_BUY_BACK_RATE)
                .and_then(|v| v.checked_div(BASIS_POINTS))
                .ok_or(ErrorCode::ArithmeticOverflow)?
        } else {
            balance.earned_quote
        };

        let mut quote_to_claim =
            quote_earned.checked_sub(balance.claimed_quote).ok_or(ErrorCode::ArithmeticOverflow)?;

        if let Some(limit) = limit {
            quote_to_claim = quote_to_claim.min(limit);
        }

        Ok(quote_to_claim)
    }

    pub(crate) fn base_to_claim(&self, role: Role, limit: Option<u64>) -> Result<u64> {
        let balance = self.balances[role as usize];

        let mut base_to_claim = balance
            .earned_base
            .checked_sub(balance.claimed_base)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        if let Some(limit) = limit {
            base_to_claim = base_to_claim.min(limit);
        }

        Ok(base_to_claim)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct RoleBalance {
    pub earned_base: u64,
    pub earned_quote: u64,
    pub claimed_base: u64,
    pub claimed_quote: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Nonce {
    pub nonce: u64,
}
