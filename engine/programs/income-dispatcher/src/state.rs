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
#[derive(InitSpace, Default)]
pub struct Totals {
    data: [RoleBalance; Role::COUNT],
}

impl Totals {
    pub fn get(&self, role: Role) -> &RoleBalance {
        &self.data[role as usize]
    }

    pub fn get_mut(&mut self, role: Role) -> &mut RoleBalance {
        &mut self.data[role as usize]
    }

    pub fn quote_to_spend(&self, role: Role, limit: Option<u64>) -> Result<u64> {
        let balance = self.get(role);
        let mut amount = balance
            .harvested_quote
            .checked_sub(balance.spent_quote)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        if let Some(limit) = limit {
            amount = amount.min(limit);
        }

        Ok(amount)
    }

    pub fn base_to_spend(&self, role: Role, limit: Option<u64>) -> Result<u64> {
        let balance = self.get(role);
        let mut amount = balance
            .harvested_base
            .checked_sub(balance.spent_base)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        if let Some(limit) = limit {
            amount = amount.min(limit);
        }

        Ok(amount)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, Default)]
pub struct RoleBalance {
    pub harvested_base: u64,
    pub harvested_quote: u64,
    pub spent_base: u64,
    pub spent_quote: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Nonce {
    pub nonce: u64,
}
