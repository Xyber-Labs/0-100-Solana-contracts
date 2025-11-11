use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint as InterfaceMint;

pub fn init_project(ctx: Context<InitProject>, project_id: [u8; 32]) -> Result<()> {
    let base_mint = ctx.accounts.base_mint.key();
    let quote_mint = ctx.accounts.quote_mint.key();
    let creator = ctx.accounts.creator.key();

    // Initialize the project pool
    let project_pool = &mut ctx.accounts.project_pool;
    project_pool.project_id = project_id;
    project_pool.creator = creator;
    project_pool.base_mint = base_mint;
    project_pool.base_decimals = ctx.accounts.base_mint.decimals;
    project_pool.quote_mint = quote_mint;
    project_pool.quote_decimals = ctx.accounts.quote_mint.decimals;
    project_pool.total_base_claimed = 0;
    project_pool.total_quote_claimed = 0;
    project_pool.total_claimed_in_base = 0;
    project_pool.total_claimed_in_quote = 0;

    Ok(())
}

#[derive(Accounts)]
#[instruction(project_id: [u8; 32])]
pub struct InitProject<'info> {
    /// The project initializer (must match config.project_initializer)
    #[account(
        mut,
        constraint = initializer.key() == config.project_initializer @ crate::errors::ErrorCode::Unauthorized
    )]
    pub initializer: Signer<'info>,

    /// The creator of the project
    pub creator: Signer<'info>,

    /// Config account containing project_initializer
    #[account(
        seeds = [crate::SEED_ROOT, b"config"],
        bump,
    )]
    pub config: Account<'info, crate::state::Config>,

    /// Project pool account to initialize
    #[account(
        init,
        payer = initializer,
        space = 8 + crate::state::ProjectPool::INIT_SPACE,
        seeds = [crate::SEED_ROOT, b"project_pool", project_id.as_ref()],
        bump,
    )]
    pub project_pool: Account<'info, crate::state::ProjectPool>,

    /// Base mint for the project
    pub base_mint: InterfaceAccount<'info, InterfaceMint>,

    /// Quote mint for the project (WSOL)
    #[account(address = anchor_lang::solana_program::pubkey!("So11111111111111111111111111111111111111112"))]
    pub quote_mint: InterfaceAccount<'info, InterfaceMint>,

    pub system_program: Program<'info, System>,
}
