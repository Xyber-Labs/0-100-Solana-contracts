#![allow(dead_code)]
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, MintTo, Token},
};

use crate::{errors::ErrorCode, LaunchState, SEED_ROOT};

// Base mint supply is unified with sale mint; minted amount comes from state.sale_allocation + state.lp_allocation

#[derive(Accounts)]
pub struct MintForTest<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        constraint = launch_state.clmm_base_mint.is_none() @ crate::errors::ErrorCode::PoolAlreadyCreated
    )]
    pub launch_state: Account<'info, LaunchState>,

    /// CHECK: Escrow authority PDA without data for token ownership
    #[account(seeds = [SEED_ROOT, b"escrow_authority", launch_state.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub base_mint: Box<Account<'info, Mint>>,

    /// CHECK: Escrow ATA for base token (ATA of escrow_authority for base_mint)
    #[account(
        mut,
        seeds = [escrow_authority.key().as_ref(), base_token_program.key().as_ref(), base_mint.key().as_ref()],
        seeds::program = associated_token_program.key(),
        bump
    )]
    pub base_escrow_ata: UncheckedAccount<'info>,
    pub base_token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn mint_for_test(ctx: Context<MintForTest>) -> Result<()> {
    require!(ctx.accounts.launch_state.selection_finalized, ErrorCode::NotFinalized);
    require!(
        ctx.accounts.launch_state.total_deposited >= ctx.accounts.launch_state.min_raise_lamports,
        ErrorCode::MinRaiseNotMet
    );
    require!(
        ctx.accounts.launch_state.roster_shards > 0
            && ctx.accounts.launch_state.roster_finalized_up_to + 1
                == ctx.accounts.launch_state.roster_shards as i32,
        ErrorCode::ShardsNotFullyFinalized
    );

    create_base_escrow_ata(&ctx)?;
    mint_sale_tokens_to_escrow(&ctx)?;
    ctx.accounts.launch_state.base_mint = Some(ctx.accounts.base_mint.key());
    ctx.accounts.launch_state.clmm_base_mint = Some(ctx.accounts.base_mint.key());
    Ok(())
}

fn create_base_escrow_ata(ctx: &Context<MintForTest>) -> Result<()> {
    anchor_spl::associated_token::create(CpiContext::new(
        ctx.accounts.associated_token_program.to_account_info(),
        anchor_spl::associated_token::Create {
            payer: ctx.accounts.payer.to_account_info(),
            associated_token: ctx.accounts.base_escrow_ata.to_account_info(),
            authority: ctx.accounts.escrow_authority.to_account_info(),
            mint: ctx.accounts.base_mint.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.base_token_program.to_account_info(),
        },
    ))?;

    Ok(())
}

fn mint_sale_tokens_to_escrow(ctx: &Context<MintForTest>) -> Result<()> {
    let to_mint = ctx.accounts.launch_state.base_total_allocation;

    // signer is escrow_authority PDA [SEED_ROOT, "escrow_authority", launch]
    let seeds: &[&[u8]] = &[
        SEED_ROOT,
        b"escrow_authority",
        &ctx.accounts.launch_state.key().to_bytes(),
        &[LaunchState::mint_auth_bump_for(
            &ctx.accounts.launch_state.key(),
        )],
    ];
    let signer_seeds = &[seeds];
    let mint_accounts = MintTo {
        mint: ctx.accounts.base_mint.to_account_info(),
        to: ctx.accounts.base_escrow_ata.to_account_info(),
        authority: ctx.accounts.escrow_authority.to_account_info(),
    };
    let mint_ctx = CpiContext::new_with_signer(
        ctx.accounts.base_token_program.to_account_info(),
        mint_accounts,
        signer_seeds,
    );
    token::mint_to(mint_ctx, to_mint)?;

    Ok(())
}
