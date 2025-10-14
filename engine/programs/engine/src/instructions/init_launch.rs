use anchor_lang::prelude::*;
use anchor_spl::token::Mint;
use crate::errors::ErrorCode as EngineErrorCode;
use crate::events::{LaunchInitialized, FundingPeriodStarted};
use crate::state::{EscrowAccount, LaunchState, ProjectCounter};
use crate::constants::{SEED_ROOT, DEFAULT_N, MIN_N, MAX_N};
use anchor_lang::solana_program::sysvar::clock::Clock;
use anchor_lang::solana_program::sysvar::Sysvar;

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
        seeds = [SEED_ROOT, b"launch", sale_mint.key().as_ref()], // for MVP use sale_mint as launch_id
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
}


pub fn handler(ctx: Context<InitLaunch>, params: InitLaunchParams) -> Result<()> {
    require!(params.tau_lamports > 0, EngineErrorCode::InvalidTau);
    // Max duration: 7 days
    require!(
        params.funding_duration_seconds > 0
            && params.funding_duration_seconds <= 60 * 60 * 24 * 7,
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

    // Set funding period end time (current time + duration)
    let current_time = Clock::get()?.unix_timestamp;
    state.funding_period_end = current_time
        .checked_add(params.funding_duration_seconds)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
    state.total_deposited = 0;
    state.total_tickets = 0;
    state.k_capacity = 0;

    state.selection_finalized = false;
    state.selection_processed = 0;
    state.threshold_score = None;
    state.vrf_seed = None;

    state.claims_open = false;
    state.tokens_per_ticket = None;

    // save sale mint
    state.sale_mint = ctx.accounts.sale_mint.key();

    // Initialize escrow account
    let escrow = &mut ctx.accounts.escrow;
    let launch_key = state.key();
    let funding_end = state.funding_period_end;
    escrow.launch = launch_key;
    escrow.balance = 0;

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
