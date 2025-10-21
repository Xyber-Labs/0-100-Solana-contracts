use anchor_lang::prelude::*;

pub mod errors;
pub mod income_calculator;
pub mod state;

use errors::ErrorCode;
use state::*;

declare_id!("5RBTApVVa2JYk2w5WhjxXPseWb4uCDMnBbtGCSVf4b2p");

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
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.platform_wallet = platform_wallet;
        config.income_source = income_source;
        Ok(())
    }

    pub fn update_platform_wallet(
        ctx: Context<UpdatePlatformWallet>,
        new_platform_wallet: Pubkey,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.platform_wallet = new_platform_wallet;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [SEED_ROOT, b"config"],
        bump
    )]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePlatformWallet<'info> {
    #[account(constraint = admin.key() == config.admin @ ErrorCode::Unauthorized)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [SEED_ROOT, b"config"], bump)]
    pub config: Account<'info, Config>,
}
