use anchor_lang::{
    prelude::*,
    solana_program::{
        keccak,
        sysvar::{self, clock::Clock, Sysvar},
    },
};

use crate::{events::SeedSet, state::LaunchState};

#[derive(Accounts)]
pub struct SetSeed<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        constraint = launch_state.to_account_info().owner == &crate::ID @ crate::errors::ErrorCode::InvalidAuthority
    )]
    pub launch_state: Account<'info, LaunchState>,
    /// CHECK: The SlotHashes sysvar is a known account, and we check the address.
    #[account(address = sysvar::slot_hashes::ID)]
    pub slot_hashes: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn set_seed(ctx: Context<SetSeed>) -> Result<()> {
    let launch_state = &mut ctx.accounts.launch_state;

    // Check if funding period has ended
    let current_time = Clock::get()?.unix_timestamp;
    require!(
        current_time >= launch_state.funding_period_end,
        crate::errors::ErrorCode::FundingPeriodNotEnded
    );
    require!(
        launch_state.total_deposited >= launch_state.min_raise_lamports,
        crate::errors::ErrorCode::MinRaiseNotMet
    );

    require!(launch_state.vrf_seed.is_none(), crate::errors::ErrorCode::SeedAlreadySet);

    // Get the most recent blockhash from the SlotHashes sysvar
    let slot_hashes = &ctx.accounts.slot_hashes;
    let data = slot_hashes.try_borrow_data()?;

    // The first 8 bytes are the number of hashes, then it's a list of (slot, hash)
    // We take the most recent one.
    let num_hashes = u64::from_le_bytes(
        data[0..8].try_into().map_err(|_| crate::errors::ErrorCode::InvalidSlotHashesData)?,
    );
    require!(num_hashes > 0, crate::errors::ErrorCode::NoRecentBlockhashes);

    let num_hashes_u64 = num_hashes;
    let one = 1_u64;
    let forty = 40_u64;

    let num_hashes_minus_1 =
        num_hashes_u64.checked_sub(one).ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?;
    let offset = num_hashes_minus_1
        .checked_mul(forty)
        .ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?;

    // Position of the last hash: 8 bytes for num_hashes + (num_hashes - 1) * 40 bytes per entry
    let last_hash_pos = 8u64
        .checked_add(offset)
        .ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?
        .checked_add(8)
        .ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?; // 8 for slot

    let start = last_hash_pos as usize;
    let end =
        last_hash_pos.checked_add(32).ok_or(crate::errors::ErrorCode::ArithmeticOverflow)? as usize;

    let seed: [u8; 32] =
        data[start..end].try_into().map_err(|_| crate::errors::ErrorCode::InvalidSlotHashesData)?;

    launch_state.vrf_seed = Some(seed);

    // Hash the seed for security (don't expose raw seed)
    let seed_hash = keccak::hash(&seed);

    emit!(SeedSet {
        launch: ctx.accounts.launch_state.key(),
        seed_hash: seed_hash.0,
    });

    Ok(())
}
