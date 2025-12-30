use crate::{
    checked_mul,
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    events::SeedSet,
    state::{LaunchPreset, LaunchState},
    utils::lottery::LotteryRaw,
};
use anchor_lang::{
    prelude::*,
    solana_program::{keccak, sysvar},
};

const DISCRIMINATOR_LEN: usize = 8;

#[derive(Accounts)]
pub struct SetSeed<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,
    #[account(address = launch_state.preset @ EngineErrorCode::MalformedPreset)]
    pub launch_preset: Account<'info, LaunchPreset>,
    /// CHECK: Raw lottery data, validated via seeds
    #[account(seeds = [SEED_ROOT, b"lottery", launch_state.key().as_ref()], bump)]
    pub lottery: UncheckedAccount<'info>,
    /// CHECK: The SlotHashes sysvar is a known account, and we check the address.
    #[account(address = sysvar::slot_hashes::ID)]
    pub slot_hashes: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn set_seed(ctx: Context<SetSeed>) -> Result<()> {
    let launch_state = &mut ctx.accounts.launch_state;
    let launch_preset = &ctx.accounts.launch_preset;

    let mut lottery_data = ctx.accounts.lottery.try_borrow_mut_data()?;
    let lottery = LotteryRaw::new(&mut lottery_data[DISCRIMINATOR_LEN..]);

    require!(lottery.is_in_progress(), EngineErrorCode::AlreadyFinalized);

    require!(
        launch_state.is_funding_ended(launch_preset.funding_duration_seconds),
        EngineErrorCode::FundingNotEnded
    );

    let total_deposited = checked_mul!(lottery.active_tickets(), launch_preset.tau_lamports)?;
    require!(
        total_deposited >= launch_preset.min_raise_lamports,
        EngineErrorCode::MinRaiseNotMet
    );

    require!(launch_state.vrf_seed.is_none(), crate::errors::ErrorCode::SeedAlreadySet);

    let slot_hashes = &ctx.accounts.slot_hashes;
    let data = slot_hashes.try_borrow_data()?;

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

    let last_hash_pos = 8u64
        .checked_add(offset)
        .ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?
        .checked_add(8)
        .ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?;

    let start = last_hash_pos as usize;
    let end =
        last_hash_pos.checked_add(32).ok_or(crate::errors::ErrorCode::ArithmeticOverflow)? as usize;

    let seed: [u8; 32] =
        data[start..end].try_into().map_err(|_| crate::errors::ErrorCode::InvalidSlotHashesData)?;

    launch_state.vrf_seed = Some(seed);

    let seed_hash = keccak::hash(&seed);

    emit!(SeedSet {
        launch: ctx.accounts.launch_state.key(),
        seed_hash: seed_hash.0,
    });

    Ok(())
}
