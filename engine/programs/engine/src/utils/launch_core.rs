use crate::{
    errors::ErrorCode as EngineErrorCode,
    events::{CreatorGranted, LaunchInitialized},
    state::{CreatorGrant, EngineConfig, LaunchState, ProjectCounter, TokenMetadataConfig},
};
use anchor_lang::solana_program::keccak;
use anchor_lang::{
    prelude::*,
    solana_program::sysvar::{clock::Clock, Sysvar},
};
use anchor_spl::token::{self, Token, TokenAccount};

fn make_pending_key(creator: &Pubkey, project_id: u64) -> [u8; 32] {
    let h = keccak::hashv(&[
        b"xyber|pending|v1",
        creator.as_ref(),
        &project_id.to_le_bytes(),
        crate::ID.as_ref(),
    ]);
    h.to_bytes()
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitLaunchParams {
    pub hard_cap_lamports: u64,
    pub min_raise_lamports: u64,
    pub per_wallet_cap: u64,
    pub tau_lamports: u64,
    pub base_total_allocation: u64,
    pub base_sale_basis_points: u64,
    pub team_allocation_basis_points: u64,
    pub funding_duration_seconds: i64,
    pub sale_start_time_sec: i64,
    pub unlock_time_sec: i64,
    pub roster_shard_cap: u16,
    pub roster_shards_total: u16,
    pub creator_initial_deposit_lamports: u64,
    pub creator_daily_lamports_limit: u64,
    pub creator_claim_lock_period_sec: i64,
    pub creator_max_deposit: u64,
    pub pool_creation_grace_period_sec: i64,
    pub team_vesting_duration_sec: i64,
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub is_mutable: bool,
    pub seller_fee_basis_points: u16,
}

#[allow(clippy::too_many_arguments)]
pub fn init_launch_core<'info>(
    creator: &Signer<'info>,
    project_counter: &mut Account<'info, ProjectCounter>,
    launch_state: &mut Account<'info, LaunchState>,
    escrow_authority: &UncheckedAccount<'info>,
    creator_grant: &mut Account<'info, CreatorGrant>,
    token_metadata_config: &mut Account<'info, TokenMetadataConfig>,
    engine_config: &Account<'info, EngineConfig>,
    creator_xyber_ata: &Account<'info, TokenAccount>,
    treasury_xyber_ata: &Account<'info, TokenAccount>,
    system_program: &Program<'info, System>,
    token_program: &Program<'info, Token>,
    params: InitLaunchParams,
    project_id: u64,
) -> Result<()> {
    // ... identical contents as in instructions/launch_core.rs ...
    // The full body is intentionally identical; keeping logic centralized.
    require!(params.hard_cap_lamports > 0, EngineErrorCode::InvalidHardCap);
    require!(params.min_raise_lamports > 0, EngineErrorCode::InvalidMinRaise);
    require!(params.tau_lamports > 0, EngineErrorCode::InvalidTau);
    require!(
        params.hard_cap_lamports % params.tau_lamports == 0,
        EngineErrorCode::HardCapNotDivisibleByTau
    );
    require!(params.per_wallet_cap >= params.tau_lamports, EngineErrorCode::PerWalletCapTooSmall);
    require!(
        params.min_raise_lamports <= params.hard_cap_lamports,
        EngineErrorCode::MalformedPreset
    );
    require!(params.creator_claim_lock_period_sec > 0, EngineErrorCode::InvalidClaimLockPeriod);
    require!(params.roster_shards_total > 0, EngineErrorCode::InvalidK);
    let fee = engine_config.creation_fee;
    if fee > 0 {
        require!(creator_xyber_ata.amount >= fee, EngineErrorCode::InsufficientFeeBalance);
        if cfg!(not(test)) {
            require!(creator_xyber_ata.mint == treasury_xyber_ata.mint, EngineErrorCode::InvalidMint);
            require!(creator_xyber_ata.mint == engine_config.xyber_mint, EngineErrorCode::InvalidMint);
        }
        require!(creator_xyber_ata.owner == creator.key(), EngineErrorCode::InvalidOwner);
        require!(treasury_xyber_ata.owner == engine_config.treasury, EngineErrorCode::InvalidOwner);

        let cpi_accounts = anchor_spl::token::Transfer {
            from: creator_xyber_ata.to_account_info(),
            to: treasury_xyber_ata.to_account_info(),
            authority: creator.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, fee)?;
    }

    require!(
        params.funding_duration_seconds > 0 && params.funding_duration_seconds <= 60 * 60 * 24 * 7,
        EngineErrorCode::InvalidFundingDuration
    );

    let counter = project_counter;
    let expected_next =
        counter.last_project_id.checked_add(1).ok_or(EngineErrorCode::ArithmeticOverflow)?;
    require!(project_id == expected_next, EngineErrorCode::Unauthorized);
    counter.last_project_id = project_id;

    let state = launch_state;
    state.project_id = project_id;
    state.creator = creator.key();
    state.hard_cap_lamports = params.hard_cap_lamports;
    state.min_raise_lamports = params.min_raise_lamports;
    state.per_wallet_cap = params.per_wallet_cap;
    state.tau_lamports = params.tau_lamports;
    state.base_total_allocation = params.base_total_allocation;
    state.base_sale_basis_points = params.base_sale_basis_points;
    state.team_allocation_basis_points = if params.team_allocation_basis_points > 0 {
        params.team_allocation_basis_points
    } else {
        crate::constants::TEAM_BASIS_POINTS
    };
    state.unlock_time_sec = params.unlock_time_sec;
    state.roster_shard_cap = params.roster_shard_cap;

    let now = Clock::get()?.unix_timestamp;
    let start = if params.sale_start_time_sec == 0 {
        now
    } else {
        require!(params.sale_start_time_sec >= now, EngineErrorCode::InvalidStartTime);
        params.sale_start_time_sec
    };
    let end = start
        .checked_add(params.funding_duration_seconds)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
    state.funding_period_start = start;
    state.funding_period_end = end;
    state.total_deposited = 0;
    state.total_tickets = 0;

    let k_cap_u64 = params
        .hard_cap_lamports
        .checked_div(params.tau_lamports)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
    require!(k_cap_u64 <= u32::MAX as u64, EngineErrorCode::U64ConversionOverflow);
    state.k_capacity = k_cap_u64 as u32;

    state.selection_finalized = false;
    state.selection_processed = 0;
    state.threshold_score = None;
    state.vrf_seed = None;

    state.roster_shards = params.roster_shards_total;
    state.roster_initialized_up_to = 0;
    state.roster_finalized_up_to = 0;
    state.public_total_tickets = 0;

    state.tokens_per_ticket = None;

    state.creator_reserved_tickets = 0;
    state.creator_grant_present = false;
    state.claims_opened_at = None;
    state.creator_claim_lock_period_sec = params.creator_claim_lock_period_sec;
    state.pool_creation_grace_period_sec = params.pool_creation_grace_period_sec;
    state.team_vesting_duration_sec = if params.team_vesting_duration_sec > 0 {
        params.team_vesting_duration_sec
    } else {
        crate::constants::TEAM_VESTING_DURATION_SEC
    };
    state.roster_highest_used_shard = 0;

    let amount = params.creator_initial_deposit_lamports;
    if amount > 0 {
        require!(state.tau_lamports > 0, EngineErrorCode::InvalidTau);
        require!(amount <= params.creator_max_deposit, EngineErrorCode::Unauthorized);
        let remainder =
            amount.checked_rem(state.tau_lamports).ok_or(EngineErrorCode::ArithmeticOverflow)?;
        require!(remainder == 0, EngineErrorCode::InvalidCreatorDeposit);

        let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
            &creator.key(),
            &escrow_authority.key(),
            amount,
        );
        anchor_lang::solana_program::program::invoke(
            &transfer_ix,
            &[
                creator.to_account_info(),
                escrow_authority.to_account_info(),
                system_program.to_account_info(),
            ],
        )?;
    }

    state.total_deposited = amount;
    state.creator_initial_deposit = amount;
    state.creator_max_deposit = params.creator_max_deposit;

    let reserved_tickets = 0;

    state.creator_reserved_tickets = reserved_tickets;
    state.creator_grant_present = amount > 0;

    state.base_total_allocation = params.base_total_allocation;
    state.base_sale_basis_points = params.base_sale_basis_points;

    let launch_key = state.key();
    let creator_key = creator.key();
    let grant = creator_grant;
    grant.launch = launch_key;
    grant.creator = creator_key;
    grant.locked_lamports = amount;
    grant.reserved_tickets = reserved_tickets;
    grant.daily_lamports_limit = params.creator_daily_lamports_limit;
    let daily_ticket_cap_u64 = params
        .creator_daily_lamports_limit
        .checked_div(state.tau_lamports)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
    require!(daily_ticket_cap_u64 <= u32::MAX as u64, EngineErrorCode::U64ConversionOverflow);
    grant.daily_ticket_cap = daily_ticket_cap_u64 as u32;
    grant.claimed_tickets = 0;
    grant.refunded = false;

    if amount > 0 {
        emit!(CreatorGranted {
            launch: state.key(),
            creator: grant.creator,
            locked_lamports: amount,
            reserved_tickets,
            daily_lamports_limit: params.creator_daily_lamports_limit,
        });
    }

    let pending_key = make_pending_key(&creator.key(), project_id);

    emit!(LaunchInitialized {
        project_id,
        creator: creator.key(),
        creator_max_deposit: params.creator_max_deposit,
        creator_initial_deposit_lamports: params.creator_initial_deposit_lamports,
        base_mint: Pubkey::default(),
        pending_key: pending_key,
        hard_cap_lamports: params.hard_cap_lamports,
        min_raise_lamports: params.min_raise_lamports,
        per_wallet_cap: params.per_wallet_cap,
        tau_lamports: params.tau_lamports,
        base_total_allocation: params.base_total_allocation,
        base_sale_basis_points: params.base_sale_basis_points,
        unlock_time_sec: state.unlock_time_sec,
        launch: launch_key,
        funding_period_start: start,
        funding_period_end: end,
    });

    let meta = token_metadata_config;
    meta.launch = state.key();
    meta.name = params.name;
    meta.symbol = params.symbol;
    meta.uri = params.uri;
    meta.is_mutable = params.is_mutable;
    meta.seller_fee_basis_points = params.seller_fee_basis_points;

    Ok(())
}
