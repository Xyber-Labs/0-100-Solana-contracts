use anchor_lang::{
    prelude::*,
    solana_program::sysvar::{self, clock::Clock, Sysvar},
};

use crate::{
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    state::{LaunchPreset, LaunchState},
    utils::{lottery::LotteryRaw, U256},
};

#[event]
pub struct Finalized {
    pub launch: Pubkey,
    pub k_capacity: u64,
}

#[derive(Accounts)]
pub struct FinalizeLottery<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut, constraint = launch_state.is_seeded() @ EngineErrorCode::SeedMissing)]
    pub launch_state: Account<'info, LaunchState>,

    #[account(address = launch_state.preset @ EngineErrorCode::MalformedPreset)]
    pub launch_preset: Account<'info, LaunchPreset>,

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

    let current_time = Clock::get()?.unix_timestamp;
    let funding_end = launch_state.funding_ended_at().ok_or(EngineErrorCode::InvalidState)?;
    select_blockhash(
        &ctx.accounts.slot_hashes.to_account_info(),
        current_time,
        funding_end,
        launch_preset.pool_creation_grace_period_sec,
        launch_state.project_id,
        launch_preset.unlock_time_sec,
    )?;

    let seed = launch_state.get_seed().ok_or(EngineErrorCode::SeedMissing)?;
    let k_capacity = launch_preset.k_capacity()?;
    let launch_key = launch_state.key();

    let winners_info = ctx.accounts.winners_bitmap.to_account_info();
    let inactive_info = ctx.accounts.inactive_bitmap.to_account_info();
    let mut winners_data = winners_info.try_borrow_mut_data()?;
    let inactive_data = inactive_info.try_borrow_data()?;

    let mut lottery =
        LotteryRaw::new(&mut **launch_state, &mut winners_data[..], &inactive_data[..]);

    lottery.finalize(&seed, k_capacity, launch_preset.sale_allocation(), current_time)?;

    emit!(Finalized {
        launch: launch_key,
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
    let num_partitions = derive_num_partitions_from_unlock(unlock_time_sec);

    for i in 0..hashes_to_check {
        let hash_pos = 8u64
            .checked_add(i.checked_mul(40).ok_or(EngineErrorCode::ArithmeticOverflow)?)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;
        let blockhash_pos = hash_pos.checked_add(8).ok_or(EngineErrorCode::ArithmeticOverflow)?;
        let blockhash_end =
            blockhash_pos.checked_add(32).ok_or(EngineErrorCode::ArithmeticOverflow)?;

        let blockhash_slice = data
            .get(blockhash_pos as usize..blockhash_end as usize)
            .ok_or(EngineErrorCode::InvalidSlotHashesData)?;
        let blockhash: [u8; 32] =
            blockhash_slice.try_into().map_err(|_| EngineErrorCode::InvalidSlotHashesData)?;

        if is_blockhash_in_project_range(&blockhash, project_id, num_partitions) {
            return Ok(());
        }
    }
    err!(EngineErrorCode::NoValidBlockhash)
}

const DEFAULT_N: u64 = 100;

fn is_blockhash_in_project_range(blockhash: &[u8; 32], project_id: u64, num_partitions: u64) -> bool {
    let hash_as_u256 = U256::from_big_endian(blockhash);
    let (range_start, range_end) = calculate_project_range(project_id, num_partitions);

    hash_as_u256 >= range_start && hash_as_u256 < range_end
}

fn calculate_project_range(project_id: u64, num_partitions: u64) -> (U256, U256) {
    if num_partitions == 0 {
        return (U256::zero(), U256::zero());
    }

    let seg = if project_id == 0 {
        0
    } else {
        (project_id - 1) % num_partitions
    };
    let seg_u256 = U256::from(seg);
    let n_u256 = U256::from(num_partitions);

    let width = U256::MAX / n_u256;

    let start = width * seg_u256;
    let end_exclusive = start + width;

    (start, end_exclusive)
}

fn derive_num_partitions_from_unlock(unlock_time_sec: i64) -> u64 {
    if unlock_time_sec <= 0 {
        return DEFAULT_N;
    }
    let seconds = unlock_time_sec as u64;
    let approx_blocks = seconds.saturating_mul(5).saturating_div(2);
    approx_blocks.max(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_derive_num_partitions() {
        let num_partitions = derive_num_partitions_from_unlock(7200);
        assert_eq!(num_partitions, 18000);
    }

    #[test]
    fn test_calculate_project_range() {
        let project_id = 10;
        let num_partitions = 150;
        let (start, end) = calculate_project_range(project_id, num_partitions);

        let width = U256::MAX / U256::from(num_partitions);
        let seg = (project_id - 1) % num_partitions;
        let expected_start = width * U256::from(seg);
        let expected_end = expected_start + width;

        assert_eq!(start, expected_start);
        assert_eq!(end, expected_end);
    }

    #[test]
    fn test_is_blockhash_in_project_range() {
        let project_id = 20;
        let num_partitions = 81000;

        let (start, end) = calculate_project_range(project_id, num_partitions);

        let mut hash_inside_bytes = [0u8; 32];
        start.to_big_endian(&mut hash_inside_bytes);

        let mut hash_outside_bytes = [0u8; 32];
        end.to_big_endian(&mut hash_outside_bytes);

        let mut hash_before_bytes = [0u8; 32];
        if start > U256::zero() {
            (start - U256::one()).to_big_endian(&mut hash_before_bytes);
        }

        assert!(is_blockhash_in_project_range(&hash_inside_bytes, project_id, num_partitions));
        assert!(!is_blockhash_in_project_range(&hash_outside_bytes, project_id, num_partitions));
        if start > U256::zero() {
            assert!(!is_blockhash_in_project_range(&hash_before_bytes, project_id, num_partitions));
        }
    }
}
