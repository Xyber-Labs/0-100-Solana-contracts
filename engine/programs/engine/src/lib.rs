#![allow(unexpected_cfgs)]
use anchor_lang::prelude::borsh::BorshSchema;
use anchor_lang::prelude::*;
use anchor_lang::solana_program;
use solana_program::keccak;
use solana_program::sysvar::clock::Clock;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};

declare_id!("HMVJWXWhpxEWWGhvLHYnTvkmYJcA819jAxw3EgdNYiYb");

/// Domain separation for score hashing (fix this constant).
const SCORE_DOMAIN: &[u8] = b"0-100/selection/v1";

// -------------------------------
// Events
// -------------------------------

#[event]
pub struct LaunchInitialized {
    pub project_id: u64,
    pub admin: Pubkey,
    pub sale_mint: Pubkey,
    pub hard_cap_lamports: u64,
    pub min_raise_lamports: u64,
    pub per_wallet_cap: u64,
    pub tau_lamports: u64,
    pub sale_allocation: u64,
    pub lp_allocation: u64,
}

#[event]
pub struct RosterInitialized {
    pub launch: Pubkey,
}

#[event]
pub struct FundingPeriodStarted {
    pub launch: Pubkey,
    pub funding_period_end: i64,
}

#[event]
pub struct DepositMade {
    pub launch: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub tickets_before: u32,
    pub tickets_after: u32,
    pub total_deposited: u64,
    pub total_tickets: u32,
}

#[event]
pub struct Withdrawn {
    pub launch: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub tickets_before: u32,
    pub tickets_after: u32,
    pub total_deposited: u64,
    pub total_tickets: u32,
}

#[event]
pub struct DepositsClosed {
    pub launch: Pubkey,
    pub total_tickets: u32,
    pub k_capacity: u32,
}

#[event]
pub struct SeedSet {
    pub launch: Pubkey,
    pub seed_hash: [u8; 32],
}

#[event]
pub struct BatchProcessed {
    pub launch: Pubkey,
    pub from_t: u32,
    pub processed: u32,
    pub heap_len: u32,
}

#[event]
pub struct SelectionFinalized {
    pub launch: Pubkey,
    pub threshold: u128,
    pub k_capacity: u32,
}

#[event]
pub struct ClaimsOpened {
    pub launch: Pubkey,
    pub tokens_per_ticket: u64,
}

#[event]
pub struct RefundClaimed {
    pub launch: Pubkey,
    pub user: Pubkey,
    pub refunded_lamports: u64,
    pub y_approved: u32,
}

#[event]
pub struct TokensClaimed {
    pub launch: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub y_approved: u32,
}

#[program]
pub mod engine {
    use super::*;

    // -------------------------------
    // Admin / Orchestrator
    // -------------------------------

