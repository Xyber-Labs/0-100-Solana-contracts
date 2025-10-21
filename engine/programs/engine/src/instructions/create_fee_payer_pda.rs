use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_instruction;
use crate::{LaunchState, SEED_ROOT};

#[derive(Accounts)]
pub struct CreateFeePayerPda<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        constraint = launch_state.clmm_pool.is_some() @ crate::errors::ErrorCode::PoolNotCreated,
    )]
    pub launch_state: Account<'info, LaunchState>,

    #[account(mut, seeds = [SEED_ROOT, b"escrow", launch_state.key().as_ref()], bump)]
    pub escrow: Account<'info, crate::EscrowAccount>,

    /// CHECK: Fee payer PDA - will be created as system account
    #[account(
        mut,
        seeds = [SEED_ROOT, b"fee_payer", launch_state.key().as_ref()],
        bump
    )]
    pub fee_payer_pda: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn create_fee_payer_pda(ctx: Context<CreateFeePayerPda>, lamports: u64) -> Result<()> {
    let launch = ctx.accounts.launch_state.key();
    let (fee_payer_key, bump) = Pubkey::find_program_address(
        &[SEED_ROOT, b"fee_payer", launch.as_ref()],
        ctx.program_id,
    );
    require_keys_eq!(fee_payer_key, ctx.accounts.fee_payer_pda.key(), crate::errors::ErrorCode::InvalidSeeds);

    // Check if account already exists and is not system-owned
    if ctx.accounts.fee_payer_pda.owner != &System::id() || !ctx.accounts.fee_payer_pda.data_is_empty() {
        return Err(crate::errors::ErrorCode::InvalidAccountOwner.into());
    }

    // Create system account with zero space
    let ix = system_instruction::create_account(
        &ctx.accounts.payer.key(),
        &ctx.accounts.fee_payer_pda.key(),
        lamports, // initial lamports
        0,        // space = 0 for system account
        &System::id(),
    );
    
    anchor_lang::solana_program::program::invoke_signed(
        &ix,
        &[
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.fee_payer_pda.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        &[&[SEED_ROOT, b"fee_payer", launch.as_ref(), &[bump]]],
    )?;

    msg!("[CreateFeePayerPda] Created fee payer PDA: {}", ctx.accounts.fee_payer_pda.key());
    msg!("[CreateFeePayerPda] Owner: {}", ctx.accounts.fee_payer_pda.owner);
    msg!("[CreateFeePayerPda] Data length: {}", ctx.accounts.fee_payer_pda.data_len());
    
    Ok(())
}
