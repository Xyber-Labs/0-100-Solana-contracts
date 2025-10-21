use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke_signed, system_instruction};
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{spl_token, Token},
    token_interface::{Mint as InterfaceMint, TokenAccount, TokenInterface},
};

use crate::{EscrowAccount, LaunchState, SEED_ROOT};

#[derive(Accounts)]
pub struct WrapEscrowWsol<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,

    #[account(mut, seeds = [SEED_ROOT, b"escrow", launch_state.key().as_ref()], bump)]
    pub escrow: Account<'info, EscrowAccount>,

    #[account(
        mint::token_program = quote_token_program,
        address = anchor_lang::solana_program::pubkey!("So11111111111111111111111111111111111111112")
    )]
    pub quote_mint: Box<InterfaceAccount<'info, InterfaceMint>>, // wSOL mint

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = quote_mint,
        associated_token::authority = escrow,
        associated_token::token_program = quote_token_program
    )]
    pub wsol_escrow_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [SEED_ROOT, b"fee_payer", launch_state.key().as_ref()],
        bump,
        constraint = *fee_payer_pda.owner == System::id() @ crate::errors::ErrorCode::InvalidAccountOwner,
        constraint = fee_payer_pda.data_is_empty() @ crate::errors::ErrorCode::AccountHasData
    )]
    /// CHECK: system-owned zero-space PDA (donor of SOL)
    pub fee_payer_pda: UncheckedAccount<'info>,

    pub quote_token_program: Interface<'info, TokenInterface>,
    pub base_token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn wrap_escrow_wsol(ctx: Context<WrapEscrowWsol>) -> Result<()> {
    let available = ctx.accounts.fee_payer_pda.to_account_info().lamports();
    let amount = available.saturating_mul(45) / 100; // 45% TODO: take from launch state
    require_gt!(amount, 0);

    // (1) Transfer lamports from fee_payer_pda -> WSOL ATA via SystemProgram::transfer
    let launch_key = ctx.accounts.launch_state.key();
    let seeds = &[
        SEED_ROOT,
        b"fee_payer",
        launch_key.as_ref(),
        &[ctx.bumps.fee_payer_pda],
    ];
    let ix = system_instruction::transfer(
        &ctx.accounts.fee_payer_pda.key(),
        &ctx.accounts.wsol_escrow_ata.key(),
        amount,
    );
    invoke_signed(
        &ix,
        &[
            ctx.accounts.fee_payer_pda.to_account_info(),
            ctx.accounts.wsol_escrow_ata.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        &[seeds],
    )?;

    // (2) Sync WSOL balance
    anchor_lang::solana_program::program::invoke(
        &spl_token::instruction::sync_native(
            &ctx.accounts.quote_token_program.key(),
            &ctx.accounts.wsol_escrow_ata.key(),
        )?,
        &[ctx.accounts.wsol_escrow_ata.to_account_info()],
    )?;

    Ok(())
}


