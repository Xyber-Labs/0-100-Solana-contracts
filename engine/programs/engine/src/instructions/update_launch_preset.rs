use crate::{constants::SEED_ROOT, state::{EngineConfig, LaunchPreset}};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(id: u8)]
pub struct UpdateLaunchPreset<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [SEED_ROOT, b"config"],
        bump
    )]
    pub engine_config: Account<'info, EngineConfig>,
    #[account(
        mut,
        seeds = [SEED_ROOT, b"preset", &[id]],
        bump,
        constraint = launch_preset.id == id
    )]
    pub launch_preset: Account<'info, LaunchPreset>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct UpdateLaunchParams {
    pub hard_cap_lamports: Option<u64>,
    pub min_raise_lamports: Option<u64>,
    pub per_wallet_cap: Option<u64>,
    pub tau_lamports: Option<u64>,
    pub base_total_allocation: Option<u64>,
    pub base_sale_basis_points: Option<u64>,
    pub team_allocation_basis_points: Option<u64>,
    pub funding_duration_seconds: Option<i64>,
    pub sale_start_time_sec: Option<i64>,
    pub unlock_time_sec: Option<i64>,
    pub roster_shard_cap: Option<u16>,
    pub roster_shards_total: Option<u16>,
    pub creator_initial_deposit_lamports: Option<u64>,
    pub creator_daily_lamports_limit: Option<u64>,
    pub creator_claim_lock_period_sec: Option<i64>,
    pub creator_max_deposit: Option<u64>,
    pub pool_creation_grace_period_sec: Option<i64>,
    pub team_vesting_duration_sec: Option<i64>,
}

pub fn update_launch_preset(
    ctx: Context<UpdateLaunchPreset>,
    _id: u8,
    patch: UpdateLaunchParams,
) -> Result<()> {
    let cfg = &ctx.accounts.engine_config;
    let signer_set: std::collections::BTreeSet<Pubkey> = ctx
        .remaining_accounts
        .iter()
        .filter(|ai| ai.is_signer)
        .map(|ai| ai.key())
        .collect();
    let mut signed = 0u8;
    for k in cfg.admins.iter() {
        if signer_set.contains(k) {
            signed = signed.saturating_add(1);
        }
    }
    require!((signed as u8) >= cfg.threshold, crate::errors::ErrorCode::NotEnoughAdminSigners);

    let p = &mut ctx.accounts.launch_preset;
    if let Some(v) = patch.hard_cap_lamports { p.hard_cap_lamports = v; }
    if let Some(v) = patch.min_raise_lamports { p.min_raise_lamports = v; }
    if let Some(v) = patch.per_wallet_cap { p.per_wallet_cap = v; }
    if let Some(v) = patch.tau_lamports { p.tau_lamports = v; }
    if let Some(v) = patch.base_total_allocation { p.base_total_allocation = v; }
    if let Some(v) = patch.base_sale_basis_points { p.base_sale_basis_points = v; }
    if let Some(v) = patch.team_allocation_basis_points { p.team_allocation_basis_points = v; }
    if let Some(v) = patch.funding_duration_seconds { p.funding_duration_seconds = v; }
    if let Some(v) = patch.sale_start_time_sec { p.sale_start_time_sec = v; }
    if let Some(v) = patch.unlock_time_sec { p.unlock_time_sec = v; }
    if let Some(v) = patch.roster_shard_cap { p.roster_shard_cap = v; }
    if let Some(v) = patch.roster_shards_total { p.roster_shards_total = v; }
    if let Some(v) = patch.creator_initial_deposit_lamports { p.creator_initial_deposit_lamports = v; }
    if let Some(v) = patch.creator_daily_lamports_limit { p.creator_daily_lamports_limit = v; }
    if let Some(v) = patch.creator_claim_lock_period_sec { p.creator_claim_lock_period_sec = v; }
    if let Some(v) = patch.creator_max_deposit { p.creator_max_deposit = v; }
    if let Some(v) = patch.pool_creation_grace_period_sec { p.pool_creation_grace_period_sec = v; }
    if let Some(v) = patch.team_vesting_duration_sec { p.team_vesting_duration_sec = v; }

    Ok(())
}


