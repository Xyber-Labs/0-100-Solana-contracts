use crate::{
    errors::ErrorCode as EngineErrorCode,
    events::{ClaimsOpened, SelectionFinalized},
    state::{CreatorGrant, LaunchState},
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct OpenClaims<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,
    #[account(
        mut,
        seeds = [crate::constants::SEED_ROOT, b"creator", launch_state.key().as_ref()],
        bump,
    )]
    pub creator_grant: Account<'info, CreatorGrant>,
}

pub fn open_claims(ctx: Context<OpenClaims>) -> Result<()> {
    let launch_state = &mut ctx.accounts.launch_state;
    let creator_grant = &mut ctx.accounts.creator_grant;

    // Preconditions
    require!(launch_state.vrf_seed.is_some(), EngineErrorCode::SeedMissing);
    require!(
        launch_state.total_deposited >= launch_state.min_raise_lamports,
        EngineErrorCode::MinRaiseNotMet
    );
    require!(launch_state.roster_shards > 0, EngineErrorCode::ShardsNotFullyFinalized);
    let shards_total = launch_state.roster_shards as i32;
    require!(
        launch_state.roster_finalized_up_to + 1 == shards_total,
        EngineErrorCode::ShardsNotFullyFinalized
    );

    // --- New Proportional Creator Allocation Logic ---
    if launch_state.creator_grant_present {
        require!(launch_state.hard_cap_lamports > 0, EngineErrorCode::InvalidDivisor);

        // Calculate creator's share of the total pot as a percentage
        let creator_share_of_total = (launch_state.creator_initial_deposit as u128)
            .checked_mul(1_000_000) // Use precision factor for integer math
            .and_then(|val| val.checked_div(launch_state.hard_cap_lamports as u128))
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;

        // Calculate the number of tickets the creator should have based on their proportional share of k_capacity
        let creator_reserved_tickets_u128 = (launch_state.k_capacity as u128)
            .checked_mul(creator_share_of_total)
            .and_then(|val| val.checked_div(1_000_000)) // Divide by precision factor
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;

        require!(
            creator_reserved_tickets_u128 <= u32::MAX as u128,
            EngineErrorCode::U64ConversionOverflow
        );
        let creator_reserved_tickets = creator_reserved_tickets_u128 as u32;

        // Update creator grant account and launch state with the proportional ticket count
        creator_grant.reserved_tickets = creator_reserved_tickets;
        launch_state.creator_reserved_tickets = creator_reserved_tickets;
    }
    // The total_launch_allocation is simply the sale_allocation.
    // It's the total pie to be distributed amongst all winning tickets (public and creator).
    launch_state.total_launch_allocation = launch_state.sale_allocation;
    // --- End New Logic ---

    // --- Compute tokens per ticket ---
    // The number of "winning" tickets is the lesser of the total tickets sold (public + creator) and the hard cap.
    let grand_total_tickets = (launch_state.public_total_tickets as u64)
        .checked_add(launch_state.creator_reserved_tickets as u64)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;

    let divisor = grand_total_tickets.min(launch_state.k_capacity as u64);
    require!(divisor > 0, EngineErrorCode::InvalidDivisor);

    // Debug logging
    msg!("DEBUG: sale_allocation={}, k_capacity={}, public_tickets={}, creator_tickets={}, divisor={}", 
         launch_state.sale_allocation, launch_state.k_capacity, launch_state.public_total_tickets, launch_state.creator_reserved_tickets, divisor);

    let tokens_per_ticket = (launch_state.sale_allocation as u128)
        .checked_mul(1_000_000) // Precision factor
        .and_then(|val| val.checked_div(divisor as u128))
        .ok_or(EngineErrorCode::ArithmeticOverflow)? as u64;

    msg!("DEBUG: calculated tokens_per_ticket={}", tokens_per_ticket);

    launch_state.tokens_per_ticket = Some(tokens_per_ticket);
    launch_state.selection_finalized = true;

    launch_state.claims_open = true;
    let now = Clock::get()?.unix_timestamp;
    launch_state.claims_opened_at = Some(now);

    emit!(SelectionFinalized {
        launch: launch_state.key(),
        k_capacity: launch_state.k_capacity,
    });
    emit!(ClaimsOpened {
        launch: launch_state.key(),
        opened_at: now,
    });
    Ok(())
}
