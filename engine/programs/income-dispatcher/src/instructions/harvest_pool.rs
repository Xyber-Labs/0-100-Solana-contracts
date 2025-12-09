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
    income_calculator::Role,
    state::{Config, PlatformIncome, ProjectIncome},
};

const POOL_STATE_SQRT_PRICE_X64_OFFSET: usize = 253;

#[event]
pub struct IncomeHarvested {
    project_id: u64,
    role: Role,
    base: u64,
    quote: u64,
}

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
        seeds = [engine::constants::SEED_ROOT, b"launch", &project_id.to_le_bytes()],
        bump,
        seeds::program = engine::ID
    )]
    pub launch_state: Box<Account<'info, engine::state::LaunchState>>,

    #[account(
        mut,
        seeds = [DISPATCHER_SEED_ROOT, b"platform_income"],
        bump,
    )]
    pub platform_income: Box<Account<'info, PlatformIncome>>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + ProjectIncome::INIT_SPACE,
        seeds = [DISPATCHER_SEED_ROOT, b"project_income", &project_id.to_be_bytes()],
        bump,
    )]
    pub project_income: Box<Account<'info, ProjectIncome>>,

    /// CHECK: Project authority PDA derived from project_id
    #[account(seeds = [DISPATCHER_SEED_ROOT, b"harvest_authority"], bump)]
    pub harvest_authority: UncheckedAccount<'info>,

    #[account(address = pubkey!("So11111111111111111111111111111111111111112"))]
    pub quote_mint: Account<'info, Mint>,

    /// Base mint from project pool
    #[account(constraint = Some(base_mint.key()) == launch_state.base_mint @ ErrorCode::InvalidTokenMint)]
    pub base_mint: Account<'info, Mint>,

    /// Quote vault - init-if-needed associated token account owned by harvest_authority
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = quote_mint,
        associated_token::authority = harvest_authority,
    )]
    pub quote_vault: Account<'info, TokenAccount>,

    /// Base vault - init-if-needed associated token account owned by harvest_authority
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = base_mint,
        associated_token::authority = harvest_authority,
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
    _project_id: u64,
) -> Result<()> {
    let project_income = &mut ctx.accounts.project_income;
    project_income.authorities[Role::Treasure as usize] = ctx.accounts.config.platform_wallet;
    project_income.authorities[Role::Creator as usize] = ctx.accounts.launch_state.creator;
    project_income.authorities[Role::Community as usize] = ctx.accounts.config.community_wallet;

    let quote_balance_before = ctx.accounts.quote_vault.amount;
    let base_balance_before = ctx.accounts.base_vault.amount;

    claim_fees_from_engine(&ctx)?;

    ctx.accounts.quote_vault.reload()?;
    ctx.accounts.base_vault.reload()?;

    let quote_amount = ctx.accounts.quote_vault.amount;
    let quote_claimed =
        quote_amount.checked_sub(quote_balance_before).ok_or(ErrorCode::ArithmeticOverflow)?;

    let base_amount = ctx.accounts.base_vault.amount;
    let base_claimed =
        base_amount.checked_sub(base_balance_before).ok_or(ErrorCode::ArithmeticOverflow)?;

    distribute_income(&mut ctx, base_claimed, quote_claimed)?;

    Ok(())
}

fn claim_fees_from_engine<'info>(
    ctx: &Context<'_, '_, '_, 'info, HarvestPool<'info>>,
) -> Result<()> {
    let cpi_accounts = engine_cpi::accounts::ClaimClmmFees {
        harvest_authority: ctx.accounts.harvest_authority.to_account_info(),
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

    let harvest_authority_seeds = &[
        DISPATCHER_SEED_ROOT,
        b"harvest_authority",
        &[ctx.bumps.harvest_authority],
    ];
    let signers = &[&harvest_authority_seeds[..]];

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
    if pool_data.len() < POOL_STATE_SQRT_PRICE_X64_OFFSET + 16 {
        return Err(ErrorCode::InvalidPoolState.into());
    }
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

    for income in distribution.incomes {
        emit!(IncomeHarvested {
            project_id: ctx.accounts.launch_state.project_id,
            role: income.recipient,
            base: income.base_token as u64,
            quote: income.quote_token as u64
        });

        let role_idx = income.recipient as usize;
        let base_amount = income.base_token as u64;
        let quote_amount = income.quote_token as u64;

        let project_balances = &mut ctx.accounts.project_income.balances[role_idx];
        project_balances.earned_base = project_balances
            .earned_base
            .checked_add(base_amount)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        project_balances.earned_quote = project_balances
            .earned_quote
            .checked_add(quote_amount)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        let platform_balances = &mut ctx.accounts.platform_income.balances[role_idx];
        platform_balances.earned_base = platform_balances
            .earned_base
            .checked_add(base_amount)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        platform_balances.earned_quote = platform_balances
            .earned_quote
            .checked_add(quote_amount)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
    }

    Ok(())
}
