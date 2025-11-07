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
    ) -> Result<()> {
        instructions::initialize(ctx, platform_wallet, income_source)
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
}
