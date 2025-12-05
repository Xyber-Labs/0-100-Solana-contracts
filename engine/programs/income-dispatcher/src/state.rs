use anchor_lang::prelude::*;

use super::income_calculator::IncomeCalculator;

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