    /// Create launch + PDAs (escrow, mint authority PDA is derived, not stored).
    pub fn init_launch(
        ctx: Context<InitLaunch>,
        hard_cap_lamports: u64,
        min_raise_lamports: u64,
        per_wallet_cap: u64,
        tau_lamports: u64,
        sale_allocation: u64, // number of sale tokens
        lp_allocation: u64,   // number of LP tokens to allocate (informational for MVP)
        funding_duration_days: u8, // funding period duration in days (max 5 days)
    ) -> Result<()> {
        require!(tau_lamports > 0, ErrorCode::InvalidTau);
        require!(funding_duration_days <= 5, ErrorCode::InvalidFundingDuration);
        
        // For testing: allow very short periods (seconds instead of days)
        let duration_seconds = if funding_duration_days == 0 {
            // Special case: 0 means 10 seconds for testing
            10
        } else if funding_duration_days == 1 {
            // Special case: 1 means 30 seconds for testing
            30
        } else {
            funding_duration_days as i64 * 24 * 60 * 60
        };
        
        // Get and increment project ID
        let counter = &mut ctx.accounts.project_counter;
        let project_id = counter.next_project_id;
        counter.next_project_id = counter.next_project_id.saturating_add(1);
        
        let state = &mut ctx.accounts.launch_state;
        state.project_id = project_id;
        state.admin = ctx.accounts.admin.key();
        state.hard_cap_lamports = hard_cap_lamports;
        state.min_raise_lamports = min_raise_lamports;
        state.per_wallet_cap = per_wallet_cap;
        state.tau_lamports = tau_lamports;
        state.sale_allocation = sale_allocation;
        state.lp_allocation = lp_allocation;

        // Set funding period end time (current time + duration)
        let current_time = Clock::get()?.unix_timestamp;
        state.funding_period_end = current_time + duration_seconds;
        state.deposits_closed = false;
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
            admin: ctx.accounts.admin.key(),
            sale_mint: ctx.accounts.sale_mint.key(),
            hard_cap_lamports,
            min_raise_lamports,
            per_wallet_cap,
            tau_lamports,
            sale_allocation,
            lp_allocation,
        });

        emit!(FundingPeriodStarted {
            launch: launch_key,
            funding_period_end: funding_end,
        });

        Ok(())
    }

    /// Initialize roster account.
    pub fn init_roster(ctx: Context<InitRoster>) -> Result<()> {
        let roster = &mut ctx.accounts.roster;
        roster.launch = ctx.accounts.launch_state.key();
        roster.wallets = Vec::new();
        roster.counts = Vec::new();
        roster.prefix = Vec::new();
        roster.total_in_shard = 0;
        roster.shard_base = 0;

        emit!(RosterInitialized {
            launch: ctx.accounts.launch_state.key(),
        });

        Ok(())
    }

    /// Close deposits automatically when funding period ends (called by anyone).
    /// This function can be called by anyone once the funding period has ended.
    pub fn close_deposits(ctx: Context<CloseDeposits>) -> Result<()> {
        let st = &mut ctx.accounts.launch_state;
        require!(!st.deposits_closed, ErrorCode::AlreadyClosed);
        
        // Check if funding period has ended
        let current_time = Clock::get()?.unix_timestamp;
        require!(current_time >= st.funding_period_end, ErrorCode::FundingPeriodNotEnded);
        
        st.deposits_closed = true;

        // build prefix inside roster
        let roster = &mut ctx.accounts.roster;
        roster_build_prefix(roster)?;
        roster.shard_base = 0; // single-shard MVP
        st.total_tickets = roster.total_in_shard;

        // compute K
        st.k_capacity = (st.hard_cap_lamports / st.tau_lamports) as u32;

        let launch_key = st.key();
        emit!(DepositsClosed {
            launch: launch_key,
            total_tickets: st.total_tickets,
            k_capacity: st.k_capacity,
        });

        Ok(())
    }

    /// MVP seed setter (PoC instead of VRF): admin provides a 32-byte seed.
    pub fn set_seed(ctx: Context<OnlyAdminWithSelection>, seed: [u8; 32]) -> Result<()> {
        let st = &mut ctx.accounts.launch_state;
        require_keys_eq!(st.admin, ctx.accounts.admin.key(), ErrorCode::Unauthorized);
        require!(st.deposits_closed, ErrorCode::NotClosed);
        require!(st.vrf_seed.is_none(), ErrorCode::SeedAlreadySet);

        // Initialize SelectionState
        let sel = &mut ctx.accounts.selection_state;
        sel.launch = st.key();
        sel.vrf_seed = seed;
        sel.processed = 0;
        sel.finalized = false;
        sel.threshold = None;
        sel.heap = Vec::new();

        st.vrf_seed = Some(seed);

        // Hash the seed for security (don't expose raw seed)
        let seed_hash = keccak::hash(&seed);
        
        emit!(SeedSet {
            launch: ctx.accounts.launch_state.key(),
            seed_hash: seed_hash.0,
        });

        Ok(())
    }

    /// Finalize selection: set threshold = K-th best score.
    /// (We DO NOT aggregate per-user here; claims recompute y_i locally.)
    pub fn finalize_selection(ctx: Context<FinalizeSelection>) -> Result<()> {
        let st = &mut ctx.accounts.launch_state;
        let sel = &mut ctx.accounts.selection_state;
        require!(st.deposits_closed, ErrorCode::NotClosed);
        require!(sel.vrf_seed.len() == 32, ErrorCode::SeedMissing);
        require!(!sel.finalized, ErrorCode::AlreadyFinalized);
        require!(
            sel.processed == st.total_tickets,
            ErrorCode::NotFullyProcessed
        );

        // threshold is the worst (max) score currently in heap
        let k = st.k_capacity as usize;
        require!(sel.heap.len() == k, ErrorCode::HeapNotFull);

        let mut worst: Option<u128> = None;
        for h in sel.heap.iter() {
            if let Some(w) = worst {
                if h.score > w {
                    worst = Some(h.score);
                }
            } else {
                worst = Some(h.score);
            }
        }
        let thr = worst.unwrap();
        sel.finalized = true;
        sel.threshold = Some(thr);

        st.selection_finalized = true;
        st.threshold_score = Some(thr);

        let launch_key = st.key();
        emit!(SelectionFinalized {
            launch: launch_key,
            threshold: thr,
            k_capacity: st.k_capacity,
        });

        Ok(())
    }

    /// Open token claims (post-LP in production). Compute tokens_per_ticket = sale_allocation / K.
    pub fn open_claims(ctx: Context<OnlyAdmin>) -> Result<()> {
        let st = &mut ctx.accounts.launch_state;
        require_keys_eq!(st.admin, ctx.accounts.admin.key(), ErrorCode::Unauthorized);
        require!(st.selection_finalized, ErrorCode::NotFinalized);
        let k = st.k_capacity as u64;
        require!(k > 0, ErrorCode::InvalidK);

        let per = st.sale_allocation / k; // floor; small remainder stays unminted in MVP
        st.tokens_per_ticket = Some(per);
        st.claims_open = true;

        emit!(ClaimsOpened {
            launch: ctx.accounts.launch_state.key(),
            tokens_per_ticket: per,
        });

        Ok(())
    }

    /// Permissionless crank: process up to max_items tickets (t = processed ..).
    pub fn process_batch(ctx: Context<ProcessBatch>, max_items: u16) -> Result<()> {
        let st = &mut ctx.accounts.launch_state;
        let sel = &mut ctx.accounts.selection_state;
        let roster = &ctx.accounts.roster;
        require!(st.deposits_closed, ErrorCode::NotClosed);
        require!(sel.finalized == false, ErrorCode::AlreadyFinalized);
        let seed = st.vrf_seed.ok_or(ErrorCode::SeedMissing)?;
        let k = st.k_capacity as usize;

        let from_t = sel.processed; // Capture initial value for event
        let mut steps = 0usize;
        while sel.processed < st.total_tickets && steps < max_items as usize {
            let t = sel.processed;
            let (wallet, local_j) = ticket_at(t, roster)?;
            let score = ticket_score(&seed, &wallet, local_j);

            // maintain top-K (max-heap behavior via vector)
            if sel.heap.len() < k {
                sel.heap.push(HeapEntry {
                    score,
                    wallet,
                    local_j,
                });
            } else {
                // find worst
                let mut worst_idx = 0usize;
                let mut worst_val = sel.heap[0].score;
                for (i, h) in sel.heap.iter().enumerate().skip(1) {
                    if h.score > worst_val
                        || (h.score == worst_val
                            && tuple_gt(
                                (h.wallet, h.local_j),
                                (sel.heap[worst_idx].wallet, sel.heap[worst_idx].local_j),
                            ))
                    {
                        worst_val = h.score;
                        worst_idx = i;
                    }
                }
                // replace if better
                if score < worst_val
                    || (score == worst_val
                        && tuple_lt(
                            (wallet, local_j),
                            (sel.heap[worst_idx].wallet, sel.heap[worst_idx].local_j),
                        ))
                {
                    sel.heap[worst_idx] = HeapEntry {
                        score,
                        wallet,
                        local_j,
                    };
                }
            }
            sel.processed += 1;
            steps += 1;
        }

        emit!(BatchProcessed {
            launch: ctx.accounts.launch_state.key(),
            from_t,
            processed: sel.processed,
            heap_len: sel.heap.len() as u32,
        });

        Ok(())
    }

    // -------------------------------
    // User (UI)
    // -------------------------------

    /// Deposit lamports (must be multiple of τ); update user + roster; move lamports to escrow.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let st = &mut ctx.accounts.launch_state;
        require!(!st.deposits_closed, ErrorCode::AlreadyClosed);
        
        // Check if funding period is still active
        let current_time = Clock::get()?.unix_timestamp;
        require!(current_time < st.funding_period_end, ErrorCode::FundingPeriodEnded);
        require!(
            amount > 0 && amount % st.tau_lamports == 0,
            ErrorCode::AmountNotMultipleTau
        );

        // per-wallet cap check
        let current = ctx.accounts.user_contribution.deposited;
        require!(
            current + amount <= st.per_wallet_cap,
            ErrorCode::PerWalletCapExceeded
        );

        // transfer to escrow
        let ix = solana_program::system_instruction::transfer(
            &ctx.accounts.user.key(),
            &ctx.accounts.escrow.key(),
            amount,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.user.to_account_info(),
                ctx.accounts.escrow.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // Update escrow balance
        ctx.accounts.escrow.balance += amount;

        // update user
        let user = &mut ctx.accounts.user_contribution;
        
        // Initialize wallet field if this is the first deposit
        if user.wallet == Pubkey::default() {
            user.launch = st.key();
            user.wallet = ctx.accounts.user.key();
            user.claimed_refund = false;
            user.claimed_tokens = false;
        }
        
        let old_tickets = user.ticket_count;
        user.deposited = current + amount;
        let new_tickets = (user.deposited / st.tau_lamports) as u32;
        let delta = new_tickets - old_tickets;
        user.ticket_count = new_tickets;

        // roster update (append or incr)
        let roster = &mut ctx.accounts.roster;
        roster_add_or_incr(
            roster,
            user.wallet,
            delta,
            &ctx.accounts.user,
            &ctx.accounts.system_program,
        )?;

        st.total_deposited = st.total_deposited.saturating_add(amount);
        st.total_tickets = st.total_tickets.saturating_add(delta);

        emit!(DepositMade {
            launch: st.key(),
            user: ctx.accounts.user.key(),
            amount,
            tickets_before: old_tickets,
            tickets_after: new_tickets,
            total_deposited: st.total_deposited,
            total_tickets: st.total_tickets,
        });

        Ok(())
    }

    /// Withdraw during funding window (reduces ticket_count and returns lamports).
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let st = &mut ctx.accounts.launch_state;
        require!(!st.deposits_closed, ErrorCode::AlreadyClosed);
        
        // Check if funding period is still active
        let current_time = Clock::get()?.unix_timestamp;
        require!(current_time < st.funding_period_end, ErrorCode::FundingPeriodEnded);
        let user = &mut ctx.accounts.user_contribution;
        require!(user.deposited >= amount, ErrorCode::InsufficientDeposit);

        // return lamports from escrow to user
        **ctx.accounts.escrow.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.user.to_account_info().try_borrow_mut_lamports()? += amount;

        // Update escrow balance
        ctx.accounts.escrow.balance -= amount;

        // recompute tickets
        let old_tickets = user.ticket_count;
        user.deposited -= amount;
        let new_tickets = (user.deposited / st.tau_lamports) as u32;
        let lost = old_tickets.saturating_sub(new_tickets);
        user.ticket_count = new_tickets;

        // roster decrement
        let roster = &mut ctx.accounts.roster;
        roster_decr(roster, user.wallet, lost)?;
        st.total_tickets = st.total_tickets.saturating_sub(lost);
        st.total_deposited = st.total_deposited.saturating_sub(amount);

        emit!(Withdrawn {
            launch: st.key(),
            user: ctx.accounts.user.key(),
            amount,
            tickets_before: old_tickets,
            tickets_after: new_tickets,
            total_deposited: st.total_deposited,
            total_tickets: st.total_tickets,
        });

        Ok(())
    }

    /// Claim refund after selection finalized: recompute y_i and pay back (deposited - y_i*τ).
    pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
        let st = &mut ctx.accounts.launch_state;
        require!(st.selection_finalized, ErrorCode::NotFinalized);
        let threshold = st.threshold_score.ok_or(ErrorCode::ThresholdMissing)?;
        let user = &mut ctx.accounts.user_contribution;
        require!(!user.claimed_refund, ErrorCode::AlreadyClaimedRefund);

        // recompute y_i by scanning user's own tickets 0..ticket_count-1
        let seed = st.vrf_seed.ok_or(ErrorCode::SeedMissing)?;
        let mut y = 0u32;
        for j in 0..user.ticket_count {
            let s = ticket_score(&seed, &user.wallet, j);
            if s < threshold
                || (s == threshold
                    && tie_break_wins(
                        user.wallet,
                        j,
                        threshold,
                        &ctx.accounts.selection_state.heap,
                    ))
            {
                y += 1;
            }
        }

        let approved_lamports = (y as u64) * st.tau_lamports;
        let refund = user.deposited.saturating_sub(approved_lamports);
        if refund > 0 {
            **ctx
                .accounts
                .escrow
                .to_account_info()
                .try_borrow_mut_lamports()? -= refund;
            **ctx
                .accounts
                .user
                .to_account_info()
                .try_borrow_mut_lamports()? += refund;
        }
        user.claimed_refund = true;

        emit!(RefundClaimed {
            launch: st.key(),
            user: ctx.accounts.user.key(),
            refunded_lamports: refund,
            y_approved: y,
        });

        Ok(())
    }

    /// Claim tokens (post open_claims): mint tokens_per_ticket * y_i to user ATA.
    pub fn claim_tokens(ctx: Context<ClaimTokens>) -> Result<()> {
        let st = &mut ctx.accounts.launch_state;
        require!(st.claims_open, ErrorCode::ClaimsNotOpen);
        let per = st
            .tokens_per_ticket
            .ok_or(ErrorCode::TokensPerTicketMissing)?;
        let threshold = st.threshold_score.ok_or(ErrorCode::ThresholdMissing)?;
        let seed = st.vrf_seed.ok_or(ErrorCode::SeedMissing)?;

        let user = &mut ctx.accounts.user_contribution;
        require!(!user.claimed_tokens, ErrorCode::AlreadyClaimedTokens);

        // recompute y_i
        let mut y = 0u32;
        for j in 0..user.ticket_count {
            let s = ticket_score(&seed, &user.wallet, j);
            if s < threshold
                || (s == threshold
                    && tie_break_wins(
                        user.wallet,
                        j,
                        threshold,
                        &ctx.accounts.selection_state.heap,
                    ))
            {
                y += 1;
            }
        }
        if y == 0 {
            user.claimed_tokens = true;
            return Ok(());
        }
        let amount = per.saturating_mul(y as u64);

        // Mint from sale_mint; mint authority is PDA [mint_auth, launch_state]
        let seeds: &[&[u8]] = &[b"mint_auth", &st.key().to_bytes(), &[st.mint_auth_bump()]];
        let signer_seeds = &[&seeds[..]];
        let cpi_accounts = MintTo {
            mint: ctx.accounts.sale_mint.to_account_info(),
            to: ctx.accounts.user_ata.to_account_info(),
            authority: ctx.accounts.mint_auth.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::mint_to(cpi_ctx, amount)?;

        user.claimed_tokens = true;

        emit!(TokensClaimed {
            launch: st.key(),
            user: ctx.accounts.user.key(),
            amount,
            y_approved: y,
        });

        Ok(())
    }
}

