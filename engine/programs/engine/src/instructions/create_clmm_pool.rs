use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::clock::Clock;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, MintTo, Token};
use anchor_spl::token_interface::{Mint as InterfaceMint, TokenInterface};
use raydium_amm_v3::{cpi, program::AmmV3, states::AmmConfig};

use crate::{LaunchState, EscrowAccount};

#[derive(Accounts)]
pub struct CreateClmmPool<'info> {
    pub clmm_program: Program<'info, AmmV3>,

    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,

    #[account(mut, seeds = [crate::SEED_ROOT, b"escrow", launch_state.key().as_ref()], bump)]
    pub escrow: Account<'info, EscrowAccount>,

    /// CHECK: mint authority PDA
    #[account(seeds = [crate::SEED_ROOT, b"mint_auth", launch_state.key().as_ref()], bump)]
    pub mint_authority: UncheckedAccount<'info>,

    pub amm_config: Box<Account<'info, AmmConfig>>,

    /// CHECK: Pool state PDA (created by Raydium)
    #[account(mut)]
    pub pool_state: UncheckedAccount<'info>,

    #[account(
        constraint = quote_mint.key() < base_mint.key(),
        mint::token_program = quote_token_program
    )]
    pub quote_mint: Box<InterfaceAccount<'info, InterfaceMint>>,

    #[account(
        init,
        payer = payer,
        mint::decimals = 9,
        mint::authority = mint_authority,
        mint::token_program = base_token_program
    )]
    pub base_mint: Box<Account<'info, Mint>>,

    /// CHECK: Quote vault (created by Raydium)
    #[account(mut)]
    pub quote_vault: UncheckedAccount<'info>,

    /// CHECK: Base vault (created by Raydium)
    #[account(mut)]
    pub base_vault: UncheckedAccount<'info>,

    /// CHECK: Observation state
    #[account(mut)]
    pub observation_state: UncheckedAccount<'info>,

    /// CHECK: Tick array bitmap (created by Raydium)
    #[account(mut)]
    pub tick_array_bitmap: UncheckedAccount<'info>,

    /// CHECK: ATA for base token
    #[account(mut)]
    pub base_token_ata: UncheckedAccount<'info>,

    pub quote_token_program: Interface<'info, TokenInterface>,
    pub base_token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn create_clmm_pool(ctx: Context<CreateClmmPool>) -> Result<()> {
    create_pool_token_ata(&ctx)?;
    mint_pool_tokens(&ctx)?;
    invoke_raydium_create_pool(&ctx)?;

    ctx.accounts.launch_state.clmm_base_mint = Some(ctx.accounts.base_mint.key());

    Ok(())
}

fn create_pool_token_ata(ctx: &Context<CreateClmmPool>) -> Result<()> {
    anchor_spl::associated_token::create(
        CpiContext::new(
            ctx.accounts.associated_token_program.to_account_info(),
            anchor_spl::associated_token::Create {
                payer: ctx.accounts.payer.to_account_info(),
                associated_token: ctx.accounts.base_token_ata.to_account_info(),
                authority: ctx.accounts.payer.to_account_info(),
                mint: ctx.accounts.base_mint.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: ctx.accounts.base_token_program.to_account_info(),
            },
        )
    )?;

    Ok(())
}

fn mint_pool_tokens(ctx: &Context<CreateClmmPool>) -> Result<()> {
    let total_supply = 1_000_000_000u64;
    let launch_key = ctx.accounts.launch_state.key();
    let seeds = &[
        crate::SEED_ROOT,
        b"mint_auth",
        launch_key.as_ref(),
        &[ctx.bumps.mint_authority],
    ];
    let signer_seeds = &[&seeds[..]];

    let mint_accounts = MintTo {
        mint: ctx.accounts.base_mint.to_account_info(),
        to: ctx.accounts.base_token_ata.to_account_info(),
        authority: ctx.accounts.mint_authority.to_account_info(),
    };
    let mint_ctx = CpiContext::new_with_signer(
        ctx.accounts.base_token_program.to_account_info(),
        mint_accounts,
        signer_seeds,
    );
    token::mint_to(mint_ctx, total_supply)?;

    Ok(())
}

fn invoke_raydium_create_pool(ctx: &Context<CreateClmmPool>) -> Result<()> {
    let calculator = StakingCalculator::new(
        ctx.accounts.launch_state.total_deposited,
        ctx.accounts.launch_state.sale_allocation,
        ctx.accounts.launch_state.lp_allocation,
    );

    let sqrt_price_x64 = calculator.get_sqrt_price();
    let current_timestamp = Clock::get()?.unix_timestamp;
    let open_time = if current_timestamp == 0 {
        0
    } else {
        (current_timestamp.saturating_sub(10).max(1)) as u64
    };

    let cpi_accounts = cpi::accounts::CreatePool {
        pool_creator: ctx.accounts.payer.to_account_info(),
        amm_config: ctx.accounts.amm_config.to_account_info(),
        pool_state: ctx.accounts.pool_state.to_account_info(),
        token_mint_0: ctx.accounts.quote_mint.to_account_info(),
        token_mint_1: ctx.accounts.base_mint.to_account_info(),
        token_vault_0: ctx.accounts.quote_vault.to_account_info(),
        token_vault_1: ctx.accounts.base_vault.to_account_info(),
        observation_state: ctx.accounts.observation_state.to_account_info(),
        tick_array_bitmap: ctx.accounts.tick_array_bitmap.to_account_info(),
        token_program_0: ctx.accounts.quote_token_program.to_account_info(),
        token_program_1: ctx.accounts.base_token_program.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
        rent: ctx.accounts.rent.to_account_info(),
    };

    let cpi_context = CpiContext::new(ctx.accounts.clmm_program.to_account_info(), cpi_accounts);

    cpi::create_pool(cpi_context, sqrt_price_x64, open_time)?;

    Ok(())
}

struct StakingCalculator {
    raised_lamports: u64,
    sale_allocation: u64,
    lp_allocation: u64,
}

impl StakingCalculator {
    fn new(raised_lamports: u64, sale_allocation: u64, lp_allocation: u64) -> Self {
        Self {
            raised_lamports,
            sale_allocation,
            lp_allocation,
        }
    }

    fn get_sqrt_price(&self) -> u128 {
        let price_tokens_per_sol = (self.sale_allocation as u128 * 1_000_000_000) / (self.raised_lamports as u128);
        let sqrt_price_numerator = Self::integer_sqrt(price_tokens_per_sol);
        let sqrt_price_denominator = Self::integer_sqrt(1_000_000_000);
        (sqrt_price_numerator << 64) / sqrt_price_denominator
    }

    fn integer_sqrt(n: u128) -> u128 {
        if n == 0 {
            return 0;
        }
        let mut x = n;
        let mut y = (x + 1) / 2;
        while y < x {
            x = y;
            y = (x + n / x) / 2;
        }
        x
    }
}
