#![allow(unexpected_cfgs)]
use anchor_lang::prelude::borsh::BorshSchema;
use anchor_lang::prelude::*;
use anchor_lang::solana_program;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};
use solana_program::keccak;
use solana_program::sysvar::clock::Clock;
use solana_program::sysvar::{self, Sysvar};

mod errors;
mod events;
mod utils;

declare_id!("DhKVzFTjzax7MeLEqiEXmEhm6ERSjehYaamqai5oPKZ7");

#[constant]
pub const SEED_ROOT: &[u8] = b"root-0-100-1";

// -------------------------------
// Constants
// -------------------------------
const MIN_N: u64 = 100;
const MAX_N: u64 = 500_000;
const DEFAULT_N: u64 = 81_000;

// -------------------------------
// Events (moved to events.rs)
// -------------------------------

#[program]
pub mod engine {
    use super::*;
    use crate::errors::ErrorCode as EngineErrorCode;
    use crate::events::*;
    use crate::utils::roster::{roster_add_or_incr, roster_build_prefix, roster_decr};
    use crate::utils::selection::{ticket_at, ticket_score, tie_break_wins, tuple_gt, tuple_lt};

    /// Create launch + PDAs (escrow, mint authority PDA is derived, not stored).
    pub fn init_launch(
        ctx: Context<InitLaunch>,
        hard_cap_lamports: u64,
        min_raise_lamports: u64,
        per_wallet_cap: u64,
        tau_lamports: u64,
        sale_allocation: u64, // number of sale tokens
        lp_allocation: u64,   // number of LP tokens to allocate (informational for MVP)
        funding_duration_seconds: i64,
        num_blocks: u64, // N value for hash range calculation
    ) -> Result<()> {
        require!(tau_lamports > 0, EngineErrorCode::InvalidTau);
        // Max duration: 7 days
        require!(
            funding_duration_seconds > 0 && funding_duration_seconds <= 60 * 60 * 24 * 7,
            EngineErrorCode::InvalidFundingDuration
        );

        let n = if num_blocks == 0 {
            DEFAULT_N
        } else {
            num_blocks
        };
        require!(n >= MIN_N && n <= MAX_N, EngineErrorCode::InvalidNumBlocks);

        let counter = &mut ctx.accounts.project_counter;
        let project_id = counter
            .last_project_id
            .checked_add(1)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;
        counter.last_project_id = project_id;

        let state = &mut ctx.accounts.launch_state;
        state.project_id = project_id;
        state.creator = ctx.accounts.creator.key();
        state.hard_cap_lamports = hard_cap_lamports;
        state.min_raise_lamports = min_raise_lamports;
        state.per_wallet_cap = per_wallet_cap;
        state.tau_lamports = tau_lamports;
        state.sale_allocation = sale_allocation;
        state.lp_allocation = lp_allocation;
        state.num_blocks = n;

        // Set funding period end time (current time + duration)
        let current_time = Clock::get()?.unix_timestamp;
        state.funding_period_end = current_time
            .checked_add(funding_duration_seconds)
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
            hard_cap_lamports,
            min_raise_lamports,
            per_wallet_cap,
            tau_lamports,
            sale_allocation,
            lp_allocation,
            num_blocks: state.num_blocks,
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

    /// Permissionless seed setter using recent blockhash.
    pub fn set_seed(ctx: Context<SetSeed>) -> Result<()> {
        let st = &mut ctx.accounts.launch_state;

        // Check if funding period has ended
        let current_time = Clock::get()?.unix_timestamp;
        require!(
            current_time >= st.funding_period_end,
            EngineErrorCode::FundingPeriodNotEnded
        );
        require!(
            st.total_deposited >= st.min_raise_lamports,
            EngineErrorCode::MinRaiseNotMet
        );

        require!(st.vrf_seed.is_none(), EngineErrorCode::SeedAlreadySet);

        // Get the most recent blockhash from the SlotHashes sysvar
        let slot_hashes = &ctx.accounts.slot_hashes;
        let data = slot_hashes.try_borrow_data()?;

        // The first 8 bytes are the number of hashes, then it's a list of (slot, hash)
        // We take the most recent one.
        let num_hashes = u64::from_le_bytes(data[0..8].try_into().unwrap());
        require!(num_hashes > 0, EngineErrorCode::NoRecentBlockhashes);

        let num_hashes_u64 = num_hashes as u64;
        let one = 1 as u64;
        let forty = 40 as u64;

        let num_hashes_minus_1 = num_hashes_u64
            .checked_sub(one)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;
        let offset = num_hashes_minus_1
            .checked_mul(forty)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;

        // Position of the last hash: 8 bytes for num_hashes + (num_hashes - 1) * 40 bytes per entry
        let last_hash_pos = 8u64
            .checked_add(offset)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?
            .checked_add(8)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?; // 8 for slot

        let start = last_hash_pos as usize;
        let end = last_hash_pos
            .checked_add(32)
            .ok_or(EngineErrorCode::ArithmeticOverflow)? as usize;

        let seed: [u8; 32] = data[start..end].try_into().unwrap();

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

    /// Permissionless crank: process up to max_items tickets (t = processed ..).
    pub fn process_batch(ctx: Context<ProcessBatch>, max_items: u16) -> Result<()> {
        let st = &mut ctx.accounts.launch_state;
        let sel = &mut ctx.accounts.selection_state;
        let roster = &mut ctx.accounts.roster;

        // Check if funding period has ended
        let current_time = Clock::get()?.unix_timestamp;
        require!(
            current_time >= st.funding_period_end,
            EngineErrorCode::FundingPeriodNotEnded
        );
        require!(
            st.total_deposited >= st.min_raise_lamports,
            EngineErrorCode::MinRaiseNotMet
        );

        require!(sel.finalized == false, EngineErrorCode::AlreadyFinalized);
        let seed = st.vrf_seed.ok_or(EngineErrorCode::SeedMissing)?;

        // Auto-calculate k_capacity and total_tickets if not done yet
        if st.k_capacity == 0 {
            st.k_capacity = (st
                .hard_cap_lamports
                .checked_div(st.tau_lamports)
                .ok_or(EngineErrorCode::ArithmeticOverflow)?) as u32;
            roster_build_prefix(roster)?;
            roster.shard_base = 0; // single-shard MVP
            st.total_tickets = roster.total_in_shard;
        }

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
            sel.processed = sel
                .processed
                .checked_add(1)
                .ok_or(EngineErrorCode::ArithmeticOverflow)?;
            steps = steps
                .checked_add(1)
                .ok_or(EngineErrorCode::ArithmeticOverflow)?;
        }

        // If we haven’t set capacity yet, set it once at the start (your code already does this).
        if st.k_capacity == 0 {
            st.k_capacity = (st
                .hard_cap_lamports
                .checked_div(st.tau_lamports)
                .ok_or(EngineErrorCode::ArithmeticOverflow)?) as u32;
            roster_build_prefix(roster)?;
            roster.shard_base = 0;
            st.total_tickets = roster.total_in_shard;
        }

        // If no overflow, short-circuit and open claims immediately without heap work
        let k = st.k_capacity as usize;
        if st.total_tickets as usize <= k {
            // Everyone wins
            st.selection_finalized = true;
            st.threshold_score = Some(u128::MAX);
            st.tokens_per_ticket = Some(
                st.sale_allocation
                    .checked_div(st.total_tickets as u64)
                    .ok_or(EngineErrorCode::ArithmeticOverflow)?,
            );
            st.claims_open = true;
            // Mark selection_state finalized for consistency
            sel.finalized = true;
            sel.threshold = st.threshold_score;
            emit!(SelectionFinalized {
                launch: st.key(),
                threshold: st.threshold_score.unwrap(),
                k_capacity: st.k_capacity,
            });
            return Ok(());
        }

        // Overflow path (existing heap maintenance already done above).
        // If we’ve processed all tickets, finalize + open claims here.
        if sel.processed == st.total_tickets && !sel.finalized {
            require!(sel.heap.len() == k, EngineErrorCode::HeapNotFull);
            let mut worst: Option<u128> = None;
            for h in sel.heap.iter() {
                worst = Some(worst.map_or(h.score, |w| w.max(h.score)));
            }
            let thr = worst.unwrap();
            sel.finalized = true;
            sel.threshold = Some(thr);

            st.selection_finalized = true;
            st.threshold_score = Some(thr);
            // tokens per ticket uses K (capacity), not number of winners (ties handled in y_i)
            st.tokens_per_ticket = Some(
                st.sale_allocation
                    .checked_div(st.k_capacity as u64)
                    .ok_or(EngineErrorCode::ArithmeticOverflow)?,
            );
            st.claims_open = true;

            emit!(SelectionFinalized {
                launch: st.key(),
                threshold: thr,
                k_capacity: st.k_capacity,
            });
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

        // Check if funding period is still active
        let current_time = Clock::get()?.unix_timestamp;
        require!(
            current_time < st.funding_period_end,
            EngineErrorCode::FundingPeriodEnded
        );
        require!(
            amount > 0 && amount % st.tau_lamports == 0,
            EngineErrorCode::AmountNotMultipleTau
        );

        // per-wallet cap check
        let current = ctx.accounts.user_contribution.deposited;
        require!(
            current
                .checked_add(amount)
                .ok_or(EngineErrorCode::ArithmeticOverflow)?
                <= st.per_wallet_cap,
            EngineErrorCode::PerWalletCapExceeded
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
        ctx.accounts.escrow.balance = ctx
            .accounts
            .escrow
            .balance
            .checked_add(amount)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;

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
        user.deposited = current
            .checked_add(amount)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;
        let new_tickets = (user
            .deposited
            .checked_div(st.tau_lamports)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?) as u32;
        let delta = new_tickets
            .checked_sub(old_tickets)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;
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

        st.total_deposited = st
            .total_deposited
            .checked_add(amount)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;
        st.total_tickets = st
            .total_tickets
            .checked_add(delta)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;

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

        // Check if funding period is still active
        let current_time = Clock::get()?.unix_timestamp;
        require!(
            current_time < st.funding_period_end,
            EngineErrorCode::FundingPeriodEnded
        );
        let user = &mut ctx.accounts.user_contribution;
        require!(
            user.deposited >= amount,
            EngineErrorCode::InsufficientDeposit
        );

        // return lamports from escrow to user
        **ctx
            .accounts
            .escrow
            .to_account_info()
            .try_borrow_mut_lamports()? -= amount;
        **ctx
            .accounts
            .user
            .to_account_info()
            .try_borrow_mut_lamports()? += amount;

        // Update escrow balance
        ctx.accounts.escrow.balance = ctx
            .accounts
            .escrow
            .balance
            .checked_sub(amount)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;

        // recompute tickets
        let old_tickets = user.ticket_count;
        user.deposited = user
            .deposited
            .checked_sub(amount)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;
        let new_tickets = (user
            .deposited
            .checked_div(st.tau_lamports)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?) as u32;
        let lost = old_tickets
            .checked_sub(new_tickets)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;
        user.ticket_count = new_tickets;

        // roster decrement
        let roster = &mut ctx.accounts.roster;
        roster_decr(roster, user.wallet, lost)?;
        st.total_tickets = st
            .total_tickets
            .checked_sub(lost)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;
        st.total_deposited = st
            .total_deposited
            .checked_sub(amount)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;

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
        let user = &mut ctx.accounts.user_contribution;
        require!(!user.claimed_refund, EngineErrorCode::AlreadyClaimedRefund);

        // If funding is complete and min raise is not met, issue a full refund without selection
        let current_time = Clock::get()?.unix_timestamp;
        if current_time >= st.funding_period_end && st.total_deposited < st.min_raise_lamports {
            let refund = user.deposited;
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
                y_approved: 0,
            });

            return Ok(());
        }

        // Otherwise, proceed as before: requires finalized selection and y calculation
        require!(st.selection_finalized, EngineErrorCode::NotFinalized);
        let threshold = st
            .threshold_score
            .ok_or(EngineErrorCode::ThresholdMissing)?;
        let seed = st.vrf_seed.ok_or(EngineErrorCode::SeedMissing)?;

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
                y = y
                    .checked_add(1)
                    .ok_or(EngineErrorCode::ArithmeticOverflow)?;
            }
        }

