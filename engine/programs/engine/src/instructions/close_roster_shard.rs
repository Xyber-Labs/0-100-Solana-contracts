use anchor_lang::prelude::*;

use crate::{
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    state::{LaunchState, RosterShard},
};

#[derive(Accounts)]
#[instruction(shard_id: u16)]
pub struct CloseRosterShard<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,
    #[account(
        mut,
        close = payer,
        seeds = [SEED_ROOT, b"roster_shard", launch_state.key().as_ref(), &shard_id.to_le_bytes()],
        bump,
        constraint = roster_shard.launch == launch_state.key()
    )]
    pub roster_shard: Account<'info, RosterShard>,
    pub system_program: Program<'info, System>,
}

pub fn close_roster_shard(ctx: Context<CloseRosterShard>, shard_id: u16) -> Result<()> {
    let launch = &ctx.accounts.launch_state;
    let shard = &mut ctx.accounts.roster_shard;

    require!(
        launch.roster_finalized_up_to >= shard_id as i32,
        EngineErrorCode::ShardNotFinalized
    );
    require!(shard.shard_id == shard_id, EngineErrorCode::Unauthorized);

    Ok(())
}