// -------------------------------
// Accounts & State
// -------------------------------

#[account]
#[derive(InitSpace)]
pub struct LaunchState {
    // Project identification
    pub project_id: u64,

    // admin
    pub admin: Pubkey,

    // Config
    pub hard_cap_lamports: u64,
    pub min_raise_lamports: u64,
    pub per_wallet_cap: u64,
    pub tau_lamports: u64,

    // Sale/LP (MVP)
    pub sale_mint: Pubkey,
    pub sale_allocation: u64,
    pub lp_allocation: u64,

    // Funding
    pub funding_period_end: i64, // Unix timestamp when funding period ends
    pub deposits_closed: bool,
    pub total_deposited: u64,
    pub total_tickets: u32,
    pub k_capacity: u32,

    // Selection
    pub vrf_seed: Option<[u8; 32]>,
    pub selection_processed: u32, // mirror, not used in MVP (kept in SelectionState)
    pub selection_finalized: bool,
    pub threshold_score: Option<u128>,

    // Claims
    pub claims_open: bool,
    pub tokens_per_ticket: Option<u64>,
}

impl LaunchState {
    pub fn mint_auth_seeds(&self) -> [&[u8]; 2] {
        [b"mint_auth", self.admin.as_ref()]
    }
    pub fn mint_auth_bump(&self) -> u8 {
        // Get the canonical bump for the mint authority PDA
        // We need to derive the launch state key first
        let launch_key = Pubkey::find_program_address(
            &[b"launch", self.sale_mint.as_ref()],
            &crate::ID,
        ).0;
        let (_, bump) = Pubkey::find_program_address(
            &[b"mint_auth", launch_key.as_ref()],
            &crate::ID,
        );
        bump
    }
}

