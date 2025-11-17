use crate::income_calculator::DistributionRule;
use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub platform_wallet: Pubkey,
    pub community_claim_signer: Pubkey,
    #[max_len(32)]
    pub distribution_rules: Vec<DistributionRule>,
}

#[account]
#[derive(InitSpace)]
pub struct ProjectPool {
    pub project_id: u64,
    pub base_mint: Pubkey,
    pub base_decimals: u8,
    pub quote_mint: Pubkey,
    pub quote_decimals: u8,
    pub pool_state: Pubkey,
    // Platform
    pub earned_base_by_platform: u64,
    pub earned_quote_by_platform: u64,
    pub claimed_base_by_platform: u64,
    pub claimed_quote_by_platform: u64,
    // Creator
    pub earned_base_by_creator: u64,
    pub earned_quote_by_creator: u64,
    pub claimed_base_by_creator: u64,
    pub claimed_quote_by_creator: u64,
    // Community
    pub earned_base_by_community: u64,
    pub earned_quote_by_community: u64,
    pub claimed_base_by_community: u64,
    pub claimed_quote_by_community: u64,
    // Total
    pub total_harvested_base: u64,
    pub total_harvested_quote: u64,
    pub total_claimed_base: u64,
    pub total_claimed_quote: u64,
}

#[account]
pub struct Nonce {
    pub nonce: u64,
}
