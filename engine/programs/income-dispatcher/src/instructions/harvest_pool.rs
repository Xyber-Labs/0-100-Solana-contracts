use anchor_lang::{Discriminator, prelude::*, Space};
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
    state::{
        Config,
        Role::{self, BuyBack, Community, Creator, Treasure},
        Totals,
    },
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
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(seeds = [DISPATCHER_SEED_ROOT, b"config"], bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(
        seeds = [engine::constants::SEED_ROOT, b"launch", &project_id.to_le_bytes()],
        bump,
        seeds::program = engine::ID
    )]
    pub launch_state: Box<Account<'info, engine::state::LaunchState>>,

    #[account(address = engine::constants::WSOL_MINT @ ErrorCode::InvalidTokenMint)]
    pub quote_mint: Box<Account<'info, Mint>>,

    #[account(constraint = Some(base_mint.key()) == launch_state.base_mint @ ErrorCode::InvalidTokenMint)]
    pub base_mint: Box<Account<'info, Mint>>,

    /// CHECK: Platform treasure base totals - validated and initialized in handler
    #[account(mut, seeds = [DISPATCHER_SEED_ROOT, b"totals", &[Treasure as u8], base_mint.key().as_ref()], bump)]
    pub platform_treasure_base: UncheckedAccount<'info>,

    /// CHECK: Platform treasure quote totals - validated and initialized in handler
    #[account(mut, seeds = [DISPATCHER_SEED_ROOT, b"totals", &[Treasure as u8], quote_mint.key().as_ref()], bump)]
    pub platform_treasure_quote: UncheckedAccount<'info>,

    /// CHECK: Platform buyback base totals - validated and initialized in handler
    #[account(mut, seeds = [DISPATCHER_SEED_ROOT, b"totals", &[BuyBack as u8], base_mint.key().as_ref()], bump)]
    pub platform_buyback_base: UncheckedAccount<'info>,

    /// CHECK: Platform buyback quote totals - validated and initialized in handler
    #[account(mut, seeds = [DISPATCHER_SEED_ROOT, b"totals", &[BuyBack as u8], quote_mint.key().as_ref()], bump)]
    pub platform_buyback_quote: UncheckedAccount<'info>,

    /// CHECK: Project creator base totals - validated and initialized in handler
    #[account(mut, seeds = [DISPATCHER_SEED_ROOT, b"totals", &project_id.to_be_bytes(), &[Creator as u8], base_mint.key().as_ref()], bump)]
    pub project_creator_base: UncheckedAccount<'info>,

    /// CHECK: Project creator quote totals - validated and initialized in handler
    #[account(mut, seeds = [DISPATCHER_SEED_ROOT, b"totals", &project_id.to_be_bytes(), &[Creator as u8], quote_mint.key().as_ref()], bump)]
    pub project_creator_quote: UncheckedAccount<'info>,

    /// CHECK: Project community base totals - validated and initialized in handler
    #[account(mut, seeds = [DISPATCHER_SEED_ROOT, b"totals", &project_id.to_be_bytes(), &[Community as u8], base_mint.key().as_ref()], bump)]
    pub project_community_base: UncheckedAccount<'info>,

    /// CHECK: Project community quote totals - validated and initialized in handler
    #[account(mut, seeds = [DISPATCHER_SEED_ROOT, b"totals", &project_id.to_be_bytes(), &[Community as u8], quote_mint.key().as_ref()], bump)]
    pub project_community_quote: UncheckedAccount<'info>,

    /// CHECK: Harvest authority PDA
    #[account(seeds = [DISPATCHER_SEED_ROOT, b"authority"], bump)]
    pub authority: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = quote_mint,
        associated_token::authority = authority,
    )]
    pub quote_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = base_mint,
        associated_token::authority = authority,
    )]
    pub base_vault: Box<Account<'info, TokenAccount>>,

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
    ctx: Context<'_, '_, '_, 'info, HarvestPool<'info>>,
    _project_id: u64,
) -> Result<()> {
    init_totals_accounts(&ctx)?;

    let quote_balance_before = ctx.accounts.quote_vault.amount;
    let base_balance_before = ctx.accounts.base_vault.amount;

    claim_fees_from_engine(&ctx)?;

    ctx.accounts.quote_vault.reload()?;
    let quote_amount = ctx.accounts.quote_vault.amount;
    let quote_harvested =
        quote_amount.checked_sub(quote_balance_before).ok_or(ErrorCode::ArithmeticOverflow)?;

    ctx.accounts.base_vault.reload()?;
    let base_amount = ctx.accounts.base_vault.amount;
    let base_harvested =
        base_amount.checked_sub(base_balance_before).ok_or(ErrorCode::ArithmeticOverflow)?;

    distribute_income(&ctx, base_harvested, quote_harvested)?;

    Ok(())
}

