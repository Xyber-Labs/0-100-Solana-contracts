use crate::{
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    events::{CreatorGranted, FundingPeriodStarted, LaunchInitialized},
    state::{CreatorGrant, LaunchState, ProjectCounter},
};
use anchor_lang::solana_program::keccak;
use anchor_lang::{
    prelude::*,
    solana_program::sysvar::{clock::Clock, Sysvar},
};
use anchor_spl::token::Token;

fn make_pending_key(creator: &Pubkey, project_id: u64) -> [u8; 32] {
    let h = keccak::hashv(&[
        b"xyber|pending|v1",
        creator.as_ref(),
        &project_id.to_le_bytes(),
        crate::ID.as_ref(),
    ]);
    h.to_bytes()
}

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

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitLaunchParams {
    pub hard_cap_lamports: u64,
    pub min_raise_lamports: u64,
    pub per_wallet_cap: u64,
    pub tau_lamports: u64,
    pub base_total_allocation: u64,
    pub base_sale_basis_points: u64,
    pub funding_duration_seconds: i64,
    pub unlock_time_sec: i64,
    pub roster_shard_cap: u16,

    // Creator grant parameters
    pub creator_initial_deposit_lamports: u64, // usually 8 * LAMPORTS_PER_SOL
    pub creator_daily_lamports_limit: u64,     // usually 1 * LAMPORTS_PER_SOL
    pub creator_claim_lock_period_sec: i64,
    pub creator_max_deposit: u64,
}

pub fn init_launch(
    ctx: Context<InitLaunch>,
    params: InitLaunchParams,
    project_id: u64,
) -> Result<()> {
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
        EngineErrorCode::MinRaiseTooHigh
    );
    require!(params.creator_claim_lock_period_sec > 0, EngineErrorCode::InvalidClaimLockPeriod);

    // Max duration: 7 days
    require!(
        params.funding_duration_seconds > 0 && params.funding_duration_seconds <= 60 * 60 * 24 * 7,
        EngineErrorCode::InvalidFundingDuration
    );

    let counter = &mut ctx.accounts.project_counter;
    let expected_next =
        counter.last_project_id.checked_add(1).ok_or(EngineErrorCode::ArithmeticOverflow)?;
    require!(project_id == expected_next, EngineErrorCode::Unauthorized);
    counter.last_project_id = project_id;

    let state = &mut ctx.accounts.launch_state;
    state.project_id = project_id;
    state.creator = ctx.accounts.creator.key();
    state.hard_cap_lamports = params.hard_cap_lamports;
    state.min_raise_lamports = params.min_raise_lamports;
    state.per_wallet_cap = params.per_wallet_cap;
    state.tau_lamports = params.tau_lamports;
    state.base_total_allocation = params.base_total_allocation;
    state.base_sale_basis_points = params.base_sale_basis_points;
    state.unlock_time_sec = params.unlock_time_sec;
    state.roster_shard_cap = params.roster_shard_cap;

    // Set funding period end time (current time + duration)
    let current_time = Clock::get()?.unix_timestamp;
    state.funding_period_end = current_time
        .checked_add(params.funding_duration_seconds)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
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

    // Sharded roster fields
    state.roster_shards = 0; // UI must set before creating shards
    state.roster_finalized_up_to = -1;
    state.public_total_tickets = 0;

    state.tokens_per_ticket = None;

    // Initialize creator grant fields
    state.creator_reserved_tickets = 0;
    state.creator_grant_present = false;
    state.claims_opened_at = None;
    state.creator_claim_lock_period_sec = params.creator_claim_lock_period_sec;

    // Handle creator deposit and grant initialization
    let amount = params.creator_initial_deposit_lamports;
    if amount > 0 {
        require!(state.tau_lamports > 0, EngineErrorCode::InvalidTau);
        require!(amount <= params.creator_max_deposit, EngineErrorCode::Unauthorized);
        let remainder =
            amount.checked_rem(state.tau_lamports).ok_or(EngineErrorCode::ArithmeticOverflow)?;
        require!(remainder == 0, EngineErrorCode::InvalidCreatorDeposit);

        // Transfer creator deposit to escrow_authority PDA using system program
        let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.creator.key(),
            &ctx.accounts.escrow_authority.key(),
            amount,
        );
        anchor_lang::solana_program::program::invoke(
            &transfer_ix,
            &[
                ctx.accounts.creator.to_account_info(),
                ctx.accounts.escrow_authority.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;
    }

    state.total_deposited = amount;
    state.creator_initial_deposit = amount; // Store the initial deposit
    state.creator_max_deposit = params.creator_max_deposit;

    let funding_end = state.funding_period_end;

    // Creator grant reserved_tickets will be calculated in open_claims
    let reserved_tickets = 0;

    state.creator_reserved_tickets = reserved_tickets;
    state.creator_grant_present = amount > 0;

    // Total launch allocation will be calculated in open_claims
    state.base_total_allocation = params.base_total_allocation;
    state.base_sale_basis_points = params.base_sale_basis_points;

    // Initialize creator grant
    let launch_key = state.key();
    let creator_key = ctx.accounts.creator.key();
    let creator_grant = &mut ctx.accounts.creator_grant;
    creator_grant.launch = launch_key;
    creator_grant.creator = creator_key;
    creator_grant.locked_lamports = amount;
    creator_grant.reserved_tickets = reserved_tickets;
    creator_grant.daily_lamports_limit = params.creator_daily_lamports_limit;
    let daily_ticket_cap_u64 = params
        .creator_daily_lamports_limit
        .checked_div(state.tau_lamports)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
    require!(daily_ticket_cap_u64 <= u32::MAX as u64, EngineErrorCode::U64ConversionOverflow);
    creator_grant.daily_ticket_cap = daily_ticket_cap_u64 as u32;
    creator_grant.claimed_tickets = 0;
    creator_grant.refunded = false;

    if amount > 0 {
        emit!(CreatorGranted {
            launch: state.key(),
            creator: creator_grant.creator,
            locked_lamports: amount,
            reserved_tickets,
            daily_lamports_limit: params.creator_daily_lamports_limit,
        });
    }

    let pending_key = make_pending_key(&ctx.accounts.creator.key(), project_id);

    emit!(LaunchInitialized {
        project_id,
        creator: ctx.accounts.creator.key(),
        creator_max_deposit: params.creator_max_deposit,
        base_mint: Pubkey::default(),
        pending_key: pending_key,
        hard_cap_lamports: params.hard_cap_lamports,
        min_raise_lamports: params.min_raise_lamports,
        per_wallet_cap: params.per_wallet_cap,
        tau_lamports: params.tau_lamports,
        base_total_allocation: params.base_total_allocation,
        base_sale_basis_points: params.base_sale_basis_points,
        unlock_time_sec: state.unlock_time_sec,
    });

    emit!(FundingPeriodStarted {
        launch: launch_key,
        funding_period_end: funding_end,
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_make_pending_key() {
        use std::str::FromStr;
        // Human-readable base58 Pubkey (System Program for example)
        let creator = Pubkey::from_str("11111111111111111111111111111111").unwrap();
        let project_id = 1;
        let pending_key = make_pending_key(&creator, project_id);
        assert_eq!(pending_key.len(), 32);
        assert_eq!(
            pending_key,
            [
                201, 110, 224, 164, 248, 161, 196, 49, 95, 41, 70, 183, 131, 211, 72, 136, 12, 37,
                225, 198, 22, 64, 9, 133, 173, 80, 226, 216, 36, 249, 214, 112
            ]
        );
    }
}
