use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
    token_2022::Token2022,
};
use raydium_amm_v3::program::AmmV3;

use engine::cpi as engine_cpi;

use crate::{
    DISPATCHER_SEED_ROOT,
    errors::ErrorCode,
    income_calculator::Role, state::{Config, IncomeConfig},
};

const POOL_STATE_SQRT_PRICE_X64_OFFSET: usize = 253;

#[derive(Accounts)]
#[instruction(project_id: u64)]
pub struct HarvestPool<'info> {
    /// Anyone can call this instruction
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Config account
    #[account(seeds = [DISPATCHER_SEED_ROOT, b"config"], bump)]
    pub config: Box<Account<'info, Config>>,

    /// Launch state account
    #[account(
        mut,
        seeds = [engine::constants::SEED_ROOT, b"launch", &project_id.to_le_bytes()],
        bump,
        seeds::program = engine::ID
    )]
    pub launch_state: Box<Account<'info, engine::state::LaunchState>>,

    /// Project pool account for tracking total claims
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + IncomeConfig::INIT_SPACE,
        seeds = [DISPATCHER_SEED_ROOT, b"income_config", &project_id.to_be_bytes()],
        bump,
    )]
    pub income_config: Box<Account<'info, IncomeConfig>>,

    /// CHECK: Project authority PDA derived from project_id
    #[account(seeds = [DISPATCHER_SEED_ROOT, b"project_authority", &project_id.to_be_bytes()], bump)]
    pub project_authority: UncheckedAccount<'info>,

    /// Quote mint from project pool
    pub quote_mint: Account<'info, Mint>,

    /// Base mint from project pool
    #[account(constraint = Some(base_mint.key()) == launch_state.base_mint @ ErrorCode::InvalidTokenMint)]
    pub base_mint: Account<'info, Mint>,

    /// Quote vault - init-if-needed associated token account owned by project_authority
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = quote_mint,
        associated_token::authority = project_authority,
    )]
    pub quote_vault: Account<'info, TokenAccount>,

    /// Base vault - init-if-needed associated token account owned by project_authority
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = base_mint,
        associated_token::authority = project_authority,
    )]
    pub base_vault: Account<'info, TokenAccount>,

    /// CHECK: Escrow authority PDA - validated by engine CPI
    #[account(mut)]
    pub escrow_authority: UncheckedAccount<'info>,

    /// CHECK: Position NFT mint - validated by engine CPI
    #[account(mut)]
    pub raydium_position_nft_mint: UncheckedAccount<'info>,
    /// CHECK: Position NFT account - validated by engine CPI
    #[account(mut)]
    pub raydium_position_nft_account: UncheckedAccount<'info>,

    /// CHECK: Personal position state - validated by engine CPI
    #[account(mut)]
    pub personal_position: UncheckedAccount<'info>,
    /// CHECK: Pool state - validated by engine CPI and pool address constraint
    #[account(mut, address = launch_state.raydium_pool_state.unwrap())]
    pub raydium_pool_state: UncheckedAccount<'info>,
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

    pub engine_program: Program<'info, engine::program::Engine>,
    pub raydium_program: Program<'info, AmmV3>,
    pub token_program: Program<'info, Token>,
    pub token_program_2022: Program<'info, Token2022>,
    /// CHECK: Memo program - validated by address constraint
    #[account(address = anchor_spl::memo::spl_memo::id())]
    pub memo_program: UncheckedAccount<'info>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn harvest_pool<'info>(
    mut ctx: Context<'_, '_, '_, 'info, HarvestPool<'info>>,
    project_id: u64,
) -> Result<()> {
    let income_config = &mut ctx.accounts.income_config;
    income_config.authorities[Role::Platform as usize] = ctx.accounts.config.platform_wallet;
    income_config.authorities[Role::Creator as usize] = ctx.accounts.launch_state.creator;
    income_config.authorities[Role::Community as usize] = ctx.accounts.config.community_wallet;

    let quote_balance_before = ctx.accounts.quote_vault.amount;
    let base_balance_before = ctx.accounts.base_vault.amount;

    claim_fees_from_engine(&ctx, project_id)?;

    ctx.accounts.quote_vault.reload()?;
    ctx.accounts.base_vault.reload()?;

    let quote_claimed = ctx.accounts.quote_vault.amount.saturating_sub(quote_balance_before);
    let base_claimed = ctx.accounts.base_vault.amount.saturating_sub(base_balance_before);

    distribute_income(&mut ctx, base_claimed, quote_claimed)?;

    let income_config = &mut ctx.accounts.income_config;

    income_config.total_harvested_base = income_config
        .total_harvested_base
        .checked_add(base_claimed)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    income_config.total_harvested_quote = income_config
        .total_harvested_quote
        .checked_add(quote_claimed)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    Ok(())
}

