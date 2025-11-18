use anchor_lang::prelude::*;
use anchor_spl::{
    token::Token,
    token_2022::Token2022,
    token_interface::{Mint as InterfaceMint, TokenInterface},
};
use raydium_amm_v3::program::AmmV3;

use crate::{
    constants::{INCOME_DISPATCHER_PROGRAM_ID, INCOME_DISPATCHER_SEED_ROOT, SEED_ROOT},
    errors::ErrorCode as EngineErrorCode,
    state::LaunchState,
};

#[derive(Accounts)]
pub struct ClaimClmmFees<'info> {
    /// CHECK: Income dispatcher authority PDA - must be signed by income-dispatcher program
    #[account(
        seeds = [INCOME_DISPATCHER_SEED_ROOT, b"authority"],
        bump,
        seeds::program = INCOME_DISPATCHER_PROGRAM_ID
    )]
    pub income_dispatcher_authority: UncheckedAccount<'info>,

    pub raydium_program: Program<'info, AmmV3>,

    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,

    #[account(
        constraint = launch_state.clmm_base_mint == Some(base_mint.key())
    )]
    pub base_mint: Box<InterfaceAccount<'info, InterfaceMint>>,

    /// CHECK: Escrow authority PDA - owner of the position NFT
    #[account(mut, seeds = [SEED_ROOT, b"escrow_authority", launch_state.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,

    /// CHECK: Position NFT mint (created during liquidity addition)
    #[account(mut)]
    pub position_nft_mint: UncheckedAccount<'info>,

    /// CHECK: Position NFT account owned by escrow_authority
    #[account(mut)]
    pub position_nft_account: UncheckedAccount<'info>,

    /// CHECK: Personal position state
    #[account(mut)]
    pub personal_position: UncheckedAccount<'info>,

    /// CHECK: Pool state
    #[account(mut)]
    pub pool_state: UncheckedAccount<'info>,

    /// CHECK: Protocol position state
    #[account(mut)]
    pub protocol_position: UncheckedAccount<'info>,

    /// CHECK: Token vault 0
    #[account(mut)]
    pub token_vault_0: UncheckedAccount<'info>,

    /// CHECK: Token vault 1
    #[account(mut)]
    pub token_vault_1: UncheckedAccount<'info>,

    /// CHECK: Tick array lower
    #[account(mut)]
    pub tick_array_lower: UncheckedAccount<'info>,

    /// CHECK: Tick array upper
    #[account(mut)]
    pub tick_array_upper: UncheckedAccount<'info>,

    /// CHECK: Recipient token account for token 0 (WSOL)
    #[account(mut)]
    pub recipient_token_account_0: UncheckedAccount<'info>,

    /// CHECK: Recipient token account for token 1 (base token)
    #[account(mut)]
    pub recipient_token_account_1: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub token_program_2022: Program<'info, Token2022>,

    /// CHECK: Memo program
    #[account(address = anchor_spl::memo::spl_memo::id())]
    pub memo_program: UncheckedAccount<'info>,

    /// CHECK: Vault 0 mint
    pub vault_0_mint: UncheckedAccount<'info>,

    /// CHECK: Vault 1 mint
    pub vault_1_mint: UncheckedAccount<'info>,

    pub base_token_program: Program<'info, Token>,
    pub quote_token_program: Program<'info, Token>,
    // Remaining accounts passed to Raydium for tick array bitmap extension
}

pub fn claim_clmm_fees<'info>(ctx: Context<'_, '_, '_, 'info, ClaimClmmFees<'info>>) -> Result<()> {
    // Validate income_dispatcher_authority PDA
    let expected_authority = Pubkey::find_program_address(
        &[INCOME_DISPATCHER_SEED_ROOT, b"authority"],
        &INCOME_DISPATCHER_PROGRAM_ID,
    )
    .0;
    require!(
        ctx.accounts.income_dispatcher_authority.key() == expected_authority,
        EngineErrorCode::InvalidAuthority
    );

    let launch_state = &ctx.accounts.launch_state;
    let launch_key = launch_state.key();

    let escrow_authority_seeds = &[
        SEED_ROOT,
        b"escrow_authority",
        launch_key.as_ref(),
        &[ctx.bumps.escrow_authority],
    ];
    let signers = &[&escrow_authority_seeds[..]];

    // CPI to Raydium decrease_liquidity_v2 with liquidity=0 to collect fees only
    let cpi_accounts = raydium_amm_v3::cpi::accounts::DecreaseLiquidityV2 {
        nft_owner: ctx.accounts.escrow_authority.to_account_info(),
        nft_account: ctx.accounts.position_nft_account.to_account_info(),
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
    };

    let cpi_context = CpiContext::new_with_signer(
        ctx.accounts.raydium_program.to_account_info(),
        cpi_accounts,
        signers,
    )
    .with_remaining_accounts(ctx.remaining_accounts.to_vec());

    // Call decrease_liquidity_v2 with liquidity=0 to collect fees only
    // amount_0_min and amount_1_min are set to 0 since we're not removing liquidity
    raydium_amm_v3::cpi::decrease_liquidity_v2(
        cpi_context,
        0, // liquidity = 0 (collect fees only)
        0, // amount_0_min = 0
        0, // amount_1_min = 0
    )?;

    Ok(())
}
