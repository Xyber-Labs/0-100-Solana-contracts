use crate::constants::{ROSTER_SHARD_CAP, SEED_ROOT};
use crate::events::RosterShardInitialized;
use crate::state::{LaunchState, RosterShard};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(shard_id: u16)]
pub struct InitRosterShard<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,
    #[account(
        init,
        payer = payer,
        space = 8 + RosterShard::INIT_SPACE
                + (32 * ROSTER_SHARD_CAP)
                + (4 * ROSTER_SHARD_CAP)
                + (4 * ROSTER_SHARD_CAP),
        seeds = [SEED_ROOT, b"roster_shard", launch_state.key().as_ref(), &shard_id.to_le_bytes()],
        bump,
    )]
    pub roster_shard: Account<'info, RosterShard>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitRosterShard>, shard_id: u16) -> Result<()> {
    let launch_state = &mut ctx.accounts.launch_state;
    let shard = &mut ctx.accounts.roster_shard;
    shard.launch = launch_state.key();
    shard.shard_id = shard_id;
    shard.total_in_shard = 0;
    shard.shard_base = 0;

    // Ensure launch_state.roster_shards reflects at least max(shard_id) + 1
    let required = shard_id.saturating_add(1);
    launch_state.roster_shards = launch_state.roster_shards.max(required);

    emit!(RosterShardInitialized {
        launch: launch_state.key(),
        shard_id,
    });
    Ok(())
}