        let approved_lamports = (y as u64)
            .checked_mul(st.tau_lamports)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;
        let refund = user
            .deposited
            .checked_sub(approved_lamports)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;
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
        require!(st.claims_open, EngineErrorCode::ClaimsNotOpen);
        let per = st
            .tokens_per_ticket
            .ok_or(EngineErrorCode::TokensPerTicketMissing)?;

        // Tokens are claimed only if the raise was successful
        require!(
            st.total_deposited >= st.min_raise_lamports,
            EngineErrorCode::MinRaiseNotMet
        );

        let threshold = st
            .threshold_score
            .ok_or(EngineErrorCode::ThresholdMissing)?;
        let seed = st.vrf_seed.ok_or(EngineErrorCode::SeedMissing)?;

        let user = &mut ctx.accounts.user_contribution;
        require!(!user.claimed_tokens, EngineErrorCode::AlreadyClaimedTokens);

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
                y = y
                    .checked_add(1)
                    .ok_or(EngineErrorCode::ArithmeticOverflow)?;
            }
        }
        if y == 0 {
            user.claimed_tokens = true;
            return Ok(());
        }
        let amount = per
            .checked_mul(y as u64)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;

        // Mint from sale_mint; mint authority is PDA [mint_auth, launch_state]
        let seeds: &[&[u8]] = &[
            SEED_ROOT,
            b"mint_auth",
            &st.key().to_bytes(),
            &[st.mint_auth_bump()],
        ];
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

    /// Create pool with blockhash verification
    /// Checks if any of the last 10 blockhashes meets the probability threshold
    pub fn create_pool(ctx: Context<CreatePool>) -> Result<()> {
        let st = &mut ctx.accounts.launch_state;
        let pool_state = &mut ctx.accounts.pool_state;

        // Check if selection is finalized and claims are open
        require!(st.selection_finalized, EngineErrorCode::NotFinalized);
        require!(st.claims_open, EngineErrorCode::ClaimsNotOpen);
        require!(!pool_state.created, EngineErrorCode::PoolAlreadyCreated);

        // Get the SlotHashes sysvar
        let slot_hashes = &ctx.accounts.slot_hashes;
        let data = slot_hashes.try_borrow_data()?;

        // The first 8 bytes are the number of hashes, then it's a list of (slot, hash)
        let num_hashes = u64::from_le_bytes(data[0..8].try_into().unwrap());
        require!(num_hashes > 0, EngineErrorCode::NoRecentBlockhashes);

        let hashes_to_check = std::cmp::min(64, num_hashes);
        let mut found_valid_hash = false;
        let mut valid_slot = 0u64;
        let mut valid_hash = [0u8; 32];

        for i in 0..hashes_to_check {
            // Calculate position: 8 bytes for num_hashes + (num_hashes - 1 - i) * 40 bytes per entry
            let hash_pos = 8u64
                .checked_add(
                    i.checked_mul(40)
                        .ok_or(EngineErrorCode::ArithmeticOverflow)?,
                )
                .ok_or(EngineErrorCode::ArithmeticOverflow)?;
            let slot_pos = hash_pos;
            let blockhash_pos = hash_pos
                .checked_add(8)
                .ok_or(EngineErrorCode::ArithmeticOverflow)?; // 8 bytes for slot

            let slot = u64::from_le_bytes(
                data[slot_pos as usize
                    ..(slot_pos
                        .checked_add(8)
                        .ok_or(EngineErrorCode::ArithmeticOverflow)?)
                        as usize]
                    .try_into()
                    .unwrap(),
            );
            let blockhash: [u8; 32] = data[blockhash_pos as usize
                ..(blockhash_pos
                    .checked_add(32)
                    .ok_or(EngineErrorCode::ArithmeticOverflow)?) as usize]
                .try_into()
                .unwrap();

            // msg!("Checking slot: {}, blockhash: {:?}", slot, blockhash);

            // Check if this blockhash is within the project's personal range
            if utils::is_blockhash_in_project_range(&blockhash, st.project_id, st.num_blocks) {
                found_valid_hash = true;
                valid_slot = slot;
                valid_hash = blockhash;
                break;
            }
        }

        require!(found_valid_hash, EngineErrorCode::NoValidBlockhash);
        let (valid_slot, valid_hash) = (valid_slot, valid_hash);

        // Get pool ID from project counter
        let counter = &mut ctx.accounts.project_counter;
        let pool_id = counter
            .last_pool_id
            .checked_add(1)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;
        counter.last_pool_id = pool_id;

        // Calculate and store the project's range
        let (range_start, range_end) = utils::calculate_project_range(st.project_id, st.num_blocks);
        let mut range_start_bytes = [0u8; 32];
        range_start.to_big_endian(&mut range_start_bytes);
        let mut range_end_bytes = [0u8; 32];
        range_end.to_big_endian(&mut range_end_bytes);

        // Initialize pool state
        pool_state.launch = st.key();
        pool_state.pool_id = pool_id;
        pool_state.project_id = st.project_id;
        pool_state.created_slot = valid_slot;
        pool_state.created_blockhash = valid_hash;
        pool_state.range_start = range_start_bytes;
        pool_state.range_end = range_end_bytes;
        pool_state.created = true;

        // TODO: Add CPI call to Raydium here

        emit!(PoolCreated {
            launch: st.key(),
            pool_id,
            project_id: st.project_id,
            blockhash: valid_hash,
            slot: valid_slot,
            range_start: range_start_bytes,
            range_end: range_end_bytes,
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

    // creator
    pub creator: Pubkey,

    // Config
    pub hard_cap_lamports: u64,
    pub min_raise_lamports: u64,
    pub per_wallet_cap: u64,
    pub tau_lamports: u64,
    pub num_blocks: u64, // N value for hash range calculation

    // Sale/LP (MVP)
    pub sale_mint: Pubkey,
    pub sale_allocation: u64,
    pub lp_allocation: u64,

    // Funding
    pub funding_period_end: i64, // Unix timestamp when funding period ends
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
    pub fn mint_auth_seeds<'a>(&'a self, launch_key: &'a Pubkey) -> [&'a [u8]; 2] {
        [b"mint_auth", launch_key.as_ref()]
    }
    pub fn mint_auth_bump(&self) -> u8 {
        // Get the canonical bump for the mint authority PDA
        // We need to derive the launch state key first
        let launch_key = Pubkey::find_program_address(
            &[SEED_ROOT, b"launch", self.sale_mint.as_ref()],
            &crate::ID,
        )
        .0;
        let (_, bump) = Pubkey::find_program_address(
            &[SEED_ROOT, b"mint_auth", launch_key.as_ref()],
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
    pub last_project_id: u64,
    pub last_pool_id: u64,
}

#[account]
#[derive(InitSpace)]
pub struct PoolState {
    pub launch: Pubkey,
    pub pool_id: u64,
    pub project_id: u64,
    pub created_slot: u64,
    pub created_blockhash: [u8; 32],
    pub range_start: [u8; 32],
    pub range_end: [u8; 32],
    pub created: bool,
}

// -------------------------------
// Contexts (#[derive(Accounts)])
// -------------------------------

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

#[derive(Accounts)]
pub struct InitRoster<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,

    #[account(
        init,
        payer = payer,
        space = 8 + Roster::INIT_SPACE,
        seeds = [SEED_ROOT, b"roster", launch_state.key().as_ref()],
        bump
    )]
    pub roster: Account<'info, Roster>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetSeed<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,
    #[account(
        init,
        payer = payer,
        space = 8 + SelectionState::INIT_SPACE,
        seeds = [SEED_ROOT, b"selection", launch_state.key().as_ref()],
        bump
    )]
    pub selection_state: Account<'info, SelectionState>,
    /// CHECK: The SlotHashes sysvar is a known account, and we check the address.
    #[account(address = sysvar::slot_hashes::ID)]
    pub slot_hashes: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ProcessBatch<'info> {
    #[account(mut)]
    pub selection_state: Account<'info, SelectionState>,
    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,
    #[account(mut)]
    pub roster: Account<'info, Roster>,
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
        seeds = [SEED_ROOT, b"user", launch_state.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_contribution: Account<'info, UserContribution>,
    #[account(mut, has_one = launch)]
    pub roster: Account<'info, Roster>,
    /// Escrow account (PDA off launch_state)
    #[account(mut, address = crate::utils::pool::escrow_address(launch_state.key()))]
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
    #[account(mut, seeds = [SEED_ROOT, b"user", launch_state.key().as_ref(), user.key().as_ref()], bump)]
    pub user_contribution: Account<'info, UserContribution>,
    #[account(mut, has_one = launch)]
    pub roster: Account<'info, Roster>,
    /// Escrow account (PDA off launch_state)
    #[account(mut, address = crate::utils::pool::escrow_address(launch_state.key()))]
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
    #[account(mut, seeds = [SEED_ROOT, b"user", launch_state.key().as_ref(), user.key().as_ref()], bump)]
    pub user_contribution: Account<'info, UserContribution>,
    #[account(mut)]
    pub selection_state: Account<'info, SelectionState>,
    /// CHECK:
    #[account(mut, address = crate::utils::pool::escrow_address(launch_state.key()))]
    pub escrow: Account<'info, EscrowAccount>,
}

