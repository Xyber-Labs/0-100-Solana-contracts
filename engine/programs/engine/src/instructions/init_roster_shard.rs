use anchor_lang::prelude::*;

use crate::{
    constants::SEED_ROOT,
    events::RosterShardInitialized,
    state::{LaunchState, RosterShard},
};

#[derive(Accounts)]
#[instruction(shard_id: u16)]
pub struct InitRosterShard<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        constraint = launch_state.to_account_info().owner == &crate::ID @ crate::errors::ErrorCode::InvalidAuthority
    )]
    pub launch_state: Account<'info, LaunchState>,
    #[account(
        init,
        payer = payer,
        space = 8 // discriminator
                + 32 // launch
                + 2 // shard_id
                + 4 // wallets vec length
                + 4 // counts vec length
                + 4 // prefix vec length
                + 4 // total_in_shard
                + 4 // shard_base
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
    require!(shard_id < launch_state.roster_shards, crate::errors::ErrorCode::ShardIdOutOfRange);
    shard.launch = launch_state.key();
    shard.shard_id = shard_id;
    shard.total_in_shard = 0;
    shard.shard_base = 0;

    emit!(RosterShardInitialized {
        launch: launch_state.key(),
        shard_id,
    });
    Ok(())
}
