use crate::errors::ErrorCode;
use crate::state::Config;
use crate::SEED_ROOT;
use anchor_lang::prelude::*;
use anchor_spl::token::Token;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::TokenInterface;
use engine::cpi as engine_cpi;
use raydium_amm_v3::program::AmmV3;

pub fn claim_clmm_fees_by_admin<'info>(
    ctx: Context<'_, '_, '_, 'info, ClaimClmmFeesByAdmin<'info>>,
) -> Result<()> {
    require!(ctx.accounts.admin.key() == ctx.accounts.config.admin, ErrorCode::Unauthorized);

    let cpi_accounts = engine_cpi::accounts::ClaimClmmFees {
        income_dispatcher_authority: ctx.accounts.income_dispatcher_authority.to_account_info(),
        raydium_program: ctx.accounts.raydium_program.to_account_info(),
        launch_state: ctx.accounts.launch_state.to_account_info(),
        base_mint: ctx.accounts.base_mint.to_account_info(),
        escrow: ctx.accounts.escrow.to_account_info(),
        escrow_authority: ctx.accounts.escrow_authority.to_account_info(),
        position_nft_mint: ctx.accounts.position_nft_mint.to_account_info(),
        position_nft_account: ctx.accounts.position_nft_account.to_account_info(),
        personal_position: ctx.accounts.personal_position.to_account_info(),
        pool_state: ctx.accounts.pool_state.to_account_info(),
        protocol_position: ctx.accounts.protocol_position.to_account_info(),
        token_vault_0: ctx.accounts.token_vault_0.to_account_info(),
        token_vault_1: ctx.accounts.token_vault_1.to_account_info(),
        tick_array_lower: ctx.accounts.tick_array_lower.to_account_info(),
        tick_array_upper: ctx.accounts.tick_array_upper.to_account_info(),
        recipient_token_account_0: ctx.accounts.recipient_token_account_0.to_account_info(),
        recipient_token_account_1: ctx.accounts.recipient_token_account_1.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
        token_program_2022: ctx.accounts.token_program_2022.to_account_info(),
        memo_program: ctx.accounts.memo_program.to_account_info(),
        vault_0_mint: ctx.accounts.vault_0_mint.to_account_info(),
        vault_1_mint: ctx.accounts.vault_1_mint.to_account_info(),
        base_token_program: ctx.accounts.base_token_program.to_account_info(),
        quote_token_program: ctx.accounts.quote_token_program.to_account_info(),
    };

    let income_dispatcher_authority_seeds = &[
        SEED_ROOT,
        b"authority",
        &[ctx.bumps.income_dispatcher_authority],
    ];
    let signers = &[&income_dispatcher_authority_seeds[..]];

    let cpi_context = CpiContext::new_with_signer(
        ctx.accounts.engine_program.to_account_info(),
        cpi_accounts,
        signers,
    )
    .with_remaining_accounts(ctx.remaining_accounts.to_vec());

    engine_cpi::claim_clmm_fees(cpi_context)?;

    Ok(())
}

#[derive(Accounts)]
pub struct ClaimClmmFeesByAdmin<'info> {
    /// Admin signer
    #[account(constraint = admin.key() == config.admin @ ErrorCode::Unauthorized)]
    pub admin: Signer<'info>,

    /// Config account
    #[account(seeds = [SEED_ROOT, b"config"], bump)]
    pub config: Account<'info, Config>,

    /// CHECK: Income dispatcher authority PDA - will be signer for engine call
    #[account(
        seeds = [SEED_ROOT, b"authority"],
        bump,
        seeds::program = crate::ID
    )]
    pub income_dispatcher_authority: UncheckedAccount<'info>,

    /// Engine program
    pub engine_program: Program<'info, engine::program::Engine>,

    /// CHECK: Raydium CLMM program - validated by address in CPI call
    pub raydium_program: Program<'info, AmmV3>,

    /// CHECK: Launch state account from engine program - validated by engine CPI
    #[account(mut)]
    pub launch_state: UncheckedAccount<'info>,

    /// CHECK: Base token mint - validated by engine CPI
    pub base_mint: UncheckedAccount<'info>,

    /// CHECK: Escrow account - validated by engine CPI
    pub escrow: UncheckedAccount<'info>,
    /// CHECK: Escrow authority PDA - validated by engine CPI
    #[account(mut)]
    pub escrow_authority: UncheckedAccount<'info>,

    /// CHECK: Position NFT mint - validated by engine CPI
    #[account(mut)]
    pub position_nft_mint: UncheckedAccount<'info>,
    /// CHECK: Position NFT account - validated by engine CPI
    #[account(mut)]
    pub position_nft_account: UncheckedAccount<'info>,

    /// CHECK: Personal position state - validated by engine CPI
    #[account(mut)]
    pub personal_position: UncheckedAccount<'info>,
    /// CHECK: Pool state - validated by engine CPI
    #[account(mut)]
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: Protocol position state - validated by engine CPI
    #[account(mut)]
    pub protocol_position: UncheckedAccount<'info>,

    /// CHECK: Token vault 0 - validated by engine CPI
    #[account(mut)]
    pub token_vault_0: UncheckedAccount<'info>,
    /// CHECK: Token vault 1 - validated by engine CPI
    #[account(mut)]
    pub token_vault_1: UncheckedAccount<'info>,

    /// CHECK: Lower tick array - validated by engine CPI
    #[account(mut)]
    pub tick_array_lower: UncheckedAccount<'info>,
    /// CHECK: Upper tick array - validated by engine CPI
    #[account(mut)]
    pub tick_array_upper: UncheckedAccount<'info>,

    /// CHECK: Recipient token account for token 0 - validated by engine CPI
    #[account(mut)]
    pub recipient_token_account_0: UncheckedAccount<'info>,
    /// CHECK: Recipient token account for token 1 - validated by engine CPI
    #[account(mut)]
    pub recipient_token_account_1: UncheckedAccount<'info>,

    // Token programs
    pub token_program: Program<'info, Token>,
    pub token_program_2022: Program<'info, Token2022>,
    pub base_token_program: Program<'info, Token>,
    pub quote_token_program: Interface<'info, TokenInterface>,

    /// CHECK: Memo program - validated by address constraint
    #[account(address = anchor_spl::memo::spl_memo::id())]
    pub memo_program: UncheckedAccount<'info>,

    /// CHECK: Vault 0 mint - validated by engine CPI
    pub vault_0_mint: UncheckedAccount<'info>,
    /// CHECK: Vault 1 mint - validated by engine CPI
    pub vault_1_mint: UncheckedAccount<'info>,
}