#[derive(Accounts)]
pub struct ClaimTokens<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,
    #[account(mut, seeds = [SEED_ROOT, b"user", launch_state.key().as_ref(), user.key().as_ref()], bump)]
    pub user_contribution: Account<'info, UserContribution>,
    #[account(mut)]
    pub selection_state: Account<'info, SelectionState>,

    #[account(mut)]
    pub sale_mint: Account<'info, Mint>,
    /// CHECK: mint authority PDA
    /// Seeds: ["mint_auth", launch_state]
    #[account(seeds = [SEED_ROOT, b"mint_auth", launch_state.key().as_ref()], bump)]
    pub mint_auth: UncheckedAccount<'info>,

    #[account(mut)]
    pub user_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CreatePool<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,

    #[account(
        init,
        payer = payer,
        space = 8 + PoolState::INIT_SPACE,
        seeds = [SEED_ROOT, b"pool", launch_state.key().as_ref()],
        bump
    )]
    pub pool_state: Account<'info, PoolState>,

    #[account(mut)]
    pub project_counter: Account<'info, ProjectCounter>,

    /// CHECK: The SlotHashes sysvar is a known account, and we check the address.
    #[account(address = sysvar::slot_hashes::ID)]
    pub slot_hashes: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

// -------------------------------
// Utility / helpers
// -------------------------------

// -------------------------------
// Errors (moved to errors.rs)
// -------------------------------