#[account]
#[derive(InitSpace)]
pub struct UserContribution {
    pub launch: Pubkey,
    pub wallet: Pubkey,
    pub deposited: u64,
    pub ticket_count: u32,
    pub claimed_refund: bool,
    pub claimed_tokens: bool,
}

#[account]
#[derive(InitSpace)]
pub struct Roster {
    pub launch: Pubkey,

    // dynamic until close; then frozen
    #[max_len(100)]
    pub wallets: Vec<Pubkey>,
    #[max_len(100)]
    pub counts: Vec<u32>,

    // built at close
    #[max_len(100)]
    pub prefix: Vec<u32>, // prefix[u] = Σ counts[k], k<u
    pub total_in_shard: u32,
    pub shard_base: u32, // 0 in MVP
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, BorshSchema, InitSpace)]
pub struct HeapEntry {
    pub score: u128,
    pub wallet: Pubkey,
    pub local_j: u32,
}

#[account]
#[derive(InitSpace)]
pub struct EscrowAccount {
    pub launch: Pubkey,
    pub balance: u64,
}

#[account]
#[derive(InitSpace)]
pub struct SelectionState {
    pub launch: Pubkey,
    pub vrf_seed: [u8; 32],
    pub processed: u32,
    pub finalized: bool,
    pub threshold: Option<u128>,
    #[max_len(100)]
    pub heap: Vec<HeapEntry>, // size ≤ K
}

