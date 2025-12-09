use anchor_lang::prelude::*;

use super::{
    errors::ErrorCode,
    income_calculator::{IncomeCalculator, Role},
};

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
pub struct PlatformIncome {
    pub balances: [RoleBalance; Role::COUNT],
}

#[account]
#[derive(InitSpace)]
pub struct ProjectIncome {
    pub balances: [RoleBalance; Role::COUNT],
    pub authorities: [Pubkey; Role::COUNT],
}

impl ProjectIncome {
    pub(crate) fn quote_to_claim(&self, role: Role, limit: Option<u64>) -> Result<u64> {
        let balance = self.balances[role as usize];
        let mut quote_to_claim = balance
            .earned_quote
            .checked_sub(balance.claimed_quote)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

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
