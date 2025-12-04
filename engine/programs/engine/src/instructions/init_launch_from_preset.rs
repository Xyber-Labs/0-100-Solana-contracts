use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::{
    constants::SEED_ROOT,
    state::{
        CreatorGrant, EngineConfig, LaunchPreset, LaunchState, ProjectCounter, TokenMetadataConfig,
    },
    utils::launch_core::{init_launch_core, InitLaunchParams},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TokenMetadataInput {
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub is_mutable: bool,
    pub seller_fee_basis_points: u16,
}

#[derive(Accounts)]
#[instruction(preset_id: u8, project_id: u64)]
pub struct InitLaunchFromPreset<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init_if_needed,
        payer = creator,
        space = 8 + ProjectCounter::INIT_SPACE,
        seeds = [SEED_ROOT, b"project_counter"],
        bump
    )]
    pub project_counter: Box<Account<'info, ProjectCounter>>,
    #[account(
        init,
        payer = creator,
        space = 8 + LaunchState::INIT_SPACE,
        seeds = [SEED_ROOT, b"launch", &project_id.to_le_bytes()],
        bump
    )]
    pub launch_state: Box<Account<'info, LaunchState>>,
    /// CHECK: PDA for SOL escrow
    #[account(mut, seeds = [SEED_ROOT, b"escrow_authority", launch_state.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = creator,
        space = 8 + CreatorGrant::INIT_SPACE,
        seeds = [SEED_ROOT, b"creator", launch_state.key().as_ref()],
        bump
    )]
    pub creator_grant: Box<Account<'info, CreatorGrant>>,
    #[account(
        init,
        payer = creator,
        space = 8 + TokenMetadataConfig::INIT_SPACE,
        seeds = [SEED_ROOT, b"token_metadata", launch_state.key().as_ref()],
        bump
    )]
    pub token_metadata_config: Box<Account<'info, TokenMetadataConfig>>,
    #[account(seeds = [SEED_ROOT, b"config"], bump)]
    pub engine_config: Box<Account<'info, EngineConfig>>,
    #[account(mut)]
    pub creator_xyber_ata: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub treasury_xyber_ata: Box<Account<'info, TokenAccount>>,
    #[account(seeds = [SEED_ROOT, b"preset", &[preset_id]], bump)]
    pub launch_preset: Box<Account<'info, LaunchPreset>>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn init_launch_from_preset(
    ctx: Context<InitLaunchFromPreset>,
    preset_id: u8,
    project_id: u64,
    sale_start_time_timestamp: i64,
    meta: TokenMetadataInput,
) -> Result<()> {
    require!(ctx.accounts.launch_preset.id == preset_id, crate::errors::ErrorCode::Unauthorized);
    let p = &ctx.accounts.launch_preset;
    let params = InitLaunchParams {
        hard_cap_lamports: p.hard_cap_lamports,
        min_raise_lamports: p.min_raise_lamports,
        per_wallet_cap: p.per_wallet_cap,
        tau_lamports: p.tau_lamports,
        base_total_allocation: p.base_total_allocation,
        base_sale_basis_points: p.base_sale_basis_points,
        team_allocation_basis_points: p.team_allocation_basis_points,
        funding_duration_seconds: p.funding_duration_seconds,
        sale_start_time_timestamp,
        unlock_time_sec: p.unlock_time_sec,
        roster_shard_cap: p.roster_shard_cap,
        roster_shards_total: p.roster_shards_total,
        creator_initial_deposit_lamports: p.creator_initial_deposit_lamports,
        creator_daily_lamports_limit: p.creator_daily_lamports_limit,
        creator_claim_lock_period_sec: p.creator_claim_lock_period_sec,
        creator_max_deposit: p.creator_max_deposit,
        pool_creation_grace_period_sec: p.pool_creation_grace_period_sec,
        team_vesting_duration_sec: p.team_vesting_duration_sec,
        name: meta.name,
        symbol: meta.symbol,
        uri: meta.uri,
        is_mutable: meta.is_mutable,
        seller_fee_basis_points: meta.seller_fee_basis_points,
    };

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
