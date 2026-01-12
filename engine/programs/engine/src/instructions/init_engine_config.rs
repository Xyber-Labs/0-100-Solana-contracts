use anchor_lang::prelude::*;

use crate::{constants::SEED_ROOT, DEPLOYER, errors::ErrorCode, state::{EngineConfig, ProjectCounter}};

#[derive(Accounts)]
#[instruction(params: EngineConfig)]
pub struct InitEngineConfig<'info> {
    #[account(
        signer, mut,
        constraint = engine_config.multisig == Pubkey::default() && multisig.key() == DEPLOYER ||
                     engine_config.multisig == multisig.key() @ ErrorCode::Unauthorized,
        constraint = params.multisig != Pubkey::default() @ ErrorCode::InvalidParams
    )]
    pub multisig: Signer<'info>,

    #[account(init_if_needed, payer = multisig, space = 8 + EngineConfig::INIT_SPACE, seeds = [SEED_ROOT, b"config"], bump)]
    pub engine_config: Account<'info, EngineConfig>,

    #[account(init_if_needed, payer = multisig, space = 8 + ProjectCounter::INIT_SPACE, seeds = [SEED_ROOT, b"project_counter"], bump)]
    pub project_counter: Account<'info, ProjectCounter>,

    /// CHECK: PDA for storing SOL to pay for realloc operations (zero-data, program-owned)
    #[account(init_if_needed, payer = multisig, space = 0, seeds = [SEED_ROOT, b"realloc_funds"], bump)]
    pub realloc_funds: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn init_engine_config(
    ctx: Context<InitEngineConfig>,
    params: EngineConfig,
    realloc_fund_lamports: u64,
) -> Result<()> {
    *ctx.accounts.engine_config = params;

    let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
        &ctx.accounts.multisig.key(),
        &ctx.accounts.realloc_funds.key(),
        realloc_fund_lamports,
    );
    anchor_lang::solana_program::program::invoke(
        &transfer_ix,
        &[
            ctx.accounts.multisig.to_account_info(),
            ctx.accounts.realloc_funds.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
    )?;

    Ok(())
}
