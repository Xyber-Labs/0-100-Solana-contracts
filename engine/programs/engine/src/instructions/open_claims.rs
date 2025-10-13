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
    let st = &mut ctx.accounts.launch_state;

    // Preconditions
    require!(st.vrf_seed.is_some(), EngineErrorCode::SeedMissing);
    require!(st.total_deposited >= st.min_raise_lamports, EngineErrorCode::MinRaiseNotMet);
    require!(st.roster_shards > 0, EngineErrorCode::ShardsNotFullyFinalized);
    let shards_total = st.roster_shards as i32;
    require!(st.roster_finalized_up_to + 1 == shards_total, EngineErrorCode::ShardsNotFullyFinalized);

    // Compute tokens per ticket over K capacity
    require!(st.k_capacity > 0, EngineErrorCode::InvalidK);
    st.tokens_per_ticket = Some(
        st.sale_allocation
            .checked_div(st.k_capacity as u64)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?,
    );
    st.selection_finalized = true;

    st.claims_open = true;
    let now = Clock::get()?.unix_timestamp;
    st.claims_opened_at = Some(now);

    emit!(SelectionFinalized {
        launch: st.key(),
        k_capacity: st.k_capacity,
    });
    emit!(ClaimsOpened {
        launch: st.key(),
        opened_at: now,
    });
    Ok(())
}


