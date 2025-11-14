use crate::income_calculator::{DistributionRule, Role};
use crate::state::Config;
use crate::SEED_ROOT;
use anchor_lang::prelude::*;

pub fn initialize(
    ctx: Context<Initialize>,
    platform_wallet: Pubkey,
    community_claim_signer: Pubkey,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.platform_wallet = platform_wallet;
    config.community_claim_signer = community_claim_signer;
    config.distribution_rules = vec![
        DistributionRule::new(0, Role::Platform, 6000, 1),
        DistributionRule::new(0, Role::Creator, 2500, 2),
        DistributionRule::new(0, Role::Community, 1500, 3),
        DistributionRule::new(501, Role::Platform, 3000, 1),
        DistributionRule::new(501, Role::Creator, 5600, 2),
        DistributionRule::new(501, Role::Community, 1400, 3),
        DistributionRule::new(1_501, Role::Platform, 3400, 1),
        DistributionRule::new(1_501, Role::Creator, 5300, 2),
        DistributionRule::new(1_501, Role::Community, 1300, 3),
        DistributionRule::new(4_001, Role::Platform, 3700, 1),
        DistributionRule::new(4_001, Role::Creator, 5100, 2),
        DistributionRule::new(4_001, Role::Community, 1200, 3),
        DistributionRule::new(10_001, Role::Platform, 4000, 1),
        DistributionRule::new(10_001, Role::Creator, 4900, 2),
        DistributionRule::new(10_001, Role::Community, 1100, 3),
        DistributionRule::new(20_001, Role::Platform, 4300, 1),
        DistributionRule::new(20_001, Role::Creator, 4700, 2),
        DistributionRule::new(20_001, Role::Community, 1000, 3),
        DistributionRule::new(30_001, Role::Platform, 4700, 1),
        DistributionRule::new(30_001, Role::Creator, 4400, 2),
        DistributionRule::new(30_001, Role::Community, 900, 3),
        DistributionRule::new(50_001, Role::Platform, 5100, 1),
        DistributionRule::new(50_001, Role::Creator, 4100, 2),
        DistributionRule::new(50_001, Role::Community, 800, 3),
        DistributionRule::new(70_001, Role::Platform, 5600, 1),
        DistributionRule::new(70_001, Role::Creator, 3700, 2),
        DistributionRule::new(70_001, Role::Community, 700, 3),
        DistributionRule::new(100_001, Role::Platform, 6000, 1),
        DistributionRule::new(100_001, Role::Creator, 3400, 2),
        DistributionRule::new(100_001, Role::Community, 600, 3),
    ];
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
