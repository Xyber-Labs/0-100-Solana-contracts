use anchor_lang::prelude::*;
use crate::{EscrowAccount, LaunchState, SEED_ROOT};

#[derive(Accounts)]
pub struct TopUpFeePayer<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        constraint = launch_state.clmm_pool.is_some() @ crate::errors::ErrorCode::PoolNotCreated,
    )]
    pub launch_state: Account<'info, LaunchState>,

    #[account(mut, seeds = [SEED_ROOT, b"escrow", launch_state.key().as_ref()], bump)]
    pub escrow: Account<'info, EscrowAccount>,

    /// CHECK: Fee payer PDA - system-owned account for paying system operations
    #[account(
        mut,
        seeds = [SEED_ROOT, b"fee_payer", launch_state.key().as_ref()],
        bump,
        constraint = *fee_payer_pda.owner == System::id() @ crate::errors::ErrorCode::InvalidAccountOwner,
        constraint = fee_payer_pda.data_is_empty() @ crate::errors::ErrorCode::AccountHasData
    )]
    pub fee_payer_pda: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn top_up_fee_payer(ctx: Context<TopUpFeePayer>, amount_lamports: u64) -> Result<()> {
    let escrow_info = ctx.accounts.escrow.to_account_info();
    let fee_payer_info = ctx.accounts.fee_payer_pda.to_account_info();

    require!(
        escrow_info.lamports() >= amount_lamports,
        crate::errors::ErrorCode::InsufficientFunds
    );

    // Direct lamport manipulation - no system_instruction::transfer from PDA with data
    **escrow_info.try_borrow_mut_lamports()? -= amount_lamports;
    **fee_payer_info.try_borrow_mut_lamports()? += amount_lamports;

    msg!("[TopUpFeePayer] Transferred {} lamports from escrow to fee_payer_pda", amount_lamports);
    msg!("[TopUpFeePayer] Escrow lamports: {}", escrow_info.lamports());
    msg!("[TopUpFeePayer] Fee payer PDA lamports: {}", fee_payer_info.lamports());

    Ok(())
}