fn claim_fees_from_engine<'info>(
    ctx: &Context<'_, '_, '_, 'info, HarvestPool<'info>>,
    project_id: u64,
) -> Result<()> {
    let cpi_accounts = engine_cpi::accounts::ClaimClmmFees {
        project_authority: ctx.accounts.project_authority.to_account_info(),
        raydium_program: ctx.accounts.raydium_program.to_account_info(),
        launch_state: ctx.accounts.launch_state.to_account_info(),
        escrow_authority: ctx.accounts.escrow_authority.to_account_info(),
        raydium_position_nft_mint: ctx.accounts.raydium_position_nft_mint.to_account_info(),
        raydium_position_nft_account: ctx.accounts.raydium_position_nft_account.to_account_info(),
        personal_position: ctx.accounts.personal_position.to_account_info(),
        pool_state: ctx.accounts.raydium_pool_state.to_account_info(),
        protocol_position: ctx.accounts.protocol_position.to_account_info(),
        token_vault_0: ctx.accounts.token_vault_0.to_account_info(),
        token_vault_1: ctx.accounts.token_vault_1.to_account_info(),
        tick_array_lower: ctx.accounts.tick_array_lower.to_account_info(),
        tick_array_upper: ctx.accounts.tick_array_upper.to_account_info(),
        recipient_token_account_0: ctx.accounts.quote_vault.to_account_info(),
        recipient_token_account_1: ctx.accounts.base_vault.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
        token_program_2022: ctx.accounts.token_program_2022.to_account_info(),
        memo_program: ctx.accounts.memo_program.to_account_info(),
        vault_0_mint: ctx.accounts.quote_mint.to_account_info(),
        vault_1_mint: ctx.accounts.base_mint.to_account_info(),
    };

    let project_authority_seeds = &[
        DISPATCHER_SEED_ROOT,
        b"project_authority",
        &project_id.to_be_bytes(),
        &[ctx.bumps.project_authority],
    ];
    let signers = &[&project_authority_seeds[..]];

    let cpi_context = CpiContext::new_with_signer(
        ctx.accounts.engine_program.to_account_info(),
        cpi_accounts,
        signers,
    )
    .with_remaining_accounts(ctx.remaining_accounts.to_vec());

    engine_cpi::claim_clmm_fees(cpi_context)
}

fn distribute_income(
    ctx: &mut Context<'_, '_, '_, '_, HarvestPool<'_>>,
    base_claimed: u64,
    quote_claimed: u64,
) -> Result<()> {
    let pool_data = ctx.accounts.raydium_pool_state.data.borrow();

    let sqrt_price_x64 = u128::from_le_bytes(
        pool_data[POOL_STATE_SQRT_PRICE_X64_OFFSET..POOL_STATE_SQRT_PRICE_X64_OFFSET + 16]
            .try_into()
            .map_err(|_| ErrorCode::InvalidPoolState)?,
    );

    let distribution = ctx.accounts.config.income_calculator.get_distribution(
        sqrt_price_x64,
        base_claimed as u128,
        quote_claimed as u128,
    )?;

    for income in distribution.incomes.iter() {
        let role_idx = income.recipient as usize;
        let balances = &mut ctx.accounts.income_config.balances[role_idx];
        balances.earned_base = balances
            .earned_base
            .checked_add(income.base_token as u64)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        balances.earned_quote = balances
            .earned_quote
            .checked_add(income.quote_token as u64)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
    }

    Ok(())
}
