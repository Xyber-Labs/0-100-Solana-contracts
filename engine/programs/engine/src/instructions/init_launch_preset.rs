use anchor_lang::prelude::*;

use crate::{
    constants::SEED_ROOT,
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
    pub roster_shard_cap: u16,
    pub roster_shards_total: u16,
    pub creator_initial_deposit_lamports: u64,
    pub creator_daily_lamports_limit: u64,
    pub creator_claim_lock_period_sec: i64,
    pub creator_max_deposit: u64,
    pub pool_creation_grace_period_sec: i64,
    pub team_vesting_duration_sec: i64,
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
    // Ensure caller is an admin and quorum satisfied
    require!(
        cfg.admins.iter().any(|k| *k == ctx.accounts.payer.key()),
        crate::errors::ErrorCode::Unauthorized
    );
    let signer_set: std::collections::BTreeSet<Pubkey> =
        ctx.remaining_accounts.iter().filter(|ai| ai.is_signer).map(|ai| ai.key()).collect();
    let mut signed = 0u8;
    for k in cfg.admins.iter() {
        if signer_set.contains(k) {
            signed = signed.saturating_add(1);
        }
    }
    require!((signed as u8) >= cfg.threshold, crate::errors::ErrorCode::NotEnoughAdminSigners);

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
    p.roster_shard_cap = params.roster_shard_cap;
    p.roster_shards_total = params.roster_shards_total;
    p.creator_initial_deposit_lamports = params.creator_initial_deposit_lamports;
    p.creator_daily_lamports_limit = params.creator_daily_lamports_limit;
    p.creator_claim_lock_period_sec = params.creator_claim_lock_period_sec;
    p.creator_max_deposit = params.creator_max_deposit;
    p.pool_creation_grace_period_sec = params.pool_creation_grace_period_sec;
    p.team_vesting_duration_sec = params.team_vesting_duration_sec;

    p.is_valid()?;

    Ok(())
}
