use anchor_lang::{
    prelude::*,
    solana_program::sysvar::{self, clock::Clock, Sysvar},
};

use crate::{
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    events::SelectionFinalized,
    state::{LaunchPreset, LaunchState},
    utils::{lottery::{LotteryControl, LotteryRaw}, pool},
};

#[derive(Accounts)]
pub struct FinalizeLottery<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,

    #[account(address = launch_state.preset @ EngineErrorCode::MalformedPreset)]
    pub launch_preset: Account<'info, LaunchPreset>,

    #[account(
        mut,
        seeds = [SEED_ROOT, b"lottery_control", launch_state.key().as_ref()],
        bump,
        constraint = lottery_control.is_seeded() @ EngineErrorCode::SeedMissing
    )]
    pub lottery_control: Account<'info, LotteryControl>,

    /// CHECK: Raw winners bitmap, validated via seeds
    #[account(mut, seeds = [SEED_ROOT, b"winners_bitmap", launch_state.key().as_ref()], bump)]
    pub winners_bitmap: UncheckedAccount<'info>,

    /// CHECK: Raw inactive bitmap, validated via seeds
    #[account(seeds = [SEED_ROOT, b"inactive_bitmap", launch_state.key().as_ref()], bump)]
    pub inactive_bitmap: UncheckedAccount<'info>,

    /// CHECK: The SlotHashes sysvar is a known account, and we check the address.
    #[account(address = sysvar::slot_hashes::ID)]
    pub slot_hashes: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn finalize_lottery(ctx: Context<FinalizeLottery>) -> Result<()> {
    let launch_state = &mut ctx.accounts.launch_state;
    let launch_preset = &ctx.accounts.launch_preset;
    let lottery_control = &mut ctx.accounts.lottery_control;

    let current_time = Clock::get()?.unix_timestamp;
    let funding_end = launch_state
        .funding_end(launch_preset.funding_duration_seconds)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
    select_blockhash(
        &ctx.accounts.slot_hashes.to_account_info(),
        current_time,
        funding_end,
        launch_preset.pool_creation_grace_period_sec,
        launch_state.project_id,
        launch_preset.unlock_time_sec,
    )?;

    let seed = lottery_control.get_seed().ok_or(EngineErrorCode::SeedMissing)?;
    let k_capacity = launch_preset.k_capacity()?;

    let winners_info = ctx.accounts.winners_bitmap.to_account_info();
    let inactive_info = ctx.accounts.inactive_bitmap.to_account_info();
    let mut winners_data = winners_info.try_borrow_mut_data()?;
    let inactive_data = inactive_info.try_borrow_data()?;

    let mut lottery = LotteryRaw::new(
        &mut **lottery_control,
        &mut winners_data[..],
        &inactive_data[..],
    );

    lottery.finalize(&seed, k_capacity, launch_preset.sale_allocation())?;

    launch_state.claims_opened_at = Some(current_time);

    emit!(SelectionFinalized {
        launch: launch_state.key(),
        k_capacity,
    });

    Ok(())
}

fn select_blockhash(
    slot_hashes: &AccountInfo,
    current_time: i64,
    funding_end: i64,
    pool_creation_grace_period_sec: i64,
    project_id: u64,
    unlock_time_sec: i64,
) -> Result<()> {
    let effective_end = funding_end
        .checked_add(pool_creation_grace_period_sec)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
    let random_pool_creation_expired = current_time >= effective_end;

    let data = slot_hashes.try_borrow_data()?;

    let num_hashes_bytes: [u8; 8] = data
        .get(0..8)
        .ok_or(EngineErrorCode::InvalidSlotHashesData)?
        .try_into()
        .map_err(|_| EngineErrorCode::InvalidSlotHashesData)?;
    let num_hashes = u64::from_le_bytes(num_hashes_bytes);

    require!(num_hashes > 0, EngineErrorCode::NoRecentBlockhashes);

    if random_pool_creation_expired {
        return Ok(());
    }

    const MAX_ENTRIES: u64 = 512; // SlotHashes::MAX_ENTRIES
    let hashes_to_check = std::cmp::min(MAX_ENTRIES, num_hashes);
    let num_partitions = pool::derive_num_partitions_from_unlock(unlock_time_sec);

    for i in 0..hashes_to_check {
        let hash_pos = 8u64
            .checked_add(i.checked_mul(40).ok_or(EngineErrorCode::ArithmeticOverflow)?)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;
        let blockhash_pos = hash_pos.checked_add(8).ok_or(EngineErrorCode::ArithmeticOverflow)?;
        let blockhash_end = blockhash_pos.checked_add(32).ok_or(EngineErrorCode::ArithmeticOverflow)?;

        let blockhash_slice = data
            .get(blockhash_pos as usize..blockhash_end as usize)
            .ok_or(EngineErrorCode::InvalidSlotHashesData)?;
        let blockhash: [u8; 32] = blockhash_slice
            .try_into()
            .map_err(|_| EngineErrorCode::InvalidSlotHashesData)?;

        if pool::is_blockhash_in_project_range(&blockhash, project_id, num_partitions) {
            return Ok(());
        }
    }
    err!(EngineErrorCode::NoValidBlockhash)
}

