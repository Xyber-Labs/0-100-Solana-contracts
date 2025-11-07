use crate::state::Config;
use crate::SEED_ROOT;
use anchor_lang::prelude::*;

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
