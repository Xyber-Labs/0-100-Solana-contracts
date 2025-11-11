use anchor_lang::prelude::*;

// use crate::income_calculator::DistributionRule;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub platform_wallet: Pubkey,
    pub income_source: Pubkey,
    pub project_initializer: Pubkey,
}

#[account]
#[derive(InitSpace)]
pub struct ProjectPool {
    pub project_id: [u8; 32],
    pub creator: Pubkey,
    pub base_mint: Pubkey,
    pub base_decimals: u8,
    pub quote_mint: Pubkey,
    pub quote_decimals: u8,
    pub total_base_claimed: u64,
    pub total_quote_claimed: u64,
    pub total_claimed_in_base: u64,
    pub total_claimed_in_quote: u64,
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