#[account]
#[derive(InitSpace)]
pub struct ProjectCounter {
    pub next_project_id: u64,
}

// -------------------------------
// Contexts (#[derive(Accounts)])
// -------------------------------

#[derive(Accounts)]
pub struct InitLaunch<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// Global project counter
    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + ProjectCounter::INIT_SPACE,
        seeds = [b"project_counter"],
        bump
    )]
    pub project_counter: Account<'info, ProjectCounter>,

    #[account(
        init,
        payer = admin,
        space = 8 + LaunchState::INIT_SPACE,
        seeds = [b"launch", sale_mint.key().as_ref()], // for MVP use sale_mint as launch_id
        bump
    )]
    pub launch_state: Account<'info, LaunchState>,

    /// Mint for sale tokens (program's mint authority will be PDA)
    #[account(mut)]
    pub sale_mint: Account<'info, Mint>,

    /// Escrow account (PDA off launch_state)
    #[account(
        init,
        payer = admin,
        space = 8 + EscrowAccount::INIT_SPACE,
        seeds = [b"escrow", launch_state.key().as_ref()],
        bump
    )]
    pub escrow: Account<'info, EscrowAccount>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitRoster<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    
    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,
    
    #[account(
        init,
        payer = admin,
        space = 8 + Roster::INIT_SPACE,
        seeds = [b"roster", launch_state.key().as_ref()],
        bump
    )]
    pub roster: Account<'info, Roster>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OnlyAdmin<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,
}

