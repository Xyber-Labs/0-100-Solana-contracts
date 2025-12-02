use anchor_lang::{
    prelude::*,
    solana_program::{program::invoke, system_instruction},
};

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

pub fn seal_roster_shard<'info>(
    ctx: Context<'_, '_, '_, 'info, SealRosterShard<'info>>,
    shard_id: u16,
    from: u32,
    max: u16,
) -> Result<()> {
    let launch = &ctx.accounts.launch_state;
    let shard = &mut ctx.accounts.roster_shard;

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

    // Enforce sequential sealing without gaps or duplicates
    require!(from as usize == shard.sealed_count as usize, EngineErrorCode::InvalidFinalizeOrder);
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

    let payer_key = ctx.accounts.payer.key();
    let targets = ctx.remaining_accounts.to_vec();

    for (offset, target) in targets.into_iter().enumerate() {
        let i = start + offset;
        let target_key = target.key();
        // Validate PDA for the user contribution account
        let wallet = shard.wallets[i];
        let (expected_pda, _bump) = Pubkey::find_program_address(
            &[SEED_ROOT, b"user", launch.key().as_ref(), wallet.as_ref()],
            &crate::ID,
        );
        require_keys_eq!(target_key, expected_pda, EngineErrorCode::UserNotFoundInRoster);

        // Cast to Account<UserContribution>
        let new_len = 8 + UserContribution::INIT_SPACE;
        if target.data_len() < new_len {
            let rent = Rent::get()?;
            let needed_lamports = rent.minimum_balance(new_len).saturating_sub(target.lamports());
            if needed_lamports > 0 {
                let transfer_ix =
                    system_instruction::transfer(&payer_key, &target_key, needed_lamports);
                let payer_account = ctx.accounts.payer.to_account_info();
                let accounts = [payer_account, target.clone()];
                invoke(&transfer_ix, &accounts)?;
            }
            target.realloc(new_len, false)?;
        }

        // Deserialize, update, serialize back
        let data_vec = target.data.borrow().to_vec();
        let mut read_cursor: &[u8] = &data_vec;
        let mut user = UserContribution::try_deserialize(&mut read_cursor)?;

        require!(user.shard_id == shard_id && user.idx_in_shard as usize == i, EngineErrorCode::Unauthorized);
        require!(!user.finalized_snapshot, EngineErrorCode::AlreadyFinalized);

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

    shard.sealed_count = shard
        .sealed_count
        .checked_add(need as u32)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;

    Ok(())
}

