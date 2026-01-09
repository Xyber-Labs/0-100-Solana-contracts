use anchor_lang::{
    prelude::*,
    solana_program::{
        keccak,
        sysvar::{clock::Clock, Sysvar},
    },
};
use anchor_spl::token::{self, Token, TokenAccount};

use crate::{
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    MYRIAD,
    state::{
        Contribution, EngineConfig, LaunchPreset, LaunchState, ProjectCounter, TokenMetadataConfig,
    },
};

#[event]
pub struct Initialized {
    pub launch: Pubkey,
    pub project_id: u64,
    pub creator: Pubkey,
    pub preset_id: u8,
    pub funding_start: i64,
    pub pending_key: [u8; 32],
}

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
pub struct InitLaunch<'info> {
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
        init,
        payer = creator,
        space = 8 + TokenMetadataConfig::INIT_SPACE,
        seeds = [SEED_ROOT, b"token_metadata", launch_state.key().as_ref()],
        bump
    )]
    pub token_metadata_config: Box<Account<'info, TokenMetadataConfig>>,
    #[account(seeds = [SEED_ROOT, b"config"], bump)]
    pub engine_config: Box<Account<'info, EngineConfig>>,
    #[account(mut, token::mint = engine_config.xyber_mint, token::authority = creator)]
    pub creator_xyber_ata: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = engine_config.xyber_mint, token::authority = engine_config.treasury)]
    pub treasury_xyber_ata: Box<Account<'info, TokenAccount>>,
    #[account(
        seeds = [SEED_ROOT, b"preset", &[preset_id]],
        bump,
        constraint = launch_preset.is_enabled @ EngineErrorCode::PresetDisabled
    )]
    pub launch_preset: Box<Account<'info, LaunchPreset>>,
    /// CHECK: Raw winners bitmap, initialized as zero-sized, reallocated on deposit
    #[account(
        init,
        payer = creator,
        space = 0,
        seeds = [SEED_ROOT, b"winners_bitmap", launch_state.key().as_ref()],
        bump
    )]
    pub winners_bitmap: UncheckedAccount<'info>,
    /// CHECK: Raw inactive bitmap, initialized as zero-sized, reallocated on deposit
    #[account(
        init,
        payer = creator,
        space = 0,
        seeds = [SEED_ROOT, b"inactive_bitmap", launch_state.key().as_ref()],
        bump
    )]
    pub inactive_bitmap: UncheckedAccount<'info>,
    #[account(
        init,
        payer = creator,
        space = 8 + Contribution::INIT_SPACE,
        seeds = [SEED_ROOT, b"contributor", launch_state.key().as_ref(), creator.key().as_ref()],
        bump
    )]
    pub creator_contribution: Box<Account<'info, Contribution>>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn init_launch(
    ctx: Context<InitLaunch>,
    _preset_id: u8,
    project_id: u64,
    sale_start_time_timestamp: i64,
    meta: TokenMetadataInput,
) -> Result<()> {
    let p = &ctx.accounts.launch_preset;
    let creator = &ctx.accounts.creator;

    require!(p.is_valid(), EngineErrorCode::MalformedPreset);
    validate_meta(&meta)?;

    let fee = p.creation_fee;
    if fee > 0 {
        let creator_xyber_ata = &ctx.accounts.creator_xyber_ata;
        let treasury_xyber_ata = &ctx.accounts.treasury_xyber_ata;

        require!(creator_xyber_ata.amount >= fee, EngineErrorCode::InsufficientFeeBalance);

        let cpi_accounts = token::Transfer {
            from: creator_xyber_ata.to_account_info(),
            to: treasury_xyber_ata.to_account_info(),
            authority: creator.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, fee)?;
    }

    let counter = &mut ctx.accounts.project_counter;
    let expected_next =
        counter.last_project_id.checked_add(1).ok_or(EngineErrorCode::ArithmeticOverflow)?;
    require!(project_id == expected_next, EngineErrorCode::Unauthorized);
    counter.last_project_id = project_id;

    let now = Clock::get()?.unix_timestamp;
    let start = if sale_start_time_timestamp <= now { now } else { sale_start_time_timestamp };

    let state = &mut ctx.accounts.launch_state;
    state.project_id = project_id;
    state.creator = creator.key();
    state.preset = ctx.accounts.launch_preset.key();
    state.created_at = now;
    state.set_funding(start);

    let pending_key = make_pending_key(&creator.key(), project_id);
    let launch_key = state.key();

    emit!(Initialized {
        launch: launch_key,
        project_id,
        creator: creator.key(),
        preset_id: p.id,
        funding_start: start,
        pending_key,
    });

    let token_meta = &mut ctx.accounts.token_metadata_config;
    token_meta.launch = state.key();
    token_meta.name = meta.name;
    token_meta.symbol = meta.symbol;
    token_meta.uri = meta.uri;
    token_meta.is_mutable = meta.is_mutable;
    token_meta.seller_fee_basis_points = meta.seller_fee_basis_points;

    Ok(())
}

fn validate_meta(meta: &TokenMetadataInput) -> Result<()> {
    require!(meta.seller_fee_basis_points <= MYRIAD as u16, EngineErrorCode::InvalidParams);
    require!(meta.name.len() <= 32, EngineErrorCode::InvalidParams);
    require!(meta.symbol.len() <= 10, EngineErrorCode::InvalidParams);
    require!(meta.uri.len() <= 200, EngineErrorCode::InvalidParams);
    Ok(())
}

fn make_pending_key(creator: &Pubkey, project_id: u64) -> [u8; 32] {
    let h = keccak::hashv(&[
        b"xyber|pending|v1",
        creator.as_ref(),
        &project_id.to_le_bytes(),
        crate::ID.as_ref(),
    ]);
    h.to_bytes()
}
