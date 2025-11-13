use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint as InterfaceMint;

use crate::income_calculator::{DistributionRule, IncomeCalculator};

pub fn init_project(ctx: Context<InitProject>, project_id: u64) -> Result<()> {
    let base_mint = ctx.accounts.base_mint.key();
    let quote_mint = ctx.accounts.quote_mint.key();
    let creator = ctx.accounts.creator.key();

    // Initialize the IncomeCalculator with distribution rules
    // Using a default price of 1:1 for initialization (will be updated later)
    let calculator = IncomeCalculator::new(ctx.accounts.base_mint.decimals)?
        // Tier 1: Market cap 0-500
        .add_rule(DistributionRule::new(0, ctx.accounts.config.platform_wallet, 6000, 1))
        .add_rule(DistributionRule::new(0, creator, 2500, 2))
        .add_rule(DistributionRule::new(0, ctx.accounts.config.community_claim_signer, 1500, 3))
        // Tier 2: Market cap 501-1500
        .add_rule(DistributionRule::new(501, ctx.accounts.config.platform_wallet, 3000, 1))
        .add_rule(DistributionRule::new(501, creator, 5600, 2))
        .add_rule(DistributionRule::new(501, ctx.accounts.config.community_claim_signer, 1400, 3))
        // Tier 3: Market cap 1501-4000
        .add_rule(DistributionRule::new(1_501, ctx.accounts.config.platform_wallet, 3400, 1))
        .add_rule(DistributionRule::new(1_501, creator, 5300, 2))
        .add_rule(DistributionRule::new(1_501, ctx.accounts.config.community_claim_signer, 1300, 3))
        // Tier 4: Market cap 4001-10000
        .add_rule(DistributionRule::new(4_001, ctx.accounts.config.platform_wallet, 3700, 1))
        .add_rule(DistributionRule::new(4_001, creator, 5100, 2))
        .add_rule(DistributionRule::new(4_001, ctx.accounts.config.community_claim_signer, 1200, 3))
        // Tier 5: Market cap 10001-20000
        .add_rule(DistributionRule::new(10_001, ctx.accounts.config.platform_wallet, 4000, 1))
        .add_rule(DistributionRule::new(10_001, creator, 4900, 2))
        .add_rule(DistributionRule::new(
            10_001,
            ctx.accounts.config.community_claim_signer,
            1100,
            3,
        ))
        // Tier 6: Market cap 20001-30000
        .add_rule(DistributionRule::new(20_001, ctx.accounts.config.platform_wallet, 4300, 1))
        .add_rule(DistributionRule::new(20_001, creator, 4700, 2))
        .add_rule(DistributionRule::new(
            20_001,
            ctx.accounts.config.community_claim_signer,
            1000,
            3,
        ))
        // Tier 7: Market cap 30001-50000
        .add_rule(DistributionRule::new(30_001, ctx.accounts.config.platform_wallet, 4700, 1))
        .add_rule(DistributionRule::new(30_001, creator, 4400, 2))
        .add_rule(DistributionRule::new(30_001, ctx.accounts.config.community_claim_signer, 900, 3))
        // Tier 8: Market cap 50001-70000
        .add_rule(DistributionRule::new(50_001, ctx.accounts.config.platform_wallet, 5100, 1))
        .add_rule(DistributionRule::new(50_001, creator, 4100, 2))
        .add_rule(DistributionRule::new(50_001, ctx.accounts.config.community_claim_signer, 800, 3))
        // Tier 9: Market cap 70001-100000
        .add_rule(DistributionRule::new(70_001, ctx.accounts.config.platform_wallet, 5600, 1))
        .add_rule(DistributionRule::new(70_001, creator, 3700, 2))
        .add_rule(DistributionRule::new(70_001, ctx.accounts.config.community_claim_signer, 700, 3))
        // Tier 10: Market cap 100001+
        .add_rule(DistributionRule::new(100_001, ctx.accounts.config.platform_wallet, 6000, 1))
        .add_rule(DistributionRule::new(100_001, creator, 3400, 2))
        .add_rule(DistributionRule::new(
            100_001,
            ctx.accounts.config.community_claim_signer,
            600,
            3,
        ));

    // Initialize the project pool
    let project_pool = &mut ctx.accounts.project_pool;
    project_pool.project_id = project_id;
    project_pool.creator = creator;
    project_pool.base_mint = base_mint;
    project_pool.base_decimals = ctx.accounts.base_mint.decimals;
    project_pool.quote_mint = quote_mint;
    project_pool.quote_decimals = ctx.accounts.quote_mint.decimals;
    project_pool.pool_state = ctx.accounts.pool_state.key();
    project_pool.total_base_claimed = 0;
    project_pool.total_quote_claimed = 0;
    project_pool.total_claimed_in_base = 0;
    project_pool.total_claimed_in_quote = 0;
    project_pool.income_calculator = Some(calculator);

    Ok(())
}

#[derive(Accounts)]
#[instruction(project_id: u64)]
pub struct InitProject<'info> {
    /// Creator and payer for the project initialization
    #[account(mut)]
    pub creator: Signer<'info>,

    /// CHECK: Engine authority PDA for authorization
    #[account(
        seeds = [b"root-0-100-1", b"escrow_authority", launch_state.key().as_ref()],
        seeds::program = engine_program.key(),
        bump,
    )]
    pub engine_authority: UncheckedAccount<'info>,

    /// CHECK: Engine program ID
    pub engine_program: UncheckedAccount<'info>,

    /// CHECK: Launch state for project_id
    pub launch_state: UncheckedAccount<'info>,

    /// Config account containing project_initializer
    #[account(
        seeds = [crate::SEED_ROOT, b"config"],
        bump,
    )]
    pub config: Account<'info, crate::state::Config>,

    /// Project pool account to initialize
    #[account(
        init,
        payer = creator,
        space = 8 + crate::state::ProjectPool::INIT_SPACE,
        seeds = [crate::SEED_ROOT, b"project_pool", &project_id.to_be_bytes()],
        bump,
    )]
    pub project_pool: Account<'info, crate::state::ProjectPool>,

    /// Base mint for the project
    pub base_mint: InterfaceAccount<'info, InterfaceMint>,

    /// Quote mint for the project
    pub quote_mint: InterfaceAccount<'info, InterfaceMint>,

    /// CHECK: Metaplex metadata program
    pub metadata_program: UncheckedAccount<'info>,

    /// CHECK: Associated token program
    pub associated_token_program: UncheckedAccount<'info>,

    /// Raydium pool state account for this project
    /// CHECK: Raydium pool state - validated during claim by comparing with stored key
    pub pool_state: UncheckedAccount<'info>,

    /// System program
    pub system_program: Program<'info, System>,
}
