use anchor_lang::prelude::*;
use crate::errors::ErrorCode as EngineErrorCode;
use crate::events::{SelectionFinalized, ClaimsOpened};
use crate::state::LaunchState;

#[derive(Accounts)]
pub struct OpenClaims<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,
}

pub fn handler(ctx: Context<OpenClaims>) -> Result<()> {
    let launch_state = &mut ctx.accounts.launch_state;

    // Preconditions
    require!(launch_state.vrf_seed.is_some(), EngineErrorCode::SeedMissing);
    require!(launch_state.total_deposited >= launch_state.min_raise_lamports, EngineErrorCode::MinRaiseNotMet);
    require!(launch_state.roster_shards > 0, EngineErrorCode::ShardsNotFullyFinalized);
    let shards_total = launch_state.roster_shards as i32;
    require!(launch_state.roster_finalized_up_to + 1 == shards_total, EngineErrorCode::ShardsNotFullyFinalized);

    // Compute tokens per ticket over K capacity
    require!(launch_state.k_capacity > 0, EngineErrorCode::InvalidK);
    launch_state.tokens_per_ticket = Some(
        launch_state.sale_allocation
            .checked_div(launch_state.k_capacity as u64)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?,
    );
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


