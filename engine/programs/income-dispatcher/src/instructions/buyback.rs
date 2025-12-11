use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    memo::Memo,
    token::{Mint, Token, TokenAccount},
    token_2022::Token2022,
};
use raydium_amm_v3::program::AmmV3;

use crate::{
    DISPATCHER_SEED_ROOT,
    errors::ErrorCode,
    income_calculator::Role,
    state::{Config, Totals},
};

#[event]
pub struct BuyBackExecuted {
    pub quote_spent: u64,
    pub xyber_received: u64,
}

#[derive(Accounts)]
pub struct BuyBack<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(seeds = [DISPATCHER_SEED_ROOT, b"config"], bump)]
    pub dispatcher_config: Box<Account<'info, Config>>,

    #[account(seeds = [engine::constants::SEED_ROOT, b"config"], bump, seeds::program = engine::ID)]
    pub engine_config: Box<Account<'info, engine::state::EngineConfig>>,

    #[account(address = engine::constants::WSOL_MINT @ ErrorCode::InvalidTokenMint)]
    pub wsol_mint: Box<Account<'info, Mint>>,

    #[account(address = engine_config.xyber_mint @ ErrorCode::InvalidTokenMint)]
    pub xyber_mint: Box<Account<'info, Mint>>,

    #[account(mut, seeds = [DISPATCHER_SEED_ROOT, b"totals", &[Role::BuyBack as u8], wsol_mint.key().as_ref()], bump)]
    pub buyback_wsol_totals: Box<Account<'info, Totals>>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Totals::INIT_SPACE,
        seeds = [DISPATCHER_SEED_ROOT, b"totals", &[Role::Treasure as u8], xyber_mint.key().as_ref()],
        bump,
    )]
    pub treasure_xyber_totals: Box<Account<'info, Totals>>,

    /// CHECK: Harvest authority PDA
    #[account(seeds = [DISPATCHER_SEED_ROOT, b"authority"], bump)]
    pub authority: AccountInfo<'info>,

    #[account(mut, associated_token::mint = wsol_mint, associated_token::authority = authority)]
    pub wsol_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = xyber_mint,
        associated_token::authority = authority,
    )]
    pub xyber_vault: Box<Account<'info, TokenAccount>>,

    /// CHECK: Pool state - validated by Raydium program
    #[account(mut)]
    pub raydium_pool_state: UncheckedAccount<'info>,
    /// CHECK: AMM config - validated by Raydium program
    pub raydium_amm_config: UncheckedAccount<'info>,
    /// CHECK: Quote vault in pool - validated by Raydium program
    #[account(mut)]
    pub raydium_quote_vault: UncheckedAccount<'info>,
    /// CHECK: Xyber vault in pool - validated by Raydium program
    #[account(mut)]
    pub raydium_xyber_vault: UncheckedAccount<'info>,
    /// CHECK: Observation state - validated by Raydium program
    #[account(mut)]
    pub raydium_observation_state: UncheckedAccount<'info>,
    pub raydium_program: Program<'info, AmmV3>,
    pub token_program: Program<'info, Token>,
    pub token_program_2022: Program<'info, Token2022>,
    pub memo_program: Program<'info, Memo>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn buyback<'info>(ctx: Context<'_, '_, '_, 'info, BuyBack<'info>>) -> Result<()> {
    let wsol_amount = ctx.accounts.buyback_wsol_totals.available()?;
    require!(wsol_amount > 0, ErrorCode::NotAllowed);

    let xyber_balance_before = ctx.accounts.xyber_vault.amount;

    execute_swap(&ctx, wsol_amount)?;

    ctx.accounts.xyber_vault.reload()?;
    let xyber_received = ctx
        .accounts
        .xyber_vault
        .amount
        .checked_sub(xyber_balance_before)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    ctx.accounts.buyback_wsol_totals.add_spent(wsol_amount)?;
    ctx.accounts.treasure_xyber_totals.add_harvested_impl(xyber_received)?;

    emit!(BuyBackExecuted {
        quote_spent: wsol_amount,
        xyber_received,
    });

    Ok(())
}

fn execute_swap<'info>(
    ctx: &Context<'_, '_, '_, 'info, BuyBack<'info>>,
    amount_in: u64,
) -> Result<()> {
    let authority_seeds = &[DISPATCHER_SEED_ROOT, b"authority", &[ctx.bumps.authority]];
    let signer_seeds = &[&authority_seeds[..]];

    let cpi_accounts = raydium_amm_v3::cpi::accounts::SwapSingleV2 {
        payer: ctx.accounts.authority.to_account_info(),
        amm_config: ctx.accounts.raydium_amm_config.to_account_info(),
        pool_state: ctx.accounts.raydium_pool_state.to_account_info(),
        input_token_account: ctx.accounts.wsol_vault.to_account_info(),
        output_token_account: ctx.accounts.xyber_vault.to_account_info(),
        input_vault: ctx.accounts.raydium_quote_vault.to_account_info(),
        output_vault: ctx.accounts.raydium_xyber_vault.to_account_info(),
        observation_state: ctx.accounts.raydium_observation_state.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
        token_program_2022: ctx.accounts.token_program_2022.to_account_info(),
        memo_program: ctx.accounts.memo_program.to_account_info(),
        input_vault_mint: ctx.accounts.wsol_mint.to_account_info(),
        output_vault_mint: ctx.accounts.xyber_mint.to_account_info(),
    };

    let remaining_accounts: Vec<AccountInfo<'info>> = ctx.remaining_accounts.to_vec();

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.raydium_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    )
    .with_remaining_accounts(remaining_accounts);

    raydium_amm_v3::cpi::swap_v2(cpi_ctx, amount_in, 0, 0, true)
}
