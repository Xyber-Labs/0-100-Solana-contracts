use anchor_lang::prelude::*;
use crate::constants::SEED_ROOT;
use crate::errors::ErrorCode as EngineErrorCode;
use crate::events::RosterShardFinalized;
use crate::state::{LaunchState, RosterShard};

#[derive(Accounts)]
#[instruction(shard_id: u16)]
pub struct FinalizeRosterShard<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,
    #[account(
        mut,
        seeds = [SEED_ROOT, b"roster_shard", launch_state.key().as_ref(), &shard_id.to_le_bytes()],
        bump,
        constraint = roster_shard.launch == launch_state.key(),
    )]
    pub roster_shard: Account<'info, RosterShard>,
}

pub fn handler(ctx: Context<FinalizeRosterShard>, shard_id: u16) -> Result<()> {
    let launch_state = &mut ctx.accounts.launch_state;
    let shard = &mut ctx.accounts.roster_shard;

    // Preconditions: funding ended
    let now = Clock::get()?.unix_timestamp;
    require!(now >= launch_state.funding_period_end, EngineErrorCode::FundingPeriodNotEnded);

    // Enforce sequential finalization
    let expected = launch_state
        .roster_finalized_up_to
        .checked_add(1)
        .ok_or(EngineErrorCode::ArithmeticOverflow)? as u16;
    require!(shard_id == expected, EngineErrorCode::InvalidFinalizeOrder);
    require!(shard.shard_id == shard_id, EngineErrorCode::Unauthorized);

    // Ensure lengths are consistent before building prefix
    require!(
        shard.wallets.len() == shard.counts.len(),
        EngineErrorCode::MappingError
    );

    // Build prefix and totals
    let mut run = 0u32;
    shard.prefix.clear();
    let counts = shard.counts.clone();
    shard.prefix.reserve(counts.len());
    for &c in counts.iter() {
        shard.prefix.push(run);
        run = run.checked_add(c).ok_or(EngineErrorCode::ArithmeticOverflow)?;
    }
    shard.total_in_shard = run;

    // Assign shard base and bump global total
    shard.shard_base = launch_state.public_total_tickets;
    launch_state.public_total_tickets = launch_state
        .public_total_tickets
        .checked_add(shard.total_in_shard)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;

    launch_state.roster_finalized_up_to = shard_id as i32;

    emit!(RosterShardFinalized {
        launch: launch_state.key(),
        shard_id,
        total_in_shard: shard.total_in_shard,
        shard_base: shard.shard_base,
    });

    Ok(())
}


