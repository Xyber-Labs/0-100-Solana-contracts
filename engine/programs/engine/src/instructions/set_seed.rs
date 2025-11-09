use crate::{events::SeedSet, state::LaunchState};
use anchor_lang::{
    prelude::*,
    solana_program::{
        keccak,
        sysvar::{self, clock::Clock, Sysvar},
    },
};

#[derive(Accounts)]
pub struct SetSeed<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,
    #[account(address = sysvar::slot_hashes::ID)]
    /// CHECK: sysvar address checked by constraint
    pub slot_hashes: UncheckedAccount<'info>,
    #[cfg(feature = "vrf")]
    #[account(mut)]
    /// CHECK: passed through to CPI
    pub random: UncheckedAccount<'info>,
    #[cfg(feature = "vrf")]
    #[account(mut)]
    /// CHECK: passed through to CPI
    pub treasury: UncheckedAccount<'info>,
    #[cfg(feature = "vrf")]
    /// CHECK: passed through to CPI
    pub config: UncheckedAccount<'info>,
    #[cfg(feature = "vrf")]
    /// CHECK: VRF program id asserted at runtime
    pub vrf: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

fn parse_recent_blockhash_seed(data: &[u8]) -> Result<[u8; 32]> {
    let num_hashes = u64::from_le_bytes(
        data.get(0..8)
            .ok_or(crate::errors::ErrorCode::InvalidSlotHashesData)?
            .try_into()
            .map_err(|_| crate::errors::ErrorCode::InvalidSlotHashesData)?,
    );
    require!(num_hashes > 0, crate::errors::ErrorCode::NoRecentBlockhashes);
    let num_hashes_minus_1 = num_hashes
        .checked_sub(1)
        .ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?;
    let offset = num_hashes_minus_1
        .checked_mul(40)
        .ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?;
    let last_hash_pos = 8u64
        .checked_add(offset)
        .ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?
        .checked_add(8)
        .ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?;
    let start = last_hash_pos as usize;
    let end = last_hash_pos
        .checked_add(32)
        .ok_or(crate::errors::ErrorCode::ArithmeticOverflow)? as usize;
    let seed: [u8; 32] = data
        .get(start..end)
        .ok_or(crate::errors::ErrorCode::InvalidSlotHashesData)?
        .try_into()
        .map_err(|_| crate::errors::ErrorCode::InvalidSlotHashesData)?;
    Ok(seed)
}

#[cfg(feature = "test")]
fn derive_seed_from_blockhash(slot_hashes: &AccountInfo) -> Result<[u8; 32]> {
    let data = slot_hashes.try_borrow_data()?;
    parse_recent_blockhash_seed(&data)
}

#[cfg(feature = "vrf")]
fn request_vrf_seed_and_enqueue(ctx: &Context<SetSeed>) -> Result<[u8; 32]> {
    require_keys_eq!(
        ctx.accounts.vrf.key(),
        orao_solana_vrf::id(),
        crate::errors::ErrorCode::InvalidSlotHashesData
    );
    let slot_le = Clock::get()?.slot.to_le_bytes();
    let launch_key = ctx.accounts.launch_state.key().to_bytes();
    let seed_hash = keccak::hashv(&[&launch_key, &slot_le]);
    let force: [u8; 32] = seed_hash.0;
    let cpi_program = ctx.accounts.vrf.to_account_info();
    let cpi_accounts = orao_solana_vrf::cpi::accounts::RequestV2 {
        payer: ctx.accounts.payer.to_account_info(),
        network_state: ctx.accounts.config.to_account_info(),
        treasury: ctx.accounts.treasury.to_account_info(),
        request: ctx.accounts.random.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    orao_solana_vrf::cpi::request_v2(cpi_ctx, force)?;
    Ok(force)
}

pub fn set_seed(ctx: Context<SetSeed>) -> Result<()> {
    let launch_state = &mut ctx.accounts.launch_state;
    let launch_key = launch_state.key();

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

    let seed: [u8; 32] = {
        #[cfg(feature = "test")]
        {
            derive_seed_from_blockhash(&ctx.accounts.slot_hashes.to_account_info())?
        }
        #[cfg(all(not(feature = "test"), feature = "vrf"))]
        {
            request_vrf_seed_and_enqueue(&ctx)?
        }
        #[cfg(all(not(feature = "test"), not(feature = "vrf")))]
        {
            keccak::hash(&launch_key.to_bytes()).0
        }
    };

    launch_state.vrf_seed = Some(seed);

    let seed_hash = keccak::hash(&seed);

    emit!(SeedSet {
        launch: ctx.accounts.launch_state.key(),
        seed_hash: seed_hash.0,
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::parse_recent_blockhash_seed;
    use anchor_lang::prelude::Result;

    #[test]
    fn parses_last_hash_as_seed() -> Result<()> {
        let num_hashes: u64 = 2;
        let mut data = Vec::with_capacity(8 + (num_hashes as usize) * 40);
        data.extend_from_slice(&num_hashes.to_le_bytes());
        let slot1: u64 = 123;
        let hash1 = [1u8; 32];
        data.extend_from_slice(&slot1.to_le_bytes());
        data.extend_from_slice(&hash1);
        let slot2: u64 = 124;
        let hash2 = [2u8; 32];
        data.extend_from_slice(&slot2.to_le_bytes());
        data.extend_from_slice(&hash2);
        let seed = parse_recent_blockhash_seed(&data)?;
        assert_eq!(seed, hash2);
        Ok(())
    }
}
