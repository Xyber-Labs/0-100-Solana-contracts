use crate::{
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    events::RosterShardFinalized,
    state::{LaunchState, RosterShard},
};
use anchor_lang::prelude::*;

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

pub fn finalize_roster_shard(ctx: Context<FinalizeRosterShard>, shard_id: u16) -> Result<()> {
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
    require!(shard.wallets.len() == shard.counts.len(), EngineErrorCode::MappingError);

    // Build prefix and totals
    let mut run = 0u32;
    shard.prefix.clear();
    let counts = shard.counts.clone();
    shard.prefix.reserve(counts.len());

    // Debug logging
    msg!("DEBUG: Shard {} has {} users with counts: {:?}", shard_id, counts.len(), counts);

    for &c in counts.iter() {
        shard.prefix.push(run);
        run = run.checked_add(c).ok_or(EngineErrorCode::ArithmeticOverflow)?;
    }
    shard.total_in_shard = run;

    // Debug logging
    msg!("DEBUG: Shard {} calculated total_in_shard={}", shard_id, shard.total_in_shard);

    // Assign shard base and update public_total_tickets
    shard.shard_base = launch_state.public_total_tickets;
    launch_state.public_total_tickets = launch_state
        .public_total_tickets
        .checked_add(shard.total_in_shard)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;

    // Debug logging (remove in production)
    msg!(
        "DEBUG: Shard {} finalized: shard_base={}, total_in_shard={}, public_total_tickets={}",
        shard_id,
        shard.shard_base,
        shard.total_in_shard,
        launch_state.public_total_tickets
    );

    launch_state.roster_finalized_up_to = shard_id as i32;

    // If this was the last shard, flip selection_finalized and emit event
    let all_finalized = (shard_id as u32 + 1) == launch_state.roster_shards as u32;
    if all_finalized && !launch_state.selection_finalized {
        launch_state.selection_finalized = true;
        emit!(crate::events::SelectionFinalized {
            launch: launch_state.key(),
            k_capacity: launch_state.k_capacity,
        });
    }

    emit!(RosterShardFinalized {
        launch: launch_state.key(),
        shard_id,
        total_in_shard: shard.total_in_shard,
        shard_base: shard.shard_base,
    });

    Ok(())
}
