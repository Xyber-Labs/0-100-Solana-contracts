use anchor_lang::prelude::*;

use crate::{constants::SEED_ROOT, errors::ErrorCode, state::LaunchState, utils::lottery::LotteryRaw};

#[event]
pub struct BitmapsClosed {
    pub launch: Pubkey,
    pub rent_recipient: Pubkey,
    pub lamports_returned: u64,
}

#[derive(Accounts)]
pub struct CloseBitmaps<'info> {
    /// CHECK: Any account can receive the rent
    #[account(mut)]
    pub rent_recipient: UncheckedAccount<'info>,

    #[account(
        constraint = launch_state.is_finalized() @ ErrorCode::NotFinalized,
    )]
    pub launch_state: Account<'info, LaunchState>,

    /// CHECK: Raw winners bitmap - validated by seeds
    #[account(
        mut,
        seeds = [SEED_ROOT, b"winners_bitmap", launch_state.key().as_ref()],
        bump,
        constraint = is_bitmap_empty(&winners_bitmap) @ ErrorCode::ClaimsNotComplete,
    )]
    pub winners_bitmap: UncheckedAccount<'info>,

    /// CHECK: Raw inactive bitmap - validated by seeds
    #[account(
        mut,
        seeds = [SEED_ROOT, b"inactive_bitmap", launch_state.key().as_ref()],
        bump,
    )]
    pub inactive_bitmap: UncheckedAccount<'info>,
}

fn is_bitmap_empty(account: &UncheckedAccount) -> bool {
    let data = match account.try_borrow_data() {
        Ok(d) => d,
        Err(_) => return false,
    };

    LotteryRaw::<(), (), ()>::is_bitmap_empty(&data)
}

pub fn close_bitmaps(ctx: Context<CloseBitmaps>) -> Result<()> {
    let launch_key = ctx.accounts.launch_state.key();
    let rent_recipient_key = ctx.accounts.rent_recipient.key();

    let winners_lamports = close_account(
        &ctx.accounts.winners_bitmap,
        &ctx.accounts.rent_recipient,
    )?;

    let inactive_lamports = close_account(
        &ctx.accounts.inactive_bitmap,
        &ctx.accounts.rent_recipient,
    )?;

    emit!(BitmapsClosed {
        launch: launch_key,
        rent_recipient: rent_recipient_key,
        lamports_returned: winners_lamports.checked_add(inactive_lamports)
            .ok_or(ErrorCode::ArithmeticOverflow)?,
    });

    Ok(())
}

fn close_account<'info>(
    account: &UncheckedAccount<'info>,
    recipient: &UncheckedAccount<'info>,
) -> Result<u64> {
    let lamports = account.lamports();
    if lamports == 0 {
        return Ok(0);
    }

    // Zero out the data first (before modifying lamports)
    let mut data = account.try_borrow_mut_data()?;
    data.fill(0);
    drop(data);

    // Use checked_sub pattern (same as deposit.rs) instead of direct assignment
    **account.try_borrow_mut_lamports()? = account
        .lamports()
        .checked_sub(lamports)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    **recipient.try_borrow_mut_lamports()? = recipient
        .lamports()
        .checked_add(lamports)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    Ok(lamports)
}
