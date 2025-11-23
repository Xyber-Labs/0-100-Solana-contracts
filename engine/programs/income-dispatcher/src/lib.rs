use anchor_lang::prelude::*;

use crate::instructions::*;

pub mod errors;
pub mod income_calculator;
pub mod instructions;
pub mod state;

#[cfg(not(feature = "mainnet"))]
declare_id!("xybsGBqV6ZMx3aDoriQxHKU2dzR7kLAtR2ACA87216z");

#[cfg(feature = "mainnet")]
declare_id!("xybxcJxiw7mp7SJvF9nRTB4ScGqShNXkxjuWdbuKRSn");

#[constant]
pub const SEED_ROOT: &[u8] = b"income-dispatcher";

const BASIS_POINTS: u128 = 10_000;

#[program]
pub mod income_dispatcher {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        platform_wallet: Pubkey,
        community_wallet: Pubkey,
    ) -> Result<()> {
        instructions::initialize(ctx, platform_wallet, community_wallet)
    }

    pub fn harvest_pool<'info>(ctx: Context<'_, '_, '_, 'info, HarvestPool<'info>>, project_id: u64) -> Result<()> {
        instructions::harvest_pool(ctx, project_id)
    }

    pub fn claim(
        ctx: Context<Claim>,
        project_id: u64,
        role: income_calculator::Role,
        nonce_value: u64,
    ) -> Result<()> {
        instructions::claim(ctx, project_id, role, nonce_value)
    }

    pub fn update_platform_wallet(
        ctx: Context<UpdatePlatformWallet>,
        new_platform_wallet: Pubkey,
    ) -> Result<()> {
        instructions::update_platform_wallet(ctx, new_platform_wallet)
    }

    pub fn update_community_claim_signer(
        ctx: Context<UpdateCommunityClaimSigner>,
        new_community_claim_signer: Pubkey,
    ) -> Result<()> {
        instructions::update_community_claim_signer(ctx, new_community_claim_signer)
    }
}