#[derive(Accounts)]
pub struct OnlyAdminWithSelection<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,
    #[account(
        init,
        payer = admin,
        space = 8 + SelectionState::INIT_SPACE,
        seeds = [b"selection", launch_state.key().as_ref()],
        bump
    )]
    pub selection_state: Account<'info, SelectionState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseDeposits<'info> {
    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,
    #[account(mut, has_one = launch)]
    pub roster: Account<'info, Roster>,
    /// CHECK: This is the launch account referenced by the roster
    #[account(address = launch_state.key())]
    pub launch: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ProcessBatch<'info> {
    #[account(mut)]
    pub selection_state: Account<'info, SelectionState>,
    pub launch_state: Account<'info, LaunchState>,
    pub roster: Account<'info, Roster>,
}

#[derive(Accounts)]
pub struct FinalizeSelection<'info> {
    #[account(mut)]
    pub selection_state: Account<'info, SelectionState>,
    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserContribution::INIT_SPACE,
        seeds = [b"user", launch_state.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_contribution: Account<'info, UserContribution>,
    #[account(mut, has_one = launch)]
    pub roster: Account<'info, Roster>,
    /// Escrow account (PDA off launch_state)
    #[account(mut, address = escrow_address(launch_state.key()))]
    pub escrow: Account<'info, EscrowAccount>,

    /// CHECK: This is the launch account referenced by the roster
    #[account(address = launch_state.key())]
    pub launch: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,
    #[account(mut, seeds = [b"user", launch_state.key().as_ref(), user.key().as_ref()], bump)]
    pub user_contribution: Account<'info, UserContribution>,
    #[account(mut, has_one = launch)]
    pub roster: Account<'info, Roster>,
    /// Escrow account (PDA off launch_state)
    #[account(mut, address = escrow_address(launch_state.key()))]
    pub escrow: Account<'info, EscrowAccount>,

    /// CHECK: This is the launch account referenced by the roster
    #[account(address = launch_state.key())]
    pub launch: UncheckedAccount<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimRefund<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    pub launch_state: Account<'info, LaunchState>,
    #[account(mut, seeds = [b"user", launch_state.key().as_ref(), user.key().as_ref()], bump)]
    pub user_contribution: Account<'info, UserContribution>,
    #[account(mut)]
    pub selection_state: Account<'info, SelectionState>,
    /// CHECK:
    #[account(mut, address = escrow_address(launch_state.key()))]
    pub escrow: Account<'info, EscrowAccount>,
}