fn claim_fees_from_engine<'info>(
    ctx: &Context<'_, '_, '_, 'info, HarvestPool<'info>>,
) -> Result<()> {
    let cpi_accounts = engine_cpi::accounts::ClaimClmmFees {
        dispatcher_authority: ctx.accounts.authority.to_account_info(),
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

    let authority_seeds = &[DISPATCHER_SEED_ROOT, b"authority", &[ctx.bumps.authority]];
    let signers = &[&authority_seeds[..]];

    let cpi_context = CpiContext::new_with_signer(
        ctx.accounts.engine_program.to_account_info(),
        cpi_accounts,
        signers,
    )
    .with_remaining_accounts(ctx.remaining_accounts.to_vec());

    engine_cpi::claim_clmm_fees(cpi_context)
}

fn init_totals_accounts(ctx: &Context<HarvestPool>) -> Result<()> {
    let payer = &ctx.accounts.payer.to_account_info();
    let system = &ctx.accounts.system_program.to_account_info();
    let base_mint_key = ctx.accounts.base_mint.key();
    let quote_mint_key = ctx.accounts.quote_mint.key();
    let project_id_bytes = ctx.accounts.launch_state.project_id.to_be_bytes();

    #[rustfmt::skip]
    let totals: [(&AccountInfo, &[&[u8]]); 8] = [
        (&ctx.accounts.platform_treasure_base,   &[DISPATCHER_SEED_ROOT, b"totals", &[Treasure as u8], base_mint_key.as_ref(), &[ctx.bumps.platform_treasure_base]]),
        (&ctx.accounts.platform_treasure_quote,  &[DISPATCHER_SEED_ROOT, b"totals", &[Treasure as u8], quote_mint_key.as_ref(), &[ctx.bumps.platform_treasure_quote]]),
        (&ctx.accounts.platform_buyback_base,    &[DISPATCHER_SEED_ROOT, b"totals", &[BuyBack as u8], base_mint_key.as_ref(), &[ctx.bumps.platform_buyback_base]]),
        (&ctx.accounts.platform_buyback_quote,   &[DISPATCHER_SEED_ROOT, b"totals", &[BuyBack as u8], quote_mint_key.as_ref(), &[ctx.bumps.platform_buyback_quote]]),
        (&ctx.accounts.project_creator_base,     &[DISPATCHER_SEED_ROOT, b"totals", &project_id_bytes, &[Creator as u8], base_mint_key.as_ref(), &[ctx.bumps.project_creator_base]]),
        (&ctx.accounts.project_creator_quote,    &[DISPATCHER_SEED_ROOT, b"totals", &project_id_bytes, &[Creator as u8], quote_mint_key.as_ref(), &[ctx.bumps.project_creator_quote]]),
        (&ctx.accounts.project_community_base,   &[DISPATCHER_SEED_ROOT, b"totals", &project_id_bytes, &[Community as u8], base_mint_key.as_ref(), &[ctx.bumps.project_community_base]]),
        (&ctx.accounts.project_community_quote,  &[DISPATCHER_SEED_ROOT, b"totals", &project_id_bytes, &[Community as u8], quote_mint_key.as_ref(), &[ctx.bumps.project_community_quote]]),
    ];

    for (account, seeds) in totals {
        init_if_needed::<Totals>(account, payer, system, seeds)?;
    }
    Ok(())
}

fn distribute_income<'info>(
    ctx: &Context<'_, '_, '_, 'info, HarvestPool<'info>>,
    base_harvested: u64,
    quote_harvested: u64,
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
        base_harvested as u128,
        quote_harvested as u128,
    )?;

    for income in distribution.incomes {
        let base_amount = income.base_token as u64;
        let quote_amount = income.quote_token as u64;

        match income.recipient {
            Treasure => {
                Totals::add_harvested(&ctx.accounts.platform_treasure_base, base_amount)?;
                Totals::add_harvested(&ctx.accounts.platform_treasure_quote, quote_amount)?;
            }
            BuyBack => {
                Totals::add_harvested(&ctx.accounts.platform_buyback_base, base_amount)?;
                Totals::add_harvested(&ctx.accounts.platform_buyback_quote, quote_amount)?;
            }
            Creator => {
                Totals::add_harvested(&ctx.accounts.project_creator_base, base_amount)?;
                Totals::add_harvested(&ctx.accounts.project_creator_quote, quote_amount)?;
            }
            Community => {
                Totals::add_harvested(&ctx.accounts.project_community_base, base_amount)?;
                Totals::add_harvested(&ctx.accounts.project_community_quote, quote_amount)?;
            }
        }

        emit!(IncomeHarvested {
            project_id: ctx.accounts.launch_state.project_id,
            role: income.recipient,
            base: base_amount,
            quote: quote_amount
        });
    }

    Ok(())
}

fn init_if_needed<'a, T: Space + Discriminator + Default + AnchorSerialize>(
    account: &AccountInfo<'a>,
    payer: &AccountInfo<'a>,
    system_program: &AccountInfo<'a>,
    signer_seeds: &[&[u8]],
) -> Result<()> {
    if !account.data_is_empty() {
        return Ok(());
    }

    let space = 8 + T::INIT_SPACE;
    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(space);

    anchor_lang::system_program::create_account(
        CpiContext::new_with_signer(
            system_program.clone(),
            anchor_lang::system_program::CreateAccount {
                from: payer.clone(),
                to: account.clone(),
            },
            &[signer_seeds],
        ),
        lamports,
        space as u64,
        &crate::ID,
    )?;

    let mut data = account.try_borrow_mut_data()?;
    data[..8].copy_from_slice(&T::DISCRIMINATOR);
    let default_value = T::default();
    let serialized = default_value.try_to_vec()?;
    data[8..8 + serialized.len()].copy_from_slice(&serialized);

    Ok(())
}
