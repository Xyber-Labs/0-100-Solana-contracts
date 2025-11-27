use anchor_lang::prelude::*;

use crate::{DISPATCHER_SEED_ROOT, errors::ErrorCode, state::Config};

#[derive(Accounts)]
pub struct UpdatePlatformWallet<'info> {
    #[account(address = config.admin @ ErrorCode::Unauthorized)]
    pub admin: Signer<'info>,

    #[account(mut, seeds = [DISPATCHER_SEED_ROOT, b"config"], bump, )]
    pub config: Account<'info, Config>,
}

pub fn update_platform_wallet(
    ctx: Context<UpdatePlatformWallet>,
    new_platform_wallet: Pubkey,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.platform_wallet = new_platform_wallet;
    Ok(())
}
