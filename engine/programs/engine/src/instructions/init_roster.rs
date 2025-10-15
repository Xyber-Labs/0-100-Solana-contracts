use crate::constants::SEED_ROOT;
use crate::events::RosterInitialized;
use crate::state::{LaunchState, Roster};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct InitRoster<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,

    #[account(
        init,
        payer = payer,
        space = 8 + Roster::INIT_SPACE,
        seeds = [SEED_ROOT, b"roster", launch_state.key().as_ref()],
        bump
    )]
    pub roster: Account<'info, Roster>,

    pub system_program: Program<'info, System>,
}

pub fn init_roster(ctx: Context<InitRoster>) -> Result<()> {
    let roster = &mut ctx.accounts.roster;
    roster.launch = ctx.accounts.launch_state.key();
    roster.wallets = Vec::new();
    roster.counts = Vec::new();
    roster.prefix = Vec::new();
    roster.total_in_shard = 0;
    roster.shard_base = 0;

    emit!(RosterInitialized {
        launch: ctx.accounts.launch_state.key(),
    });

    Ok(())
}
