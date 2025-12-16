use anchor_lang::prelude::*;

use instructions::*;
use state::Role;

pub mod errors;
pub mod income_calculator;
pub mod instructions;
pub mod state;

#[cfg(feature = "devnet")]
declare_id!("xybsGBqV6ZMx3aDoriQxHKU2dzR7kLAtR2ACA87216z");

#[cfg(not(feature = "devnet"))]
declare_id!("xybMB4dB3ogkzAojYMWTtjqPFgXKP6A7rbbFjAdfJa6");

#[constant]
pub const DISPATCHER_SEED_ROOT: &[u8] = b"income-dispatcher";

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

    pub fn harvest_pool<'info>(
        ctx: Context<'_, '_, '_, 'info, HarvestPool<'info>>,
        project_id: u64,
    ) -> Result<()> {
        instructions::harvest_pool(ctx, project_id)
    }

    pub fn claim(
        ctx: Context<Claim>,
        project_id: u64,
        role: Role,
        nonce_value: u64,
        amount: Option<u64>,
    ) -> Result<()> {
        instructions::claim(ctx, project_id, role, nonce_value, amount)
    }

    pub fn claim_platform(ctx: Context<ClaimPlatform>) -> Result<()> {
        instructions::claim_platform(ctx)
    }

    pub fn buyback<'info>(
        ctx: Context<'_, '_, '_, 'info, BuyBack<'info>>,
        min_xyber_out: u64,
    ) -> Result<()> {
        instructions::buyback(ctx, min_xyber_out)
    }
}
