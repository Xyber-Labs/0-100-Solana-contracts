use crate::state::Config;
use crate::SEED_ROOT;
use anchor_lang::prelude::*;

pub fn initialize(
    ctx: Context<Initialize>,
    income_source: Pubkey,
    platform_wallet: Pubkey,
    community_claim_signer: Pubkey,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.income_source = income_source;
    config.platform_wallet = platform_wallet;
    config.community_claim_signer = community_claim_signer;
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
