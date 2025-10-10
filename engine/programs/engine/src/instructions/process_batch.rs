use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::clock::Clock;
use crate::errors::ErrorCode as EngineErrorCode;
use crate::events::*;
use crate::utils::roster::roster_build_prefix;
use crate::utils::selection::{ticket_at, ticket_score, tuple_gt, tuple_lt};
use crate::types::{HeapEntry, ProcessBatch};

pub fn handler(ctx: Context<ProcessBatch>, max_items: u16) -> Result<()> {
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

    require!(!sel.finalized, EngineErrorCode::AlreadyFinalized);
    let seed = st.vrf_seed.ok_or(EngineErrorCode::SeedMissing)?;

    // Auto-calculate k_capacity and total_tickets if not done yet
    if st.k_capacity == 0 {
        st.k_capacity = (st
            .hard_cap_lamports
            .checked_div(st.tau_lamports)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?) as u32;
        roster_build_prefix(roster)?;
        roster.shard_base = 0; // single-shard MVP
        st.total_tickets = roster.total_in_shard; // only public tickets (without creator)
    }

    // Calculate reserved tickets and lottery capacity
    let reserved = st.creator_reserved_tickets.min(st.k_capacity);
    require!(reserved <= st.k_capacity, EngineErrorCode::ReservedExceedsCapacity);
    let k_heap = (st.k_capacity - reserved) as usize;

    const MAX_HEAP_SIZE: usize = 100;
    require!(k_heap <= MAX_HEAP_SIZE, EngineErrorCode::HeapCapacityExceeded);

    let from_t = sel.processed; // Capture initial value for event
    let mut steps = 0usize;
    while sel.processed < st.total_tickets && steps < max_items as usize {
        let t = sel.processed;
        let (wallet, local_j) = ticket_at(t, roster)?;
        let score = ticket_score(&seed, &wallet, local_j);

        // maintain top-K (max-heap behavior via vector)
        if sel.heap.len() < k_heap {
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

    // If no overflow, short-circuit and open claims immediately without heap work
    if st.total_tickets as usize <= k_heap {
        st.selection_finalized = true;
        st.threshold_score = Some(u128::MAX);
        st.tokens_per_ticket = Some(
            st.sale_allocation
                .checked_div(st.total_tickets.max(1) as u64)
                .ok_or(EngineErrorCode::ArithmeticOverflow)?,
        );
        st.claims_open = true;
        let now = Clock::get()?.unix_timestamp;
        st.claims_opened_at = Some(now);

        sel.finalized = true;
        sel.threshold = st.threshold_score;

        emit!(SelectionFinalized {
            launch: st.key(),
            threshold: st.threshold_score.unwrap(),
            k_capacity: st.k_capacity,
        });
        emit!(ClaimsOpened {
            launch: st.key(),
            opened_at: now,
        });

        return Ok(());
    }

    // Overflow path (existing heap maintenance already done above).
    // If we've processed all tickets, finalize + open claims here.
    if sel.processed == st.total_tickets && !sel.finalized {
        let thr = if k_heap == 0 {
            0u128 // no lottery winners
        } else {
            require!(sel.heap.len() == k_heap, EngineErrorCode::HeapNotFull);
            let mut worst: Option<u128> = None;
            for h in sel.heap.iter() {
                worst = Some(worst.map_or(h.score, |w| w.max(h.score)));
            }
            worst.unwrap()
        };

        sel.finalized = true;
        sel.threshold = Some(thr);

        st.selection_finalized = true;
        st.threshold_score = Some(thr);
        st.tokens_per_ticket = Some(
            st.sale_allocation
                .checked_div(st.k_capacity as u64)
                .ok_or(EngineErrorCode::ArithmeticOverflow)?,
        );
        st.claims_open = true;
        let now = Clock::get()?.unix_timestamp;
        st.claims_opened_at = Some(now);

        emit!(SelectionFinalized {
            launch: st.key(),
            threshold: thr,
            k_capacity: st.k_capacity,
        });
        emit!(ClaimsOpened {
            launch: st.key(),
            opened_at: now,
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
