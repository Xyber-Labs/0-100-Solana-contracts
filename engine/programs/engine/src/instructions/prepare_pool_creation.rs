use anchor_lang::{
    prelude::*,
    solana_program::sysvar::{self, clock::Clock, Sysvar},
};

use crate::{
    checked_mul,
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    events::{PoolCreated, SelectionFinalized},
    state::{CreatorGrant, LaunchPreset, LaunchState, PoolState, WithdrawnRanges},
    utils::{bitmap::TicketBitmap, lottery, pool},
};

#[derive(Accounts)]
pub struct CreatePool<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,

    #[account(address = launch_state.preset @ EngineErrorCode::MalformedPreset)]
    pub launch_preset: Account<'info, LaunchPreset>,

    #[account(mut, seeds = [SEED_ROOT, b"bitmap", launch_state.key().as_ref()], bump)]
    pub launch_bitmap: Account<'info, TicketBitmap>,

    #[account(seeds = [SEED_ROOT, b"withdrawn", launch_state.key().as_ref()], bump)]
    pub withdrawn_ranges: Account<'info, WithdrawnRanges>,

    #[account(
        mut,
        seeds = [SEED_ROOT, b"creator", launch_state.key().as_ref()],
        bump,
    )]
    pub creator_grant: Account<'info, CreatorGrant>,

    #[account(
        init,
        payer = payer,
        space = 8 + PoolState::INIT_SPACE,
        seeds = [SEED_ROOT, b"pool", launch_state.key().as_ref()],
        bump
    )]
    pub pool_state: Account<'info, PoolState>,

    /// CHECK: The SlotHashes sysvar is a known account, and we check the address.
    #[account(address = sysvar::slot_hashes::ID)]
    pub slot_hashes: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn prepare_pool_creation(ctx: Context<CreatePool>) -> Result<()> {
    let launch_state = &mut ctx.accounts.launch_state;
    let launch_preset = &ctx.accounts.launch_preset;
    let pool_state = &mut ctx.accounts.pool_state;
    let bitmap = &mut ctx.accounts.launch_bitmap;
    let withdrawn = &ctx.accounts.withdrawn_ranges;

    require!(launch_state.vrf_seed.is_some(), EngineErrorCode::SeedMissing);

    let active_tickets = bitmap.bits_allocated - withdrawn.total_withdrawn();
    let total_deposited = checked_mul!(active_tickets as u64, launch_preset.tau_lamports)?;
    require!(
        total_deposited >= launch_preset.min_raise_lamports,
        EngineErrorCode::MinRaiseNotMet
    );
    require!(!pool_state.created, EngineErrorCode::PoolAlreadyCreated);

    let current_time = Clock::get()?.unix_timestamp;
    let funding_end = launch_state
        .funding_end(launch_preset.funding_duration_seconds)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
    let (valid_slot, valid_hash) = select_blockhash(
        &ctx.accounts.slot_hashes.to_account_info(),
        current_time,
        funding_end,
        launch_preset.pool_creation_grace_period_sec,
        launch_state.project_id,
        launch_preset.unlock_time_sec,
    )?;

    pool_state.launch = launch_state.key();
    pool_state.pool_id = launch_state.project_id;
    pool_state.project_id = launch_state.project_id;
    pool_state.created_slot = valid_slot;
    pool_state.created_blockhash = valid_hash;
    pool_state.created = true;

    let seed = launch_state.vrf_seed.ok_or(EngineErrorCode::SeedMissing)?;
    let k_capacity = launch_preset.k_capacity()?;
    lottery::conduct_lottery(&seed, k_capacity, bitmap, &withdrawn.ranges)?;

    finalize_selection(launch_state, launch_preset, &mut ctx.accounts.creator_grant, active_tickets)?;

    launch_state.claims_opened_at = Some(current_time);

    #[cfg(feature = "test")]
    {
        ctx.accounts.pool_state.claims_ready = true;
    }

    emit!(SelectionFinalized {
        launch: launch_state.key(),
        k_capacity: launch_preset.k_capacity()?,
    });

    emit!(PoolCreated {
        launch: launch_state.key(),
        pool_id: launch_state.project_id,
        project_id: launch_state.project_id,
        blockhash: valid_hash,
        slot: valid_slot,
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
) -> Result<(u64, [u8; 32])> {
    let effective_end = funding_end
        .checked_add(pool_creation_grace_period_sec)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
    let random_pool_creation_expired =
        cfg!(feature = "anchor-test") || current_time >= effective_end;

    let data = slot_hashes.try_borrow_data()?;
    let num_hashes = u64::from_le_bytes(data[0..8].try_into().unwrap());
    require!(num_hashes > 0, EngineErrorCode::NoRecentBlockhashes);

    if random_pool_creation_expired {
        let slot_pos = 8u64;
        let blockhash_pos = slot_pos.checked_add(8).ok_or(EngineErrorCode::ArithmeticOverflow)?;

        let valid_slot = u64::from_le_bytes(
            data[slot_pos as usize
                ..(slot_pos.checked_add(8).ok_or(EngineErrorCode::ArithmeticOverflow)?) as usize]
                .try_into()
                .unwrap(),
        );
        let valid_hash: [u8; 32] = data[blockhash_pos as usize
            ..(blockhash_pos.checked_add(32).ok_or(EngineErrorCode::ArithmeticOverflow)?) as usize]
            .try_into()
            .unwrap();
        return Ok((valid_slot, valid_hash));
    }

    let hashes_to_check = std::cmp::min(512, num_hashes);
    let num_partitions = pool::derive_num_partitions_from_unlock(unlock_time_sec);

    for i in 0..hashes_to_check {
        let hash_pos = 8u64
            .checked_add(i.checked_mul(40).ok_or(EngineErrorCode::ArithmeticOverflow)?)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;
        let slot_pos = hash_pos;
        let blockhash_pos = hash_pos.checked_add(8).ok_or(EngineErrorCode::ArithmeticOverflow)?;

        let slot = u64::from_le_bytes(
            data[slot_pos as usize
                ..(slot_pos.checked_add(8).ok_or(EngineErrorCode::ArithmeticOverflow)?) as usize]
                .try_into()
                .unwrap(),
        );
        let blockhash: [u8; 32] = data[blockhash_pos as usize
            ..(blockhash_pos.checked_add(32).ok_or(EngineErrorCode::ArithmeticOverflow)?) as usize]
            .try_into()
            .unwrap();

        if pool::is_blockhash_in_project_range(&blockhash, project_id, num_partitions) {
            return Ok((slot, blockhash));
        }
    }
    err!(EngineErrorCode::NoValidBlockhash)
}

fn finalize_selection(
    launch_state: &mut LaunchState,
    launch_preset: &LaunchPreset,
    creator_grant: &mut CreatorGrant,
    active_tickets: u64,
) -> Result<()> {
    let k_capacity = launch_preset.k_capacity()?;

    if launch_state.creator_grant_present {
        require!(launch_preset.hard_cap_lamports > 0, EngineErrorCode::InvalidDivisor);

        let creator_reserved_u128 = (creator_grant.locked_lamports as u128)
            .checked_mul(k_capacity as u128)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?
            .checked_div(launch_preset.hard_cap_lamports as u128)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;
        require!(creator_reserved_u128 <= u64::MAX as u128, EngineErrorCode::U64ConversionOverflow);
        let creator_reserved = creator_reserved_u128 as u64;
        launch_state.creator_reserved_tickets = creator_reserved;
        creator_grant.reserved_tickets = creator_reserved;
    }

    let sale_allocation_u128 = (launch_preset.base_total_allocation as u128)
        .checked_mul(launch_preset.base_sale_basis_points as u128)
        .and_then(|v| v.checked_div(10_000u128))
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;

    let divisor = active_tickets.min(k_capacity);
    require!(divisor > 0, EngineErrorCode::InvalidDivisor);

    let tokens_per_ticket_u128 = sale_allocation_u128
        .checked_div(divisor as u128)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
    require!(tokens_per_ticket_u128 <= u64::MAX as u128, EngineErrorCode::U64ConversionOverflow);
    launch_state.tokens_per_ticket = Some(tokens_per_ticket_u128 as u64);
    launch_state.selection_finalized = true;

    Ok(())
}
