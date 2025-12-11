use anchor_lang::prelude::*;

use crate::{
    DISPATCHER_SEED_ROOT,
    errors::ErrorCode,
    income_calculator::{DistributionRule, IncomeCalculator, mcap},
    state::{Config, Role},
};

#[cfg(feature = "devnet")]
const DEPLOYER: Pubkey = pubkey!("3paTDrXrsXjh9J3KLwSNup3nMPRSbSjS1h3iYTKPfqbP");

#[cfg(not(feature = "devnet"))]
const DEPLOYER: Pubkey = pubkey!("7xLqtwhLTSmXwNi3ddwpoxsCcGQXtvwdMCd3YdtgHVnF");

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        mut,
        constraint = (config.admin.is_none() && admin.key() == DEPLOYER) || config.admin == Some(admin.key())
        @ ErrorCode::Unauthorized
    )]
    pub admin: Signer<'info>,
    #[account(
        init_if_needed,
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
    config.admin = Some(ctx.accounts.admin.key());
    config.platform_wallet = platform_wallet;
    config.community_wallet = community_wallet;

    config.income_calculator = IncomeCalculator::new(engine::constants::BASE_TOKEN_DECIMALS)?
        .add_rule(DistributionRule::new(mcap!(0.0), Role::Treasure, 1200, 1))
        .add_rule(DistributionRule::new(mcap!(0.0), Role::BuyBack, 4800, 2))
        .add_rule(DistributionRule::new(mcap!(0.0), Role::Creator, 2500, 3))
        .add_rule(DistributionRule::new(mcap!(0.0), Role::Community, 1500, 4))
        .add_rule(DistributionRule::new(mcap!(501.0), Role::Treasure, 600, 1))
        .add_rule(DistributionRule::new(mcap!(501.0), Role::BuyBack, 2400, 2))
        .add_rule(DistributionRule::new(mcap!(501.0), Role::Creator, 5600, 3))
        .add_rule(DistributionRule::new(mcap!(501.0), Role::Community, 1400, 4))
        .add_rule(DistributionRule::new(mcap!(1_501.0), Role::Treasure, 680, 1))
        .add_rule(DistributionRule::new(mcap!(1_501.0), Role::BuyBack, 2720, 2))
        .add_rule(DistributionRule::new(mcap!(1_501.0), Role::Creator, 5300, 3))
        .add_rule(DistributionRule::new(mcap!(1_501.0), Role::Community, 1300, 4))
        .add_rule(DistributionRule::new(mcap!(4_001.0), Role::Treasure, 740, 1))
        .add_rule(DistributionRule::new(mcap!(4_001.0), Role::BuyBack, 2960, 2))
        .add_rule(DistributionRule::new(mcap!(4_001.0), Role::Creator, 5100, 3))
        .add_rule(DistributionRule::new(mcap!(4_001.0), Role::Community, 1200, 4))
        .add_rule(DistributionRule::new(mcap!(10_001.0), Role::Treasure, 800, 1))
        .add_rule(DistributionRule::new(mcap!(10_001.0), Role::BuyBack, 3200, 2))
        .add_rule(DistributionRule::new(mcap!(10_001.0), Role::Creator, 4900, 3))
        .add_rule(DistributionRule::new(mcap!(10_001.0), Role::Community, 1100, 4))
        .add_rule(DistributionRule::new(mcap!(20_001.0), Role::Treasure, 860, 1))
        .add_rule(DistributionRule::new(mcap!(20_001.0), Role::BuyBack, 3440, 2))
        .add_rule(DistributionRule::new(mcap!(20_001.0), Role::Creator, 4700, 3))
        .add_rule(DistributionRule::new(mcap!(20_001.0), Role::Community, 1000, 4))
        .add_rule(DistributionRule::new(mcap!(30_001.0), Role::Treasure, 940, 1))
        .add_rule(DistributionRule::new(mcap!(30_001.0), Role::BuyBack, 3760, 2))
        .add_rule(DistributionRule::new(mcap!(30_001.0), Role::Creator, 4400, 3))
        .add_rule(DistributionRule::new(mcap!(30_001.0), Role::Community, 900, 4))
        .add_rule(DistributionRule::new(mcap!(50_001.0), Role::Treasure, 1020, 1))
        .add_rule(DistributionRule::new(mcap!(50_001.0), Role::BuyBack, 4080, 2))
        .add_rule(DistributionRule::new(mcap!(50_001.0), Role::Creator, 4100, 3))
        .add_rule(DistributionRule::new(mcap!(50_001.0), Role::Community, 800, 4))
        .add_rule(DistributionRule::new(mcap!(70_001.0), Role::Treasure, 1120, 1))
        .add_rule(DistributionRule::new(mcap!(70_001.0), Role::BuyBack, 4480, 2))
        .add_rule(DistributionRule::new(mcap!(70_001.0), Role::Creator, 3700, 3))
        .add_rule(DistributionRule::new(mcap!(70_001.0), Role::Community, 700, 4))
        .add_rule(DistributionRule::new(mcap!(100_001.0), Role::Treasure, 1200, 1))
        .add_rule(DistributionRule::new(mcap!(100_001.0), Role::BuyBack, 4800, 2))
        .add_rule(DistributionRule::new(mcap!(100_001.0), Role::Creator, 3400, 3))
        .add_rule(DistributionRule::new(mcap!(100_001.0), Role::Community, 600, 4));
    require!(config.income_calculator.is_valid(), ErrorCode::InvalidCalculator);
    Ok(())
}
