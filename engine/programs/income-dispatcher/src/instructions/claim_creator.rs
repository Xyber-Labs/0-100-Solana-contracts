use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TransferChecked};

pub fn claim_creator(ctx: Context<ClaimCreator>) -> Result<()> {
    let project_pool = &mut ctx.accounts.project_pool;

    let base_to_claim =
        project_pool.earned_base_by_creator.saturating_sub(project_pool.claimed_base_by_creator);
    let quote_to_claim =
        project_pool.earned_quote_by_creator.saturating_sub(project_pool.claimed_quote_by_creator);

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
                    to: ctx.accounts.creator_base_ata.to_account_info(),
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
                    to: ctx.accounts.creator_quote_ata.to_account_info(),
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
    project_pool.claimed_base_by_creator = project_pool.earned_base_by_creator;
    project_pool.claimed_quote_by_creator = project_pool.earned_quote_by_creator;
    project_pool.total_claimed_base = project_pool
        .total_claimed_base
        .checked_add(base_to_claim)
        .ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?;
    project_pool.total_claimed_quote = project_pool
        .total_claimed_quote
        .checked_add(quote_to_claim)
        .ok_or(crate::errors::ErrorCode::ArithmeticOverflow)?;

    Ok(())
}

#[derive(Accounts)]
pub struct ClaimCreator<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut, 
        seeds = [crate::SEED_ROOT, b"project_pool", &project_pool.project_id.to_be_bytes()], 
        bump
    )]
    pub project_pool: Box<Account<'info, crate::state::ProjectPool>>,

    #[account(constraint = launch_state.project_id == project_pool.project_id @ crate::errors::ErrorCode::InvalidProjectId)]
    pub launch_state: Box<Account<'info, engine::state::LaunchState>>,

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
        payer = creator,
        associated_token::mint = base_mint,
        associated_token::authority = creator,
    )]
    pub creator_base_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = creator,
        associated_token::mint = quote_mint,
        associated_token::authority = creator,
    )]
    pub creator_quote_ata: InterfaceAccount<'info, TokenAccount>,

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
