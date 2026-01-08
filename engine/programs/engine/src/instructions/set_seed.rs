use anchor_lang::{
    prelude::*,
    solana_program::{keccak, sysvar},
};

use crate::{
    checked_add, checked_mul,
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    state::{LaunchPreset, LaunchState},
    utils::lottery::LotteryControl,
};

#[event]
pub struct Seeded {
    pub launch: Pubkey,
    pub seed_hash: [u8; 32],
}

#[event]
pub struct Cancelled {
    pub launch: Pubkey,
    pub total_deposited: u64,
    pub min_raise: u64,
}

#[derive(Accounts)]
pub struct SetSeed<'info> {
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
        constraint = lottery_control.is_funding() @ EngineErrorCode::AlreadyFinalized,
        constraint = lottery_control.is_funding_ended(launch_preset.funding_duration_seconds, clock.unix_timestamp) @ EngineErrorCode::FundingNotEnded
    )]
    pub lottery_control: Account<'info, LotteryControl>,
    /// CHECK: The SlotHashes sysvar is a known account, and we check the address.
    #[account(address = sysvar::slot_hashes::ID)]
    pub slot_hashes: UncheckedAccount<'info>,
    pub clock: Sysvar<'info, Clock>,
    pub system_program: Program<'info, System>,
}

pub fn set_seed(ctx: Context<SetSeed>) -> Result<()> {
    let launch_state = &ctx.accounts.launch_state;
    let launch_preset = &ctx.accounts.launch_preset;
    let lottery_control = &mut ctx.accounts.lottery_control;

    let total_deposited =
        checked_mul!(lottery_control.active_tickets(), launch_preset.tau_lamports)?;

    if total_deposited < launch_preset.min_raise_lamports {
        lottery_control.set_cancelled();

        emit!(Cancelled {
            launch: launch_state.key(),
            total_deposited,
            min_raise: launch_preset.min_raise_lamports,
        });

        return Ok(());
    }

    let slot_hashes = &ctx.accounts.slot_hashes;
    let data = slot_hashes.try_borrow_data()?;

    let num_hashes = u64::from_le_bytes(
        data.get(0..8)
            .ok_or(EngineErrorCode::InvalidSlotHashesData)?
            .try_into()
            .map_err(|_| EngineErrorCode::InvalidSlotHashesData)?,
    );
    require!(num_hashes > 0, EngineErrorCode::NoRecentBlockhashes);

    const ONE: u64 = 1;
    const FORTY: u64 = 40;

    let num_hashes_minus_1 =
        num_hashes.checked_sub(ONE).ok_or(EngineErrorCode::ArithmeticOverflow)?;

    let offset = checked_mul!(num_hashes_minus_1, FORTY)?;

    let last_hash_pos = 8u64
        .checked_add(offset)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?
        .checked_add(8)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;

    let start = last_hash_pos as usize;
    let end = checked_add!(last_hash_pos, 32)? as usize;

    let slice = data
        .get(start..end)
        .ok_or(EngineErrorCode::InvalidSlotHashesData)?;

    let seed: [u8; 32] = slice
        .try_into()
        .map_err(|_| EngineErrorCode::InvalidSlotHashesData)?;

    let funding_started_at = lottery_control
        .funding_started_at()
        .ok_or(EngineErrorCode::InvalidState)?;
    let funding_ended_at = checked_add!(funding_started_at, launch_preset.funding_duration_seconds)?;

    lottery_control.set_seeded(seed, funding_ended_at);

    let seed_hash = keccak::hash(&seed);

    emit!(Seeded {
        launch: launch_state.key(),
        seed_hash: seed_hash.0,
    });

    Ok(())
}
