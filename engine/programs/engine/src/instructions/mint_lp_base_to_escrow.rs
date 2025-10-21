use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token};

use crate::{errors::ErrorCode, EscrowAccount, LaunchState, SEED_ROOT};

#[derive(Accounts)]
pub struct MintLpBaseToEscrow<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,

    #[account(mut, seeds = [SEED_ROOT, b"escrow", launch_state.key().as_ref()], bump)]
    pub escrow: Account<'info, EscrowAccount>,

    #[account(
        mut,
        address = launch_state.sale_mint @ ErrorCode::InvalidMint,
    )]
    pub sale_mint: Account<'info, Mint>,

    /// CHECK: ATA for sale_mint owned by escrow (already created elsewhere)
    #[account(mut)]
    pub base_escrow_ata: UncheckedAccount<'info>,

    /// CHECK: PDA that is the mint authority of sale_mint
    #[account(seeds = [SEED_ROOT, b"mint_auth", launch_state.key().as_ref()], bump)]
    pub mint_auth: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn mint_lp_base_to_escrow(ctx: Context<MintLpBaseToEscrow>, amount: u64) -> Result<()> {
    // Mint base tokens into escrow's ATA using mint_auth PDA
    let launch_key = ctx.accounts.launch_state.key();
    let bump = ctx.bumps.mint_auth;
    let seeds: &[&[u8]] = &[SEED_ROOT, b"mint_auth", launch_key.as_ref(), &[bump]];
    let signer: &[&[&[u8]]] = &[seeds];

    let cpi_accounts = MintTo {
        mint: ctx.accounts.sale_mint.to_account_info(),
        to: ctx.accounts.base_escrow_ata.to_account_info(),
        authority: ctx.accounts.mint_auth.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer,
    );
    token::mint_to(cpi_ctx, amount)?;
    Ok(())
}


