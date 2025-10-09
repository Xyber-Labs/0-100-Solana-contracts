use anchor_lang::prelude::*;
use crate::Roster;
use crate::errors::ErrorCode;

/// Append or increment user's count; realloc roster if needed (MVP simplistic).
pub fn roster_add_or_incr(
    roster: &mut Account<Roster>,
    wallet: Pubkey,
    delta: u32,
    _payer: &Signer,
    _system_program: &Program<System>,
) -> Result<()> {
    if let Some(pos) = roster.wallets.iter().position(|w| *w == wallet) {
        roster.counts[pos] = roster.counts[pos].checked_add(delta)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        return Ok(());
    }
    // append new
    roster.wallets.push(wallet);
    roster.counts.push(delta);
    Ok(())
}

pub fn roster_decr(roster: &mut Account<Roster>, wallet: Pubkey, lost: u32) -> Result<()> {
    if lost == 0 {
        return Ok(());
    }
    if let Some(pos) = roster.wallets.iter().position(|w| *w == wallet) {
        roster.counts[pos] = roster.counts[pos].checked_sub(lost)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        Ok(())
    } else {
        err!(ErrorCode::UserNotFoundInRoster)
    }
}

pub fn roster_build_prefix(roster: &mut Account<Roster>) -> Result<()> {
    let mut run = 0u32;
    roster.prefix.clear();
    let counts = roster.counts.clone();
    roster.prefix.reserve(counts.len());
    for &c in counts.iter() {
        roster.prefix.push(run);
        run = run.checked_add(c)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
    }
    roster.total_in_shard = run;
    Ok(())
}
