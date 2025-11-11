use anchor_lang::prelude::*;

pub mod errors;
#[cfg(test)]
mod income_calculator;
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
        income_source: Pubkey,
        project_initializer: Pubkey,
    ) -> Result<()> {
        instructions::initialize(ctx, platform_wallet, income_source, project_initializer)
    }

    pub fn update_platform_wallet(
        ctx: Context<UpdatePlatformWallet>,
        new_platform_wallet: Pubkey,
    ) -> Result<()> {
        instructions::update_platform_wallet(ctx, new_platform_wallet)
    }

    pub fn claim_clmm_fees_by_admin<'info>(
        ctx: Context<'_, '_, '_, 'info, ClaimClmmFeesByAdmin<'info>>,
    ) -> Result<()> {
        instructions::claim_clmm_fees_by_admin(ctx)
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        instructions::claim(ctx)
    }

    pub fn harvest_pool<'info>(ctx: Context<'_, '_, '_, 'info, HarvestPool<'info>>) -> Result<()> {
        instructions::harvest_pool(ctx)
    }

    pub fn init_project(
        ctx: Context<InitProject>,
        project_id: [u8; 32],
    ) -> Result<()> {
        instructions::init_project(ctx, project_id)
    }
}
