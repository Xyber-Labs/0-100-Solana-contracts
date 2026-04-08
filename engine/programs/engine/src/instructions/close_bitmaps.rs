use anchor_lang::prelude::*;

use crate::{checked_add, constants::SEED_ROOT, errors::ErrorCode, state::{EngineConfig, LaunchState, LotteryStatus}};

#[event]
pub struct BitmapsClosed {
    pub launch: Pubkey,
    pub rent_recipient: Pubkey,
    pub lamports_returned: u64,
}

#[derive(Accounts)]
pub struct CloseBitmaps<'info> {
    #[account(mut, address = engine_config.multisig @ ErrorCode::Unauthorized)]
    pub multisig: Signer<'info>,

    #[account(seeds = [SEED_ROOT, b"config"], bump)]
    pub engine_config: Account<'info, EngineConfig>,

    /// CHECK: Any account can receive the rent
    #[account(mut)]
    pub rent_recipient: UncheckedAccount<'info>,

    #[account(mut, constraint = launch_state.is_lottery_completed() @ ErrorCode::ClaimsNotComplete)]
    pub launch_state: Account<'info, LaunchState>,

    /// CHECK: Raw winners bitmap - validated by seeds
    #[account(
        mut,
        seeds = [SEED_ROOT, b"winners_bitmap", launch_state.key().as_ref()],
        bump,
    )]
    pub winners_bitmap: UncheckedAccount<'info>,

    /// CHECK: Raw inactive bitmap - validated by seeds
    #[account(mut, seeds = [SEED_ROOT, b"inactive_bitmap", launch_state.key().as_ref()], bump)]
    pub inactive_bitmap: UncheckedAccount<'info>,
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

    ctx.accounts.launch_state.lottery.status = LotteryStatus::Closed;

    emit!(BitmapsClosed {
        launch: launch_key,
        rent_recipient: rent_recipient_key,
        lamports_returned: checked_add!(winners_lamports, inactive_lamports)?,
    });

    Ok(())
}

fn close_account<'info>(
    account: &UncheckedAccount<'info>,
    recipient: &UncheckedAccount<'info>,
) -> Result<u64> {
    let lamports = account.lamports();
    account.sub_lamports(lamports)?;
    recipient.add_lamports(lamports)?;
    Ok(lamports)
}
