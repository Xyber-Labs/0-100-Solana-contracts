use crate::utils::launch_core::{init_launch_core, InitLaunchParams};
use crate::errors::ErrorCode as EngineErrorCode;
use crate::{
    constants::SEED_ROOT,
    state::{CreatorGrant, EngineConfig, LaunchState, ProjectCounter, TokenMetadataConfig},
};
use anchor_lang::{prelude::*, solana_program::sysvar::Sysvar};
use anchor_spl::token::{Token, TokenAccount};

#[derive(Accounts)]
#[instruction(params: InitLaunchParams, project_id: u64)]
pub struct InitLaunch<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    /// Global project counter
    #[account(
        init_if_needed,
        payer = creator,
        space = 8 + ProjectCounter::INIT_SPACE,
        seeds = [SEED_ROOT, b"project_counter"],
        bump
    )]
    pub project_counter: Account<'info, ProjectCounter>,

    #[account(
        init,
        payer = creator,
        space = 8 + LaunchState::INIT_SPACE,
        seeds = [SEED_ROOT, b"launch", &project_id.to_le_bytes()],
        bump
    )]
    pub launch_state: Account<'info, LaunchState>,

    // base_mint removed from init; it will be created and recorded later during pool/mint setup
    /// CHECK: Escrow authority PDA without data for SOL storage
    #[account(mut, seeds = [SEED_ROOT, b"escrow_authority", launch_state.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,

    /// Creator grant account (PDA off launch_state)
    #[account(
        init_if_needed,
        payer = creator,
        space = 8 + CreatorGrant::INIT_SPACE,
        seeds = [SEED_ROOT, b"creator", launch_state.key().as_ref()],
        bump
    )]
    pub creator_grant: Account<'info, CreatorGrant>,

    #[account(
        init,
        payer = creator,
        space = 8 + TokenMetadataConfig::INIT_SPACE,
        seeds = [SEED_ROOT, b"token_metadata", launch_state.key().as_ref()],
        bump
    )]
    pub token_metadata_config: Account<'info, TokenMetadataConfig>,

    #[account(
        seeds = [SEED_ROOT, b"config"],
        bump
    )]
    pub engine_config: Account<'info, EngineConfig>,

    #[account(mut)]
    pub creator_xyber_ata: Account<'info, TokenAccount>,
    #[account(mut)]
    pub treasury_xyber_ata: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn init_launch(
    ctx: Context<InitLaunch>,
    params: InitLaunchParams,
    project_id: u64,
) -> Result<()> {
    // Only admins can call direct init_launch in non-test builds
    if cfg!(not(feature = "test")) {
        let is_admin = ctx
            .accounts
            .engine_config
            .admins
            .iter()
            .any(|k| *k == ctx.accounts.creator.key());
        require!(is_admin, EngineErrorCode::Unauthorized);
    }
    init_launch_core(
        &ctx.accounts.creator,
        &mut ctx.accounts.project_counter,
        &mut ctx.accounts.launch_state,
        &ctx.accounts.escrow_authority,
        &mut ctx.accounts.creator_grant,
        &mut ctx.accounts.token_metadata_config,
        &ctx.accounts.engine_config,
        &ctx.accounts.creator_xyber_ata,
        &ctx.accounts.treasury_xyber_ata,
        &ctx.accounts.system_program,
        &ctx.accounts.token_program,
        params,
        project_id,
    )
}

#[cfg(test)]
mod tests {}
