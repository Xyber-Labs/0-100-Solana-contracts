use crate::constants::{DEFAULT_N, MAX_N, MIN_N, SEED_ROOT};
use crate::errors::ErrorCode as EngineErrorCode;
use crate::events::{CreatorGranted, FundingPeriodStarted, LaunchInitialized};
use crate::state::{CreatorGrant, EscrowAccount, LaunchState, ProjectCounter};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::clock::Clock;
use anchor_lang::solana_program::sysvar::Sysvar;
use anchor_spl::token::Mint;

#[derive(Accounts)]
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
        seeds = [SEED_ROOT, b"launch", sale_mint.key().as_ref()],
        bump
    )]
    pub launch_state: Account<'info, LaunchState>,

    /// Mint for sale tokens (program's mint authority will be PDA)
    #[account(mut)]
    pub sale_mint: Account<'info, Mint>,

    /// Escrow account (PDA off launch_state)
    #[account(
        init,
        payer = creator,
        space = 8 + EscrowAccount::INIT_SPACE,
        seeds = [SEED_ROOT, b"escrow", launch_state.key().as_ref()],
        bump
    )]
    pub escrow: Account<'info, EscrowAccount>,

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
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitLaunchParams {
    pub hard_cap_lamports: u64,
    pub min_raise_lamports: u64,
    pub per_wallet_cap: u64,
    pub tau_lamports: u64,
    pub sale_allocation: u64, // number of sale tokens
    pub lp_allocation: u64,   // number of LP tokens to allocate (informational for MVP)
    pub funding_duration_seconds: i64,
    pub num_blocks: u64, // N value for hash range calculation
    pub roster_shard_cap: u16,

    // Creator grant parameters
    pub creator_initial_deposit_lamports: u64, // usually 8 * LAMPORTS_PER_SOL
    pub creator_daily_lamports_limit: u64,     // usually 1 * LAMPORTS_PER_SOL
    pub creator_claim_lock_period_sec: i64,
}

pub fn handler(ctx: Context<InitLaunch>, params: InitLaunchParams) -> Result<()> {
    require!(
        params.hard_cap_lamports > 0,
        EngineErrorCode::InvalidHardCap
    );
    require!(
        params.min_raise_lamports > 0,
        EngineErrorCode::InvalidMinRaise
    );
    require!(params.tau_lamports > 0, EngineErrorCode::InvalidTau);
    require!(
        params.hard_cap_lamports % params.tau_lamports == 0,
        EngineErrorCode::HardCapNotDivisibleByTau
    );
    require!(
        params.per_wallet_cap >= params.tau_lamports,
        EngineErrorCode::PerWalletCapTooSmall
    );
    require!(
        params.min_raise_lamports <= params.hard_cap_lamports,
        EngineErrorCode::MinRaiseTooHigh
    );
    require!(
        params.creator_claim_lock_period_sec > 0,
        EngineErrorCode::InvalidClaimLockPeriod
    );

    // Max duration: 7 days
    require!(
        params.funding_duration_seconds > 0 && params.funding_duration_seconds <= 60 * 60 * 24 * 7,
        EngineErrorCode::InvalidFundingDuration
    );

    let n = if params.num_blocks == 0 {
        DEFAULT_N
    } else {
        params.num_blocks
    };
    require!(
        (MIN_N..=MAX_N).contains(&n),
        EngineErrorCode::InvalidNumBlocks
    );

    let launch_key = ctx.accounts.launch_state.key();

    let counter = &mut ctx.accounts.project_counter;
    let project_id = counter
        .last_project_id
        .checked_add(1)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
    counter.last_project_id = project_id;

    let state = &mut ctx.accounts.launch_state;
    state.project_id = project_id;
    state.creator = ctx.accounts.creator.key();
    state.hard_cap_lamports = params.hard_cap_lamports;
    state.min_raise_lamports = params.min_raise_lamports;
    state.per_wallet_cap = params.per_wallet_cap;
    state.tau_lamports = params.tau_lamports;
    state.sale_allocation = params.sale_allocation;
    state.lp_allocation = params.lp_allocation;
    state.num_blocks = n;
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
    require!(
        k_cap_u64 <= u32::MAX as u64,
        EngineErrorCode::U64ConversionOverflow
    );
    state.k_capacity = k_cap_u64 as u32;

    state.selection_finalized = false;
    state.selection_processed = 0;
    state.threshold_score = None;
    state.vrf_seed = None;

    // Sharded roster fields
    state.roster_shards = 0; // UI must set before creating shards
    state.roster_finalized_up_to = -1;
    state.public_total_tickets = 0;

    state.claims_open = false;
    state.tokens_per_ticket = None;

    // Initialize creator grant fields
    state.creator_reserved_tickets = 0;
    state.creator_grant_present = false;
    state.claims_opened_at = None;
    state.creator_claim_lock_period_sec = params.creator_claim_lock_period_sec;

    // save sale mint
    state.sale_mint = ctx.accounts.sale_mint.key();

    // Handle creator deposit and grant initialization
    let amount = params.creator_initial_deposit_lamports;
    if amount > 0 {
        require!(state.tau_lamports > 0, EngineErrorCode::InvalidTau);
        let remainder = amount
            .checked_rem(state.tau_lamports)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;
        require!(remainder == 0, EngineErrorCode::InvalidCreatorDeposit);

        // Transfer creator deposit to escrow using system program
        let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.creator.key(),
            &ctx.accounts.escrow.key(),
            amount,
        );
        anchor_lang::solana_program::program::invoke(
            &transfer_ix,
            &[
                ctx.accounts.creator.to_account_info(),
                ctx.accounts.escrow.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;
    }

    state.total_deposited = amount;
    state.creator_initial_deposit = amount; // Store the initial deposit

    // Initialize escrow account
    let escrow = &mut ctx.accounts.escrow;
    let funding_end = state.funding_period_end;
    escrow.launch = launch_key;
    escrow.balance = amount;

    // Creator grant reserved_tickets will be calculated in open_claims
    let reserved_tickets = 0;

    state.creator_reserved_tickets = reserved_tickets;
    state.creator_grant_present = amount > 0;

    // Total launch allocation will be calculated in open_claims
    state.total_launch_allocation = params.sale_allocation;

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
    require!(
        daily_ticket_cap_u64 <= u32::MAX as u64,
        EngineErrorCode::U64ConversionOverflow
    );
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

    emit!(LaunchInitialized {
        project_id,
        creator: ctx.accounts.creator.key(),
        sale_mint: ctx.accounts.sale_mint.key(),
        hard_cap_lamports: params.hard_cap_lamports,
        min_raise_lamports: params.min_raise_lamports,
        per_wallet_cap: params.per_wallet_cap,
        tau_lamports: params.tau_lamports,
        sale_allocation: params.sale_allocation,
        lp_allocation: params.lp_allocation,
        num_blocks: state.num_blocks,
    });

    emit!(FundingPeriodStarted {
        launch: launch_key,
        funding_period_end: funding_end,
    });

    Ok(())
}
