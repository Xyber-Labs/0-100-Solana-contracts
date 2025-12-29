use anchor_lang::{
    prelude::*,
    solana_program::sysvar::{self, clock::Clock, Sysvar},
};

use crate::{
    checked_mul,
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    events::SelectionFinalized,
    state::{LaunchPreset, LaunchState, WithdrawnRanges},
    utils::{lottery::LotteryRaw, pool},
};

const DISCRIMINATOR_LEN: usize = 8;

#[derive(Accounts)]
pub struct CreatePool<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,

    #[account(address = launch_state.preset @ EngineErrorCode::MalformedPreset)]
    pub launch_preset: Account<'info, LaunchPreset>,

    /// CHECK: Raw lottery data, validated via seeds
    #[account(mut, seeds = [SEED_ROOT, b"lottery", launch_state.key().as_ref()], bump)]
    pub lottery: UncheckedAccount<'info>,

    #[account(seeds = [SEED_ROOT, b"withdrawn", launch_state.key().as_ref()], bump)]
    pub withdrawn_ranges: Account<'info, WithdrawnRanges>,

    /// CHECK: The SlotHashes sysvar is a known account, and we check the address.
    #[account(address = sysvar::slot_hashes::ID)]
    pub slot_hashes: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn prepare_pool_creation(ctx: Context<CreatePool>) -> Result<()> {
    let launch_state = &mut ctx.accounts.launch_state;
    let launch_preset = &ctx.accounts.launch_preset;
    let withdrawn = &ctx.accounts.withdrawn_ranges;

    require!(launch_state.vrf_seed.is_some(), EngineErrorCode::SeedMissing);

    let mut lottery_data = ctx.accounts.lottery.try_borrow_mut_data()?;
    let lottery = &mut lottery_data[DISCRIMINATOR_LEN..];

    require!(LotteryRaw::is_in_progress(lottery), EngineErrorCode::AlreadyFinalized);

    let active_tickets = LotteryRaw::active_tickets(lottery);
    let total_deposited = checked_mul!(active_tickets, launch_preset.tau_lamports)?;
    require!(total_deposited >= launch_preset.min_raise_lamports, EngineErrorCode::MinRaiseNotMet);

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

    let seed = launch_state.vrf_seed.ok_or(EngineErrorCode::SeedMissing)?;
    let k_capacity = launch_preset.k_capacity()?;
    LotteryRaw::finalize(lottery, &seed, k_capacity, &withdrawn.ranges, launch_preset.sale_allocation())?;

    launch_state.claims_opened_at = Some(current_time);

    emit!(SelectionFinalized {
        launch: launch_state.key(),
        k_capacity: launch_preset.k_capacity()?,
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
    let num_hashes = u64::from_le_bytes(data[0..8].try_into().unwrap());
    require!(num_hashes > 0, EngineErrorCode::NoRecentBlockhashes);

    if random_pool_creation_expired {
        return Ok(());
    }

    let hashes_to_check = std::cmp::min(512, num_hashes);
    let num_partitions = pool::derive_num_partitions_from_unlock(unlock_time_sec);

    for i in 0..hashes_to_check {
        let hash_pos = 8u64
            .checked_add(i.checked_mul(40).ok_or(EngineErrorCode::ArithmeticOverflow)?)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;
        let blockhash_pos = hash_pos.checked_add(8).ok_or(EngineErrorCode::ArithmeticOverflow)?;

        let blockhash: [u8; 32] = data[blockhash_pos as usize
            ..(blockhash_pos.checked_add(32).ok_or(EngineErrorCode::ArithmeticOverflow)?) as usize]
            .try_into()
            .unwrap();

        if pool::is_blockhash_in_project_range(&blockhash, project_id, num_partitions) {
            return Ok(());
        }
    }
    err!(EngineErrorCode::NoValidBlockhash)
}
