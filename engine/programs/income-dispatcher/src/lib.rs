use anchor_lang::prelude::*;

pub mod errors;
pub mod income_calculator;
pub mod instructions;
pub mod state;
use crate::instructions::*;

declare_id!("DPwfwgErHSmKLjGkadA4EL1zcCKU1ZhdaMUyUzJtTqCN");

#[constant]
pub const SEED_ROOT: &[u8] = b"income-dispatcher";

#[program]
pub mod income_dispatcher {

    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        platform_wallet: Pubkey,
        community_claim_signer: Pubkey,
    ) -> Result<()> {
        instructions::initialize(ctx, platform_wallet, community_claim_signer)
    }

    pub fn harvest_pool<'info>(ctx: Context<'_, '_, '_, 'info, HarvestPool<'info>>) -> Result<()> {
        instructions::harvest_pool(ctx)
    }

    pub fn claim_platform(ctx: Context<ClaimPlatform>) -> Result<()> {
        instructions::claim_platform(ctx)
    }

    pub fn claim_creator(ctx: Context<ClaimCreator>) -> Result<()> {
        instructions::claim_creator(ctx)
    }

    pub fn claim_community(ctx: Context<ClaimCommunity>, base_amount: u64, quote_amount: u64) -> Result<()> {
        instructions::claim_community(ctx, base_amount, quote_amount)
    }

    pub fn update_platform_wallet(ctx: Context<UpdatePlatformWallet>, new_platform_wallet: Pubkey) -> Result<()> {
        instructions::update_platform_wallet(ctx, new_platform_wallet)
    }

    pub fn update_community_claim_signer(ctx: Context<UpdateCommunityClaimSigner>, new_community_claim_signer: Pubkey) -> Result<()> {
        instructions::update_community_claim_signer(ctx, new_community_claim_signer)
    }
}
