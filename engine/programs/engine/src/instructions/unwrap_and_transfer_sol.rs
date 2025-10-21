use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, CloseAccount, Token},
    token_interface::{Mint as InterfaceMint, TokenAccount, TokenInterface},
};

use crate::{EscrowAccount, LaunchState, SEED_ROOT};

#[derive(Accounts)]
pub struct UnwrapAndTransferSol<'info> {
    #[account(mut)]
    pub payer: Signer<'info>, // fee payer

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
        mut,
        associated_token::mint = quote_mint,
        associated_token::authority = escrow,
        associated_token::token_program = quote_token_program
    )]
    pub wsol_escrow_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: destination system account for returning SOL
    #[account(mut)]
    pub recipient_system: UncheckedAccount<'info>,

    pub quote_token_program: Interface<'info, TokenInterface>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn unwrap_and_transfer_sol(ctx: Context<UnwrapAndTransferSol>, amount: u64) -> Result<()> {
    let launch_key = ctx.accounts.launch_state.key();
    let seeds = &[
        SEED_ROOT,
        b"escrow",
        launch_key.as_ref(),
        &[ctx.bumps.escrow],
    ];
    let seeds_binding = [&seeds[..]];

    // Move amount wSOL from escrow ATA to a temporary native account and immediately close it
    // Simpler approach: create a transient auxiliary ATA owned by escrow, transfer amount into it, then close to recipient
    // But SPL requires closing a native token account, not arbitrary ATA, to send lamports. So use CloseAccount on the main ATA only when closing full balance.
    // For partial amounts, we can transfer amount to a temporary token account, convert it to native by wrapping lamports is not possible; alternative: just transfer amount lamports by closing a freshly created temporary native account. Here we fallback to closing a separate temporary native account by splitting from main if possible is complex.
    // Pragmatic approach: if amount equals entire balance, close main ATA; otherwise error for now.

    // Read balance from interface account
    let current_amount = ctx.accounts.wsol_escrow_ata.amount;
    require!(current_amount >= amount, crate::errors::ErrorCode::ArithmeticOverflow);

    if current_amount == amount {
        // Close escrow WSOL ATA to recipient_system
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.wsol_escrow_ata.to_account_info(),
                destination: ctx.accounts.recipient_system.to_account_info(),
                authority: ctx.accounts.escrow.to_account_info(),
            },
            &seeds_binding,
        ))?;
    } else {
        // For partial unwraps, return an error for now to keep scope minimal
        return err!(crate::errors::ErrorCode::ArithmeticOverflow);
    }

    Ok(())
}


