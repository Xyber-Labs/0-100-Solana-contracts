use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount, transfer_checked, TransferChecked},
};

use crate::{
    DISPATCHER_SEED_ROOT,
    errors::ErrorCode,
    income_calculator::Role::Treasure,
    state::{Totals, Config},
};

use super::claim::ClaimEvent;

#[derive(Accounts)]
pub struct ClaimPlatform<'info> {
    #[account(mut, address = config.platform_wallet @ ErrorCode::Unauthorized)]
    pub recipient: Signer<'info>,

    #[account(seeds = [DISPATCHER_SEED_ROOT, b"config"], bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(
        mut,
        seeds = [DISPATCHER_SEED_ROOT, b"totals", &[Treasure as u8], mint.key().as_ref()],
        bump,
    )]
    pub totals: Box<Account<'info, Totals>>,

    /// CHECK: Harvest authority PDA
    #[account(seeds = [DISPATCHER_SEED_ROOT, b"authority"], bump)]
    pub authority: AccountInfo<'info>,

    pub mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = authority,
    )]
    pub source_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = recipient,
        associated_token::mint = mint,
        associated_token::authority = recipient,
    )]
    pub recipient_ata: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn claim_platform(ctx: Context<ClaimPlatform>) -> Result<()> {
    let amount_to_claim = ctx.accounts.totals.available()?;

    if amount_to_claim == 0 {
        return Ok(());
    }

    let authority_seeds = &[
        DISPATCHER_SEED_ROOT,
        b"authority",
        &[ctx.bumps.authority],
    ];
    let signer_seeds = &[&authority_seeds[..]];

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.source_vault.to_account_info(),
                to: ctx.accounts.recipient_ata.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
            },
            signer_seeds,
        ),
        amount_to_claim,
        ctx.accounts.mint.decimals,
    )?;

    ctx.accounts.totals.add_spent(amount_to_claim)?;

    emit!(ClaimEvent {
        project_id: 0,
        role: Treasure,
        mint: ctx.accounts.mint.key(),
        recipient: ctx.accounts.recipient.key(),
        amount: amount_to_claim,
    });

    Ok(())
}
