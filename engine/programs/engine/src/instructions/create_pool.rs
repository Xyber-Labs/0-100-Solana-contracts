use crate::constants::SEED_ROOT;
use crate::errors::ErrorCode as EngineErrorCode;
use crate::events::PoolCreated;
use crate::state::{LaunchState, PoolState};
use crate::utils::pool;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar;

#[derive(Accounts)]
pub struct CreatePool<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

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
    let launch_state = &ctx.accounts.launch_state;
    let pool_state = &mut ctx.accounts.pool_state;

    // Check if selection is finalized and claims are open
    require!(
        launch_state.selection_finalized,
        EngineErrorCode::NotFinalized
    );
    require!(launch_state.claims_open, EngineErrorCode::ClaimsNotOpen);
    require!(!pool_state.created, EngineErrorCode::PoolAlreadyCreated);

    // Get the SlotHashes sysvar
    let slot_hashes = &ctx.accounts.slot_hashes;
    let data = slot_hashes.try_borrow_data()?;

    // The first 8 bytes are the number of hashes, then it's a list of (slot, hash)
    let num_hashes = u64::from_le_bytes(data[0..8].try_into().unwrap());
    require!(num_hashes > 0, EngineErrorCode::NoRecentBlockhashes);

    let hashes_to_check = std::cmp::min(64, num_hashes);
    let mut found_valid_hash = false;
    let mut valid_slot = 0u64;
    let mut valid_hash = [0u8; 32];

    // The SlotHashes sysvar is a LIFO queue. The most recent hash is at index 0.
    // We iterate forwards, from most recent to oldelaunch_state.
    for i in 0..hashes_to_check {
        // Position is calculated as: 8 bytes (for num_hashes) + i * 40 bytes (size of each SlotHash entry)
        let hash_pos = 8u64
            .checked_add(
                i.checked_mul(40)
                    .ok_or(EngineErrorCode::ArithmeticOverflow)?,
            )
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;
        let slot_pos = hash_pos;
        let blockhash_pos = hash_pos
            .checked_add(8)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?; // 8 bytes for slot

        let slot = u64::from_le_bytes(
            data[slot_pos as usize
                ..(slot_pos
                    .checked_add(8)
                    .ok_or(EngineErrorCode::ArithmeticOverflow)?) as usize]
                .try_into()
                .unwrap(),
        );
        let blockhash: [u8; 32] = data[blockhash_pos as usize
            ..(blockhash_pos
                .checked_add(32)
                .ok_or(EngineErrorCode::ArithmeticOverflow)?) as usize]
            .try_into()
            .unwrap();

        // msg!("Checking slot: {}, blockhash: {:?}", slot, blockhash);

        // Check if this blockhash is within the project's personal range
        if pool::is_blockhash_in_project_range(
            &blockhash,
            launch_state.project_id,
            launch_state.num_blocks,
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
        pool::calculate_project_range(launch_state.project_id, launch_state.num_blocks);
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

    // TODO: Add CPI call to Raydium here

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
