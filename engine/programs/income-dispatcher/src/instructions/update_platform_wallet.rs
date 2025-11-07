use anchor_lang::prelude::*;
use crate::errors::ErrorCode;
use crate::state::Config;
use crate::SEED_ROOT;

pub fn update_platform_wallet(ctx: Context<UpdatePlatformWallet>, new_platform_wallet: Pubkey) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.platform_wallet = new_platform_wallet;
    Ok(())
}

#[derive(Accounts)]
pub struct UpdatePlatformWallet<'info> {
    #[account(constraint = admin.key() == config.admin @ ErrorCode::Unauthorized)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [SEED_ROOT, b"config"], bump)]
    pub config: Account<'info, Config>,
}
