use anchor_lang::prelude::*;

use crate::{
    constants::SEED_ROOT,
    errors::ErrorCode,
    state::{EngineConfig, LaunchPreset},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitLaunchPresetParams {
    pub hard_cap_lamports: u64,
    pub min_raise_lamports: u64,
    pub per_wallet_cap: u64,
    pub tau_lamports: u64,
    pub base_total_allocation: u64,
    pub base_sale_basis_points: u64,
    pub team_allocation_basis_points: u64,
    pub funding_duration_seconds: i64,
    pub unlock_time_sec: i64,
    pub creator_period_unlock: u64,
    pub creator_period_sec: i64,
    pub creator_max_deposit: u64,
    pub pool_creation_grace_period_sec: i64,
    pub team_duration_sec: i64,
    pub team_period_sec: i64,
    pub contributor_duration_sec: i64,
    pub contributor_period_sec: i64,
    pub withdrawal_limit: u8,
    pub creation_fee: u64,
}

#[derive(Accounts)]
#[instruction(id: u8)]
pub struct InitLaunchPreset<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [SEED_ROOT, b"config"],
        bump
    )]
    pub engine_config: Account<'info, EngineConfig>,
    #[account(
        init,
        payer = payer,
        space = 8 + LaunchPreset::INIT_SPACE,
        seeds = [SEED_ROOT, b"preset", &[id]],
        bump
    )]
    pub launch_preset: Account<'info, LaunchPreset>,
    pub system_program: Program<'info, System>,
}

pub fn init_launch_preset(
    ctx: Context<InitLaunchPreset>,
    id: u8,
    params: InitLaunchPresetParams,
) -> Result<()> {
    let cfg = &ctx.accounts.engine_config;

    require!(cfg.admins.iter().any(|k| *k == ctx.accounts.payer.key()), ErrorCode::Unauthorized);
    let signer_set: std::collections::BTreeSet<Pubkey> =
        ctx.remaining_accounts.iter().filter(|ai| ai.is_signer).map(|ai| ai.key()).collect();
    let mut signed = 0u8;
    for k in cfg.admins.iter() {
        if signer_set.contains(k) {
            signed = signed.saturating_add(1);
        }
    }
    require!(signed >= cfg.threshold, ErrorCode::NotEnoughAdminSigners);

    let p = &mut ctx.accounts.launch_preset;
    p.id = id;
    p.hard_cap_lamports = params.hard_cap_lamports;
    p.min_raise_lamports = params.min_raise_lamports;
    p.per_wallet_cap = params.per_wallet_cap;
    p.tau_lamports = params.tau_lamports;
    p.base_total_allocation = params.base_total_allocation;
    p.base_sale_basis_points = params.base_sale_basis_points;
    p.team_allocation_basis_points = params.team_allocation_basis_points;
    p.funding_duration_seconds = params.funding_duration_seconds;
    p.unlock_time_sec = params.unlock_time_sec;
    p.creator_period_unlock = params.creator_period_unlock;
    p.creator_period_sec = params.creator_period_sec;
    p.creator_max_deposit = params.creator_max_deposit;
    p.pool_creation_grace_period_sec = params.pool_creation_grace_period_sec;
    p.team_duration_sec = params.team_duration_sec;
    p.team_period_sec = params.team_period_sec;
    p.contributor_duration_sec = params.contributor_duration_sec;
    p.contributor_period_sec = params.contributor_period_sec;
    p.withdrawal_limit = params.withdrawal_limit;
    p.creation_fee = params.creation_fee;

    require!(p.is_valid(), ErrorCode::MalformedPreset);
    Ok(())
}
