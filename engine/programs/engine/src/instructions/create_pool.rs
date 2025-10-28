use crate::{
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    events::{PoolCreated, SelectionFinalized},
    state::{LaunchState, PoolState},
    utils::pool,
};
use anchor_lang::{prelude::*, solana_program::sysvar};

#[derive(Accounts)]
pub struct CreatePool<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,

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

pub fn create_pool(ctx: Context<CreatePool>) -> Result<()> {
    let launch_state = &mut ctx.accounts.launch_state;
    let pool_state = &mut ctx.accounts.pool_state;

    // Preconditions: ready to finalize + enable claims
    require!(launch_state.vrf_seed.is_some(), EngineErrorCode::SeedMissing);
    require!(
        launch_state.total_deposited >= launch_state.min_raise_lamports,
        EngineErrorCode::MinRaiseNotMet
    );
    require!(launch_state.roster_shards > 0, EngineErrorCode::ShardsNotFullyFinalized);
    require!(
        launch_state.roster_finalized_up_to + 1 == launch_state.roster_shards as i32,
        EngineErrorCode::ShardsNotFullyFinalized
    );
    require!(!pool_state.created, EngineErrorCode::PoolAlreadyCreated);

    // Get the SlotHashes sysvar
    let slot_hashes = &ctx.accounts.slot_hashes;
    let data = slot_hashes.try_borrow_data()?;

    // The first 8 bytes are the number of hashes, then it's a list of (slot, hash)
    let num_hashes = u64::from_le_bytes(data[0..8].try_into().unwrap());
    require!(num_hashes > 0, EngineErrorCode::NoRecentBlockhashes);

    let hashes_to_check = std::cmp::min(512, num_hashes);
    let mut found_valid_hash = false;
    let mut valid_slot = 0u64;
    let mut valid_hash = [0u8; 32];

    // The SlotHashes sysvar is a LIFO queue. The most recent hash is at index 0.
    // We iterate forwards, from most recent to oldelaunch_state.
    for i in 0..hashes_to_check {
        // Position is calculated as: 8 bytes (for num_hashes) + i * 40 bytes (size of each SlotHash entry)
        let hash_pos = 8u64
            .checked_add(i.checked_mul(40).ok_or(EngineErrorCode::ArithmeticOverflow)?)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;
        let slot_pos = hash_pos;
        let blockhash_pos = hash_pos.checked_add(8).ok_or(EngineErrorCode::ArithmeticOverflow)?; // 8 bytes for slot

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

        // msg!("Checking slot: {}, blockhash: {:?}", slot, blockhash);

        // Check if this blockhash is within the project's personal range
        if pool::is_blockhash_in_project_range(
            &blockhash,
            launch_state.project_id,
            launch_state.num_partitions,
        ) {
            found_valid_hash = true;
            valid_slot = slot;
            valid_hash = blockhash;
            break;
        }
    }

    require!(found_valid_hash, EngineErrorCode::NoValidBlockhash);
    let (valid_slot, valid_hash) = (valid_slot, valid_hash);

    // Calculate and store the project's range
    let (range_start, range_end) =
        pool::calculate_project_range(launch_state.project_id, launch_state.num_partitions);
    let mut range_start_bytes = [0u8; 32];
    range_start.to_big_endian(&mut range_start_bytes);
    let mut range_end_bytes = [0u8; 32];
    range_end.to_big_endian(&mut range_end_bytes);

    // Initialize pool state
    pool_state.launch = launch_state.key();
    pool_state.pool_id = launch_state.project_id; // Use project_id as pool_id for 1-to-1 mapping
    pool_state.project_id = launch_state.project_id;
    pool_state.created_slot = valid_slot;
    pool_state.created_blockhash = valid_hash;
    pool_state.range_start = range_start_bytes;
    pool_state.range_end = range_end_bytes;
    pool_state.created = true;

    // ---- Selection finalization and opening claims
    if launch_state.creator_grant_present {
        require!(launch_state.hard_cap_lamports > 0, EngineErrorCode::InvalidDivisor);

        let creator_share_ppm = (launch_state.creator_initial_deposit as u128)
            .checked_mul(1_000_000)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?
            .checked_div(launch_state.hard_cap_lamports as u128)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;
        let creator_reserved_u128 = (launch_state.k_capacity as u128)
            .checked_mul(creator_share_ppm)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?
            .checked_div(1_000_000)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;
        require!(
            creator_reserved_u128 <= u32::MAX as u128,
            EngineErrorCode::U64ConversionOverflow
        );
        launch_state.creator_reserved_tickets = creator_reserved_u128 as u32;
    }

    let total_allocation = launch_state.base_total_allocation;
    let sale_bps = launch_state.base_sale_basis_points;
    let sale_allocation = total_allocation
        .checked_mul(sale_bps)
        .and_then(|v| v.checked_div(10_000))
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;

    // tokens_per_ticket
    let grand_total_tickets = (launch_state.public_total_tickets as u64)
        .checked_add(launch_state.creator_reserved_tickets as u64)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
    let divisor = grand_total_tickets.min(launch_state.k_capacity as u64);
    require!(divisor > 0, EngineErrorCode::InvalidDivisor);

    let tokens_per_ticket = (sale_allocation as u128)
        .checked_mul(1_000_000)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?
        .checked_div(divisor as u128)
        .ok_or(EngineErrorCode::ArithmeticOverflow)? as u64;

    launch_state.tokens_per_ticket = Some(tokens_per_ticket);
    launch_state.selection_finalized = true;
    

    emit!(SelectionFinalized {
        launch: launch_state.key(),
        k_capacity: launch_state.k_capacity,
    });
    

    emit!(PoolCreated {
        launch: launch_state.key(),
        pool_id: launch_state.project_id,
        project_id: launch_state.project_id,
        blockhash: valid_hash,
        slot: valid_slot,
        range_start: range_start_bytes,
        range_end: range_end_bytes,
    });

    Ok(())
}
