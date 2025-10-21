use anchor_lang::prelude::*;

use crate::{errors::ErrorCode as EngineErrorCode, state::LaunchState};

#[derive(Accounts)]
pub struct OpenClaims<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,
}

pub fn open_claims(ctx: Context<OpenClaims>) -> Result<()> {
    let state = &mut ctx.accounts.launch_state;
    require!(state.selection_finalized, EngineErrorCode::NotFinalized);
    require!(!state.claims_open, EngineErrorCode::ClaimsNotOpen);

    state.claims_open = true;
    state.claims_opened_at = Some(Clock::get()?.unix_timestamp);

    Ok(())
}



