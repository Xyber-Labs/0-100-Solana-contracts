use anchor_lang::prelude::*;

use crate::{
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    state::{LaunchState, RosterShard, UserContribution},
};

#[derive(Accounts)]
#[instruction(shard_id: u16, from: u32, max: u16)]
pub struct SealRosterShard<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,
    #[account(
        mut,
        seeds = [SEED_ROOT, b"roster_shard", launch_state.key().as_ref(), &shard_id.to_le_bytes()],
        bump,
        constraint = roster_shard.launch == launch_state.key()
    )]
    pub roster_shard: Account<'info, RosterShard>,
}

pub fn seal_roster_shard(ctx: Context<SealRosterShard>, shard_id: u16, from: u32, max: u16) -> Result<()> {
    let launch = &ctx.accounts.launch_state;
    let shard = &ctx.accounts.roster_shard;

    // Shard must already be finalized (prefix and shard_base present)
    require!(
        launch.roster_finalized_up_to >= shard_id as i32,
        EngineErrorCode::ShardNotFinalized
    );
    require!(
        shard.wallets.len() == shard.counts.len() && shard.prefix.len() == shard.wallets.len(),
        EngineErrorCode::ShardNotFinalized
    );
    require!(shard.shard_id == shard_id, EngineErrorCode::Unauthorized);

    let start = from as usize;
    let end = (from as usize)
        .saturating_add(max as usize)
        .min(shard.wallets.len());
    let need = end.saturating_sub(start);
    require!(need > 0, EngineErrorCode::NothingToClaim);

    // Expect remaining_accounts submitted in the same order as wallets[start..end]
    require!(
        ctx.remaining_accounts.len() == need,
        EngineErrorCode::MappingError
    );

    for i in start..end {
        let target = &ctx.remaining_accounts[i - start];
        // Validate PDA for the user contribution account
        let wallet = shard.wallets[i];
        let (expected_pda, _bump) = Pubkey::find_program_address(
            &[SEED_ROOT, b"user", launch.key().as_ref(), wallet.as_ref()],
            &crate::ID,
        );
        require_keys_eq!(target.key(), expected_pda, EngineErrorCode::UserNotFoundInRoster);

        // Cast to Account<UserContribution>
        let new_len = 8 + UserContribution::INIT_SPACE;
        if target.data_len() < new_len {
            let rent = Rent::get()?;
            let needed_lamports = rent.minimum_balance(new_len).saturating_sub(target.lamports());
            if needed_lamports > 0 {
                // Directly adjust lamports to top up rent
                **ctx.accounts
                    .payer
                    .to_account_info()
                    .lamports
                    .borrow_mut() = ctx
                    .accounts
                    .payer
                    .to_account_info()
                    .lamports()
                    .saturating_sub(needed_lamports);
                **target.lamports.borrow_mut() =
                    target.lamports().saturating_add(needed_lamports);
            }
            target.realloc(new_len, false)?;
        }

        // Deserialize, update, serialize back
        let data_vec = target.data.borrow().to_vec();
        let mut read_cursor: &[u8] = &data_vec;
        let mut user = UserContribution::try_deserialize(&mut read_cursor)?;

        require!(user.shard_id == shard_id && user.idx_in_shard as usize == i, EngineErrorCode::Unauthorized);

        let base = shard
            .shard_base
            .checked_add(*shard.prefix.get(i).ok_or(EngineErrorCode::MappingError)?)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;
        let cnt = *shard.counts.get(i).ok_or(EngineErrorCode::MappingError)?;
        user.final_t_base = base;
        user.final_ticket_count = cnt;
        user.finalized_snapshot = true;

        let mut write_ref = target.data.borrow_mut();
        let mut write_cursor: &mut [u8] = &mut write_ref;
        user.try_serialize(&mut write_cursor)?;
    }

    Ok(())
}

