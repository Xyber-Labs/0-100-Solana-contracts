use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount, transfer_checked, TransferChecked},
};

use crate::{
    DISPATCHER_SEED_ROOT,
    errors::ErrorCode,
    state::{Config, Nonce, Role, Totals},
};

#[derive(Accounts)]
#[instruction(project_id: u64, role: Role, nonce_value: u64)]
pub struct Claim<'info> {
    #[account(mut)]
    pub recipient: Signer<'info>,

    #[account(seeds = [DISPATCHER_SEED_ROOT, b"config"], bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(
        seeds = [engine::constants::SEED_ROOT, b"launch", &project_id.to_le_bytes()],
        bump,
        seeds::program = engine::ID
    )]
    pub launch_state: Box<Account<'info, engine::state::LaunchState>>,

    #[account(
        mut,
        seeds = [DISPATCHER_SEED_ROOT, b"totals", &project_id.to_be_bytes(), &[role as u8], mint.key().as_ref()],
        bump,
    )]
    pub totals: Box<Account<'info, Totals>>,

    /// CHECK: Harvest authority PDA
    #[account(seeds = [DISPATCHER_SEED_ROOT, b"authority"], bump)]
    pub authority: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = recipient,
        space = 8 + Nonce::INIT_SPACE,
        seeds = [DISPATCHER_SEED_ROOT, b"nonce", &project_id.to_be_bytes(), recipient.key().as_ref()],
        bump,
        constraint = nonce.nonce == nonce_value @ ErrorCode::InvalidNonce
    )]
    pub nonce: Box<Account<'info, Nonce>>,

    #[account(
        constraint = mint.key() == launch_state.base_mint.unwrap()
            || mint.key() == engine::constants::WSOL_MINT @ ErrorCode::InvalidTokenMint
    )]
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

pub fn claim(
    ctx: Context<Claim>,
    project_id: u64,
    role: Role,
    _nonce_value: u64,
    amount: Option<u64>,
) -> Result<()> {
    verify_role_authority(&ctx, role)?;

    ctx.accounts.nonce.nonce =
        ctx.accounts.nonce.nonce.checked_add(1).ok_or(ErrorCode::ArithmeticOverflow)?;

    let available = ctx.accounts.totals.available()?;
    let amount_to_claim = amount.unwrap_or(available).min(available);

    if amount_to_claim == 0 {
        return Ok(());
    }

    let authority_seeds = &[DISPATCHER_SEED_ROOT, b"authority", &[ctx.bumps.authority]];
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
        project_id,
        role,
        mint: ctx.accounts.mint.key(),
        recipient: ctx.accounts.recipient.key(),
        amount: amount_to_claim,
    });

    Ok(())
}

fn verify_role_authority(ctx: &Context<Claim>, role: Role) -> Result<()> {
    match role {
        Role::Creator => {
            require!(
                ctx.accounts.recipient.key() == ctx.accounts.launch_state.creator,
                ErrorCode::Unauthorized
            );
        }
        Role::Community => {
            require!(!ctx.remaining_accounts.is_empty(), ErrorCode::Unauthorized);
            let community_signer = &ctx.remaining_accounts[0];
            require!(community_signer.is_signer, ErrorCode::Unauthorized);
            require!(
                community_signer.key() == ctx.accounts.config.community_wallet,
                ErrorCode::Unauthorized
            );
        }
        _ => return err!(ErrorCode::NotAllowed),
    }
    Ok(())
}

#[event]
pub struct ClaimEvent {
    pub project_id: u64,
    pub role: Role,
    pub mint: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
}
