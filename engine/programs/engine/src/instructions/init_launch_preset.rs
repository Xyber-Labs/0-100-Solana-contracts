use anchor_lang::prelude::*;

use crate::{
    constants::SEED_ROOT,
    errors::ErrorCode,
    state::{EngineConfig, LaunchPreset},
};

#[derive(Accounts)]
#[instruction(params: LaunchPreset,)]
pub struct InitLaunchPreset<'info> {
    #[account(mut, address = engine_config.multisig @ ErrorCode::Unauthorized)]
    pub multisig: Signer<'info>,
    #[account(seeds = [SEED_ROOT, b"config"], bump)]
    pub engine_config: Account<'info, EngineConfig>,
    #[account(
        init_if_needed,
        payer = multisig,
        space = 8 + LaunchPreset::INIT_SPACE,
        seeds = [SEED_ROOT, b"preset", &[params.id]],
        bump
    )]
    pub launch_preset: Account<'info, LaunchPreset>,
    pub system_program: Program<'info, System>,
}

pub fn init_launch_preset(ctx: Context<InitLaunchPreset>, params: LaunchPreset) -> Result<()> {
    require!(params.is_valid(), ErrorCode::MalformedPreset);
    *ctx.accounts.launch_preset = params;
    Ok(())
}