#[derive(Accounts)]
pub struct ClaimTokens<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,
    #[account(mut, seeds = [b"user", launch_state.key().as_ref(), user.key().as_ref()], bump)]
    pub user_contribution: Account<'info, UserContribution>,
    #[account(mut)]
    pub selection_state: Account<'info, SelectionState>,

    #[account(mut)]
    pub sale_mint: Account<'info, Mint>,
    /// CHECK: mint authority PDA
    /// Seeds: ["mint_auth", launch_state]
    #[account(seeds = [b"mint_auth", launch_state.key().as_ref()], bump)]
    pub mint_auth: UncheckedAccount<'info>,

    #[account(mut)]
    pub user_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

// -------------------------------
// Utility / helpers
// -------------------------------

fn escrow_address(launch: Pubkey) -> Pubkey {
    let (address, _) = Pubkey::find_program_address(
        &[b"escrow", launch.as_ref()],
        &crate::ID,
    );
    address
}

/// Append or incr user's count; realloc roster if needed (MVP simplistic).
fn roster_add_or_incr(
    roster: &mut Account<Roster>,
    wallet: Pubkey,
    delta: u32,
    _payer: &Signer,
    _system_program: &Program<System>,
) -> Result<()> {
    if let Some(pos) = roster.wallets.iter().position(|w| *w == wallet) {
        roster.counts[pos] = roster.counts[pos].saturating_add(delta);
        return Ok(());
    }
    // append new
    roster.wallets.push(wallet);
    roster.counts.push(delta);
    Ok(())
}

fn roster_decr(roster: &mut Account<Roster>, wallet: Pubkey, lost: u32) -> Result<()> {
    if lost == 0 {
        return Ok(());
    }
    if let Some(pos) = roster.wallets.iter().position(|w| *w == wallet) {
        roster.counts[pos] = roster.counts[pos].saturating_sub(lost);
        Ok(())
    } else {
        err!(ErrorCode::UserNotFoundInRoster)
    }
}

fn roster_build_prefix(roster: &mut Account<Roster>) -> Result<()> {
    let mut run = 0u32;
    roster.prefix.clear();
    let counts = roster.counts.clone();
    roster.prefix.reserve(counts.len());
    for &c in counts.iter() {
        roster.prefix.push(run);
        run = run.saturating_add(c);
    }
    roster.total_in_shard = run;
    Ok(())
}

