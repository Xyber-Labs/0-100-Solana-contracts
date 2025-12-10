use anchor_lang::prelude::*;

use super::{errors::ErrorCode, income_calculator::IncomeCalculator};

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
    pub harvested: u64,
    pub spent: u64,
}

impl Totals {
    pub fn available(&self) -> u64 {
        self.harvested.saturating_sub(self.spent)
    }

    pub fn add_harvested(&mut self, amount: u64) -> Result<()> {
        self.harvested = self.harvested.checked_add(amount).ok_or(ErrorCode::ArithmeticOverflow)?;
        Ok(())
    }

    pub fn add_spent(&mut self, amount: u64) -> Result<()> {
        self.spent = self.spent.checked_add(amount).ok_or(ErrorCode::ArithmeticOverflow)?;
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Nonce {
    pub nonce: u64,
}
