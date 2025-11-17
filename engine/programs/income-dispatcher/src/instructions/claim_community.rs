use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TransferChecked};

pub fn claim_community(ctx: Context<ClaimCommunity>, base_amount: u64, quote_amount: u64, nonce: u64) -> Result<()> {
    require!(ctx.accounts.nonce.nonce == nonce, crate::errors::ErrorCode::InvalidNonce);
    ctx.accounts.nonce.nonce += 1;

    let project_pool = &mut ctx.accounts.project_pool;

    let available_base = project_pool
        .earned_base_by_community
        .saturating_sub(project_pool.claimed_base_by_community);
    let base_to_claim = available_base.min(base_amount);

    let available_quote = project_pool
        .earned_quote_by_community
        .saturating_sub(project_pool.claimed_quote_by_community);
    let quote_to_claim = available_quote.min(quote_amount);

    let project_authority_seeds = &[
        crate::SEED_ROOT,
        b"project_authority",
        &project_pool.project_id.to_be_bytes(),
        &[ctx.bumps.project_authority],
    ];
    let signers = &[&project_authority_seeds[..]];

    // Transfer base tokens
    if base_to_claim > 0 {
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.base_vault.to_account_info(),
                    to: ctx.accounts.community_base_ata.to_account_info(),
                    authority: ctx.accounts.project_authority.to_account_info(),
                    mint: ctx.accounts.base_mint.to_account_info(),
                },
                signers,
            ),
            base_to_claim,
            project_pool.base_decimals,
        )?;
    }

    // Transfer quote tokens
    if quote_to_claim > 0 {
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.quote_vault.to_account_info(),
                    to: ctx.accounts.community_quote_ata.to_account_info(),
                    authority: ctx.accounts.project_authority.to_account_info(),
                    mint: ctx.accounts.quote_mint.to_account_info(),
                },
                signers,
            ),
            quote_to_claim,
            project_pool.quote_decimals,
        )?;
    }

    // Update claimed amounts
    project_pool.claimed_base_by_community = project_pool
        .claimed_base_by_community
        .checked_add(base_to_claim)
        .ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?;
    project_pool.claimed_quote_by_community = project_pool
        .claimed_quote_by_community
        .checked_add(quote_to_claim)
        .ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?;
    project_pool.total_claimed_base = project_pool
        .total_claimed_base
        .checked_add(base_to_claim)
        .ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?;
    project_pool.total_claimed_quote = project_pool
        .total_claimed_quote
        .checked_add(quote_to_claim)
        .ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?;

    emit!(CommunityClaim {
        user: ctx.accounts.token_recipient.key(),
        base_amount: base_to_claim,
        quote_amount: quote_to_claim,
        project_id: project_pool.project_id,
    });

    Ok(())
}

#[event]
pub struct CommunityClaim {
    pub user: Pubkey,
    pub base_amount: u64,
    pub quote_amount: u64,
    pub project_id: u64,
}

#[derive(Accounts)]
pub struct ClaimCommunity<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [crate::SEED_ROOT, b"config"],
        bump,
    )]
    pub config: Box<Account<'info, crate::state::Config>>,

    /// CHECK: Community claim signer authority (backend wallet)
    #[account(
        constraint = community_claim_signer.key() == config.community_claim_signer @ crate::errors::ErrorCode::InvalidAuthority
    )]
    pub community_claim_signer: Signer<'info>,

    /// Nonce to avoid replay attacks
    #[account(
        mut,
        seeds = [crate::SEED_ROOT, b"nonce", token_recipient.key().as_ref()],
        bump,
    )]
    pub nonce: Box<Account<'info, crate::state::Nonce>>,

    /// CHECK: User wallet
    pub token_recipient: UncheckedAccount<'info>,

    #[account(
        mut, 
        seeds = [crate::SEED_ROOT, b"project_pool", &project_pool.project_id.to_be_bytes()], 
        bump
    )]
    pub project_pool: Box<Account<'info, crate::state::ProjectPool>>,

    /// CHECK: Project authority PDA
    #[account(
        seeds = [crate::SEED_ROOT, b"project_authority", &project_pool.project_id.to_be_bytes()],
        bump,
    )]
    pub project_authority: AccountInfo<'info>,

    #[account(mut)]
    pub base_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub quote_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = base_mint,
        associated_token::authority = token_recipient,
    )]
    pub community_base_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = quote_mint,
        associated_token::authority = token_recipient,
    )]
    pub community_quote_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        constraint = base_mint.key() == project_pool.base_mint @ crate::errors::ErrorCode::InvalidTokenMint
    )]
    pub base_mint: InterfaceAccount<'info, Mint>,

    #[account(
        constraint = quote_mint.key() == project_pool.quote_mint @ crate::errors::ErrorCode::InvalidTokenMint
    )]
    pub quote_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, anchor_spl::token_interface::TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
