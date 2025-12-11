use anchor_lang::prelude::*;

use super::{errors::ErrorCode, income_calculator::IncomeCalculator};

#[derive(
    Clone, Copy, PartialEq, Eq, PartialOrd, Ord, AnchorSerialize, AnchorDeserialize, InitSpace,
)]
#[repr(u8)]
pub enum Role {
    Treasure = 0,
    BuyBack = 1,
    Creator = 2,
    Community = 3,
}

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
    pub fn available(&self) -> Result<u64> {
        self.harvested.checked_sub(self.spent).ok_or(ErrorCode::ArithmeticOverflow.into())
    }

    pub fn add_harvested_impl(&mut self, amount: u64) -> Result<()> {
        self.harvested = self.harvested.checked_add(amount).ok_or(ErrorCode::ArithmeticOverflow)?;
        Ok(())
    }

    pub fn add_spent(&mut self, amount: u64) -> Result<()> {
        self.spent = self.spent.checked_add(amount).ok_or(ErrorCode::ArithmeticOverflow)?;
        Ok(())
    }

    pub fn try_from_account(account: &AccountInfo) -> Result<Self> {
        let data = account.try_borrow_data()?;
        Self::try_deserialize(&mut &data[..]).map_err(|_| ErrorCode::SerializationError.into())
    }

    pub fn write_to_account(&self, account: &AccountInfo) -> Result<()> {
        let mut data = account.try_borrow_mut_data()?;
        self.try_serialize(&mut &mut data[..]).map_err(|_| ErrorCode::SerializationError.into())
    }

    pub fn add_harvested(account: &AccountInfo, amount: u64) -> Result<()> {
        let mut totals = Self::try_from_account(account)?;
        totals.add_harvested_impl(amount)?;
        totals.write_to_account(account)
    }
}

#[account]
#[derive(InitSpace)]
pub struct Nonce {
    pub nonce: u64,
}
