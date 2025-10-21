use anchor_lang::prelude::*;

// use crate::income_calculator::DistributionRule;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub platform_wallet: Pubkey,
    pub income_source: Pubkey,
}

#[account]
#[derive(InitSpace)]
pub struct ProjectPool {
    pub project_id: [u8; 32],
    pub creator: Pubkey,
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub income_calculator: Option<IncomeCalculator>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct IncomeCalculator {
    pub price_in_quote: u128,
    // #[max_len(100)]
    // pub rules: Vec<DistributionRule>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum BeneficiaryKey {
    Platform,
    Creator,
    Community,
}

impl BeneficiaryKey {
    pub fn as_bytes(&self) -> &[u8] {
        match self {
            BeneficiaryKey::Platform => b"platform",
            BeneficiaryKey::Creator => b"creator",
            BeneficiaryKey::Community => b"community",
        }
    }
}
