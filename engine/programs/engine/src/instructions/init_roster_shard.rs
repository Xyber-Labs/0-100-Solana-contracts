use crate::{
    constants::SEED_ROOT,
    events::RosterShardInitialized,
    state::{LaunchState, RosterShard},
};
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
        space = 8 // discriminator
                + 32 // launch
                + 2 // shard_id
                + 32 // created_by
                + 4 // wallets vec length
                + 4 // counts vec length
                + 4 // prefix vec length
                + 4 // total_in_shard
                + 4 // shard_base
                + 4 // sealed_count
                + (32 * launch_state.roster_shard_cap as usize) // wallets
                + (4 * launch_state.roster_shard_cap as usize) // counts
                + (4 * launch_state.roster_shard_cap as usize), // prefix
        seeds = [SEED_ROOT, b"roster_shard", launch_state.key().as_ref(), &shard_id.to_le_bytes()],
        bump,
    )]
    pub roster_shard: Account<'info, RosterShard>,
    pub system_program: Program<'info, System>,
}

pub fn init_roster_shard(ctx: Context<InitRosterShard>, shard_id: u16) -> Result<()> {
    let launch_state = &mut ctx.accounts.launch_state;
    let shard = &mut ctx.accounts.roster_shard;
    // Require 1-based strict sequential initialization
    require!(
        shard_id >= 1 && shard_id <= launch_state.roster_shards,
        crate::errors::ErrorCode::ShardIdOutOfRange
    );
    require!(
        shard_id as i32 == launch_state.roster_initialized_up_to.checked_add(1).ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?,
        crate::errors::ErrorCode::InvalidInitOrder
    );
    shard.launch = launch_state.key();
    shard.shard_id = shard_id;
    shard.created_by = ctx.accounts.payer.key();
    shard.total_in_shard = 0;
    shard.shard_base = 0;
    shard.sealed_count = 0;
    launch_state.roster_initialized_up_to = shard_id as i32;

    emit!(RosterShardInitialized {
        launch: launch_state.key(),
        shard_id,
    });
    Ok(())
}
