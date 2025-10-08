use crate::LaunchState;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token};
use anchor_spl::associated_token::AssociatedToken;


#[derive(Accounts)]
pub struct CreateClmmPool<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,

    /// CHECK: mint authority PDA
    #[account(seeds = [b"mint_auth", launch_state.key().as_ref()], bump)]
    pub mint_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        mint::decimals = 9,
        mint::authority = mint_authority,
    )]
    pub token_mint: Account<'info, Mint>,

    /// CHECK: ATA for pool tokens. UncheckedAccount used because ATA creation depends on token_mint which is initialized in the same instruction, preventing Anchor's init constraint usage
    #[account(mut)]
    pub pool_token_ata: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}


pub fn create_clmm_pool(ctx: Context<CreateClmmPool>) -> Result<()> {
    let create_ata_ix = anchor_spl::associated_token::spl_associated_token_account::instruction::create_associated_token_account(
        &ctx.accounts.payer.key(),
        &ctx.accounts.payer.key(),
        &ctx.accounts.token_mint.key(),
        &ctx.accounts.token_program.key(),
    );

    anchor_lang::solana_program::program::invoke(
        &create_ata_ix,
        &[
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.pool_token_ata.to_account_info(),
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.token_mint.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.associated_token_program.to_account_info(),
        ],
    )?;

    let total_supply = 1_000_000_000u64;
    let launch_key = ctx.accounts.launch_state.key();
    let seeds = &[b"mint_auth", launch_key.as_ref(), &[ctx.bumps.mint_authority]];
    let signer_seeds = &[&seeds[..]];

    let mint_accounts = MintTo {
        mint: ctx.accounts.token_mint.to_account_info(),
        to: ctx.accounts.pool_token_ata.to_account_info(),
        authority: ctx.accounts.mint_authority.to_account_info(),
    };
    let mint_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        mint_accounts,
        signer_seeds,
    );
    token::mint_to(mint_ctx, total_supply)?;

    Ok(())
}
