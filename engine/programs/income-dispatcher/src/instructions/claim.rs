use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{transfer_checked, Mint, TokenAccount, TransferChecked},
};

use crate::{
    errors::ErrorCode,
    income_calculator::Role,
    state::{Config, IncomeConfig, Nonce},
};

#[derive(Accounts)]
#[instruction(project_id: u64, role: Role, nonce_value: u64)]
pub struct Claim<'info> {
    #[account(mut)]
    pub recipient: Signer<'info>,

    #[account(seeds = [crate::SEED_ROOT, b"config"], bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(
        seeds = [engine::constants::SEED_ROOT, b"launch", &project_id.to_le_bytes()],
        bump,
        seeds::program = engine::ID
    )]
    pub launch_state: Box<Account<'info, engine::state::LaunchState>>,

    #[account(
        mut,
        seeds = [crate::SEED_ROOT, b"income_config", &project_id.to_be_bytes()],
        bump
    )]
    pub income_config: Box<Account<'info, IncomeConfig>>,

    /// CHECK: Project authority PDA
    #[account(seeds = [crate::SEED_ROOT, b"project_authority", &project_id.to_be_bytes()], bump)]
    pub project_authority: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = recipient,
        space = 8 + Nonce::INIT_SPACE,
        seeds = [crate::SEED_ROOT, b"nonce", &project_id.to_be_bytes(), recipient.key().as_ref()],
        bump,
        constraint = nonce.nonce == nonce_value @ ErrorCode::InvalidNonce
    )]
    pub nonce: Box<Account<'info, Nonce>>,

    #[account(
        constraint = Some(base_mint.key()) == launch_state.base_mint @ ErrorCode::InvalidTokenMint
    )]
    pub base_mint: Box<Account<'info, Mint>>,

    #[account(address = engine::constants::WSOL_MINT @ ErrorCode::InvalidTokenMint)]
    pub quote_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = project_authority,
    )]
    pub base_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = quote_mint,
        associated_token::authority = project_authority,
    )]
    pub quote_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = recipient,
        associated_token::mint = base_mint,
        associated_token::authority = recipient,
    )]
    pub recipient_base_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = recipient,
        associated_token::mint = quote_mint,
        associated_token::authority = recipient,
    )]
    pub recipient_quote_ata: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, anchor_spl::token::Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn claim(ctx: Context<Claim>, project_id: u64, role: Role, _nonce_value: u64) -> Result<()> {
    ctx.accounts.nonce.nonce += 1;

    verify_role_authority(&ctx, role)?;

    let income_config = &mut ctx.accounts.income_config;
    let role_idx = role as usize;
    let balance = &mut income_config.balances[role_idx];

    let base_to_claim = balance
        .earned_base
        .checked_sub(balance.claimed_base)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let quote_to_claim = balance
        .earned_quote
        .checked_sub(balance.claimed_quote)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let project_authority_seeds = &[
        crate::SEED_ROOT,
        b"project_authority",
        &project_id.to_be_bytes(),
        &[ctx.bumps.project_authority],
    ];
    let signers = &[&project_authority_seeds[..]];

    if base_to_claim > 0 {
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.base_vault.to_account_info(),
                    to: ctx.accounts.recipient_base_ata.to_account_info(),
                    authority: ctx.accounts.project_authority.to_account_info(),
                    mint: ctx.accounts.base_mint.to_account_info(),
                },
                signers,
            ),
            base_to_claim,
            ctx.accounts.base_mint.decimals,
        )?;
    }

    if quote_to_claim > 0 {
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.quote_vault.to_account_info(),
                    to: ctx.accounts.recipient_quote_ata.to_account_info(),
                    authority: ctx.accounts.project_authority.to_account_info(),
                    mint: ctx.accounts.quote_mint.to_account_info(),
                },
                signers,
            ),
            quote_to_claim,
            ctx.accounts.quote_mint.decimals,
        )?;
    }

    balance.claimed_base = balance.earned_base;
    balance.claimed_quote = balance.earned_quote;

    income_config.total_claimed_base = income_config
        .total_claimed_base
        .checked_add(base_to_claim)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    income_config.total_claimed_quote = income_config
        .total_claimed_quote
        .checked_add(quote_to_claim)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    emit!(ClaimEvent {
        project_id,
        role,
        recipient: ctx.accounts.recipient.key(),
        base_amount: base_to_claim,
        quote_amount: quote_to_claim,
    });

    Ok(())
}

fn verify_role_authority(ctx: &Context<Claim>, role: Role) -> Result<()> {
    match role {
        Role::Platform => {
            require!(
                ctx.accounts.recipient.key() == ctx.accounts.config.platform_wallet,
                ErrorCode::InvalidAuthority
            );
        }
        Role::Creator => {
            require!(
                ctx.accounts.recipient.key() == ctx.accounts.launch_state.creator,
                ErrorCode::InvalidAuthority
            );
        }
        Role::Community => {
            require!(!ctx.remaining_accounts.is_empty(), ErrorCode::Unauthorized);
            let community_signer = &ctx.remaining_accounts[0];
            require!(community_signer.is_signer, ErrorCode::Unauthorized);
            require!(
                community_signer.key() == ctx.accounts.config.community_wallet,
                ErrorCode::InvalidAuthority
            );
        }
    }
    Ok(())
}

#[event]
pub struct ClaimEvent {
    pub project_id: u64,
    pub role: Role,
    pub recipient: Pubkey,
    pub base_amount: u64,
    pub quote_amount: u64,
}