/// Map global t to (wallet, local_j).
fn ticket_at(t: u32, roster: &Account<Roster>) -> Result<(Pubkey, u32)> {
    require!(t < roster.total_in_shard, ErrorCode::TOutOfRange);
    // binary search for prefix[u] ≤ t < prefix[u] + count[u]
    let idx = match roster.prefix.binary_search(&t) {
        Ok(i) => i, // exact boundary = start of some user's block
        Err(i) => {
            // i = index of first prefix > t, so user = i - 1
            i.saturating_sub(1)
        }
    };
    let start = roster.prefix[idx];
    let c = roster.counts[idx];
    require!(t < start + c, ErrorCode::MappingError);
    let wallet = roster.wallets[idx];
    let local_j = t - start;
    Ok((wallet, local_j))
}

/// Deterministic score from seed + (wallet, local_j).
fn ticket_score(seed: &[u8; 32], wallet: &Pubkey, local_j: u32) -> u128 {
    let parts: [&[u8]; 4] = [SCORE_DOMAIN, seed, wallet.as_ref(), &local_j.to_le_bytes()];
    let h = keccak::hashv(&parts);
    // take first 16 bytes as little-endian u128
    let mut arr = [0u8; 16];
    arr.copy_from_slice(&h.0[0..16]);
    u128::from_le_bytes(arr)
}

fn tuple_lt(a: (Pubkey, u32), b: (Pubkey, u32)) -> bool {
    if a.0 == b.0 {
        a.1 < b.1
    } else {
        a.0.to_bytes() < b.0.to_bytes()
    }
}
fn tuple_gt(a: (Pubkey, u32), b: (Pubkey, u32)) -> bool {
    if a.0 == b.0 {
        a.1 > b.1
    } else {
        a.0.to_bytes() > b.0.to_bytes()
    }
}

/// Tie-break demo: in MVP we accept any with score < threshold.
/// If == threshold, we check whether (wallet, j) exists in heap (edge winners).
fn tie_break_wins(wallet: Pubkey, j: u32, threshold: u128, heap: &Vec<HeapEntry>) -> bool {
    heap.iter()
        .any(|e| e.score == threshold && e.wallet == wallet && e.local_j == j)
}

// -------------------------------
// Errors
// -------------------------------

#[error_code]
pub enum ErrorCode {
    #[msg("Funding period has ended")]
    FundingPeriodEnded,
    #[msg("Funding period has not ended yet")]
    FundingPeriodNotEnded,
    #[msg("Invalid funding duration (must be 0-5, where 0 = 10 seconds for testing)")]
    InvalidFundingDuration,
    #[msg("Claims are not open")]
    ClaimsNotOpen,
    #[msg("Deposits already closed")]
    AlreadyClosed,
    #[msg("Deposits not closed")]
    NotClosed,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Amount must be multiple of tau")]
    AmountNotMultipleTau,
    #[msg("Per-wallet cap exceeded")]
    PerWalletCapExceeded,
    #[msg("Insufficient deposit")]
    InsufficientDeposit,
    #[msg("Seed already set")]
    SeedAlreadySet,
    #[msg("Seed missing")]
    SeedMissing,
    #[msg("Selection already finalized")]
    AlreadyFinalized,
    #[msg("Selection not finalized")]
    NotFinalized,
    #[msg("Threshold missing")]
    ThresholdMissing,
    #[msg("Tokens per ticket missing")]
    TokensPerTicketMissing,
    #[msg("Invalid tau")]
    InvalidTau,
    #[msg("Invalid K")]
    InvalidK,
    #[msg("Not fully processed")]
    NotFullyProcessed,
    #[msg("Heap not full")]
    HeapNotFull,
    #[msg("User not found in roster")]
    UserNotFoundInRoster,
    #[msg("t out of range")]
    TOutOfRange,
    #[msg("Mapping error")]
    MappingError,
    #[msg("Already claimed refund")]
    AlreadyClaimedRefund,
    #[msg("Already claimed tokens")]
    AlreadyClaimedTokens,
}
