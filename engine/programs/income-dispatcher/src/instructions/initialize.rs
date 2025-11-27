use anchor_lang::prelude::*;

use crate::{
    DISPATCHER_SEED_ROOT,
    income_calculator::{DistributionRule, IncomeCalculator, mcap, Role},
    state::Config,
};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [DISPATCHER_SEED_ROOT, b"config"],
        bump
    )]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

pub fn initialize(
    ctx: Context<Initialize>,
    platform_wallet: Pubkey,
    community_wallet: Pubkey,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.platform_wallet = platform_wallet;
    config.community_wallet = community_wallet;

    config.income_calculator = IncomeCalculator::new(engine::constants::BASE_TOKEN_DECIMALS)?
        .add_rule(DistributionRule::new(mcap!(0.0), Role::Platform, 6000, 1))
        .add_rule(DistributionRule::new(mcap!(0.0), Role::Creator, 2500, 2))
        .add_rule(DistributionRule::new(mcap!(0.0), Role::Community, 1500, 3))
        .add_rule(DistributionRule::new(mcap!(501.0), Role::Platform, 3000, 1))
        .add_rule(DistributionRule::new(mcap!(501.0), Role::Creator, 5600, 2))
        .add_rule(DistributionRule::new(mcap!(501.0), Role::Community, 1400, 3))
        .add_rule(DistributionRule::new(mcap!(1_501.0), Role::Platform, 3400, 1))
        .add_rule(DistributionRule::new(mcap!(1_501.0), Role::Creator, 5300, 2))
        .add_rule(DistributionRule::new(mcap!(1_501.0), Role::Community, 1300, 3))
        .add_rule(DistributionRule::new(mcap!(4_001.0), Role::Platform, 3700, 1))
        .add_rule(DistributionRule::new(mcap!(4_001.0), Role::Creator, 5100, 2))
        .add_rule(DistributionRule::new(mcap!(4_001.0), Role::Community, 1200, 3))
        .add_rule(DistributionRule::new(mcap!(10_001.0), Role::Platform, 4000, 1))
        .add_rule(DistributionRule::new(mcap!(10_001.0), Role::Creator, 4900, 2))
        .add_rule(DistributionRule::new(mcap!(10_001.0), Role::Community, 1100, 3))
        .add_rule(DistributionRule::new(mcap!(20_001.0), Role::Platform, 4300, 1))
        .add_rule(DistributionRule::new(mcap!(20_001.0), Role::Creator, 4700, 2))
        .add_rule(DistributionRule::new(mcap!(20_001.0), Role::Community, 1000, 3))
        .add_rule(DistributionRule::new(mcap!(30_001.0), Role::Platform, 4700, 1))
        .add_rule(DistributionRule::new(mcap!(30_001.0), Role::Creator, 4400, 2))
        .add_rule(DistributionRule::new(mcap!(30_001.0), Role::Community, 900, 3))
        .add_rule(DistributionRule::new(mcap!(50_001.0), Role::Platform, 5100, 1))
        .add_rule(DistributionRule::new(mcap!(50_001.0), Role::Creator, 4100, 2))
        .add_rule(DistributionRule::new(mcap!(50_001.0), Role::Community, 800, 3))
        .add_rule(DistributionRule::new(mcap!(70_001.0), Role::Platform, 5600, 1))
        .add_rule(DistributionRule::new(mcap!(70_001.0), Role::Creator, 3700, 2))
        .add_rule(DistributionRule::new(mcap!(70_001.0), Role::Community, 700, 3))
        .add_rule(DistributionRule::new(mcap!(100_001.0), Role::Platform, 6000, 1))
        .add_rule(DistributionRule::new(mcap!(100_001.0), Role::Creator, 3400, 2))
        .add_rule(DistributionRule::new(mcap!(100_001.0), Role::Community, 600, 3));

    Ok(())
}
