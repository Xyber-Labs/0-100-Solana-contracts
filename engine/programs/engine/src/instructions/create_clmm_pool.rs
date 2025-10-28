use anchor_lang::{prelude::*, solana_program::sysvar::clock::Clock};
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, MintTo, Token},
    token_interface::{Mint as InterfaceMint, TokenInterface},
};
use raydium_amm_v3::{cpi, program::AmmV3, states::AmmConfig};

use crate::{errors::ErrorCode, EscrowAccount, LP_POOL_ALLOCATION, LaunchState, SEED_ROOT, TOTAL_SUPPLY};

#[derive(Accounts)]
pub struct CreateClmmPool<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        constraint = launch_state.clmm_base_mint.is_none() @ crate::errors::ErrorCode::PoolAlreadyCreated
    )]
    pub launch_state: Account<'info, LaunchState>,

    #[account(mut, seeds = [SEED_ROOT, b"escrow", launch_state.key().as_ref()], bump)]
    pub escrow: Account<'info, EscrowAccount>,

    /// CHECK: Escrow authority PDA without data for token ownership
    #[account(seeds = [SEED_ROOT, b"escrow_authority", launch_state.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        mint::decimals = 9,
        mint::authority = escrow_authority,
        mint::token_program = base_token_program
    )]
    pub base_mint: Box<Account<'info, Mint>>,

    /// CHECK: Escrow ATA for base token (ATA of escrow_authority for base_mint)
    #[account(
        mut,
        seeds = [escrow_authority.key().as_ref(), base_token_program.key().as_ref(), base_mint.key().as_ref()],
        seeds::program = associated_token_program.key(),
        bump
    )]
    pub base_escrow_ata: UncheckedAccount<'info>,

    #[account(
        mint::token_program = quote_token_program,
        address = anchor_lang::solana_program::pubkey!("So11111111111111111111111111111111111111112")
    )]
    pub quote_mint: Box<InterfaceAccount<'info, InterfaceMint>>,

    pub raydium_amm_config: Box<Account<'info, AmmConfig>>,
    /// CHECK: Pool state PDA
    #[account(mut)]
    pub raydium_pool_state: UncheckedAccount<'info>,
    /// CHECK: Base vault
    #[account(mut)]
    pub raydium_base_vault: UncheckedAccount<'info>,
    /// CHECK: Quote vault
    #[account(mut)]
    pub raydium_quote_vault: UncheckedAccount<'info>,
    /// CHECK: Observation state
    #[account(mut)]
    pub raydium_observation_state: UncheckedAccount<'info>,
    /// CHECK: Tick array bitmap
    #[account(mut)]
    pub raydium_tick_array_bitmap: UncheckedAccount<'info>,

    pub raydium_program: Program<'info, AmmV3>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub base_token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn create_clmm_pool(ctx: Context<CreateClmmPool>) -> Result<()> {
    create_base_escrow_ata(&ctx)?;
    mint_base_tokens(&ctx)?;
    invoke_raydium_create_pool(&ctx)?;
    ctx.accounts.launch_state.clmm_base_mint = Some(ctx.accounts.base_mint.key());
    Ok(())
}

fn create_base_escrow_ata(ctx: &Context<CreateClmmPool>) -> Result<()> {
    anchor_spl::associated_token::create(CpiContext::new(
        ctx.accounts.associated_token_program.to_account_info(),
        anchor_spl::associated_token::Create {
            payer: ctx.accounts.payer.to_account_info(),
            associated_token: ctx.accounts.base_escrow_ata.to_account_info(),
            authority: ctx.accounts.escrow_authority.to_account_info(),
            mint: ctx.accounts.base_mint.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.base_token_program.to_account_info(),
        },
    ))?;

    Ok(())
}

fn mint_base_tokens(ctx: &Context<CreateClmmPool>) -> Result<()> {
    let launch_key = ctx.accounts.launch_state.key();
    let seeds = &[
        SEED_ROOT,
        b"escrow_authority",
        launch_key.as_ref(),
        &[ctx.bumps.escrow_authority],
    ];
    let seeds_binding = [&seeds[..]];
    let mint_accounts = MintTo {
        mint: ctx.accounts.base_mint.to_account_info(),
        to: ctx.accounts.base_escrow_ata.to_account_info(),
        authority: ctx.accounts.escrow_authority.to_account_info(),
    };
    let mint_ctx = CpiContext::new_with_signer(
        ctx.accounts.base_token_program.to_account_info(),
        mint_accounts,
        &seeds_binding,
    );
    token::mint_to(mint_ctx, TOTAL_SUPPLY)?;

    Ok(())
}

fn invoke_raydium_create_pool(ctx: &Context<CreateClmmPool>) -> Result<()> {
    let calculator = StakingCalculator::new(
        ctx.accounts.launch_state.total_deposited,
        LP_POOL_ALLOCATION,
    );

    let sqrt_price_x64 = calculator.get_sqrt_price();
    let open_time =
        Clock::get()?.unix_timestamp.checked_sub(1).ok_or(ErrorCode::ArithmeticOverflow)? as u64;

    let order = TokenOrderForPool::new(
        &ctx.accounts.quote_mint.to_account_info(),
        &ctx.accounts.base_mint.to_account_info(),
        &ctx.accounts.raydium_quote_vault.to_account_info(),
        &ctx.accounts.raydium_base_vault.to_account_info(),
        &ctx.accounts.quote_token_program.to_account_info(),
        &ctx.accounts.base_token_program.to_account_info(),
        sqrt_price_x64,
    )?;

    let cpi_accounts = cpi::accounts::CreatePool {
        pool_creator: ctx.accounts.payer.to_account_info(),
        amm_config: ctx.accounts.raydium_amm_config.to_account_info(),
        pool_state: ctx.accounts.raydium_pool_state.to_account_info(),
        token_mint_0: order.token_mint_0,
        token_mint_1: order.token_mint_1,
        token_vault_0: order.token_vault_0,
        token_vault_1: order.token_vault_1,
        observation_state: ctx.accounts.raydium_observation_state.to_account_info(),
        tick_array_bitmap: ctx.accounts.raydium_tick_array_bitmap.to_account_info(),
        token_program_0: order.token_program_0,
        token_program_1: order.token_program_1,
        system_program: ctx.accounts.system_program.to_account_info(),
        rent: ctx.accounts.rent.to_account_info(),
    };
    let cpi_context = CpiContext::new(ctx.accounts.raydium_program.to_account_info(), cpi_accounts);
    cpi::create_pool(cpi_context, order.sqrt_price, open_time)?;

    Ok(())
}

struct StakingCalculator {
    raised_lamports: u64,
    lp_allocation: u64,
}

impl StakingCalculator {
    fn new(raised_lamports: u64, lp_allocation: u64) -> Self {
        Self {
            raised_lamports,
            lp_allocation,
        }
    }

    fn get_sqrt_price(&self) -> u128 {
        let price_ratio = ((self.raised_lamports as u128) << 64) / self.lp_allocation as u128;
        let sqrt_price = Self::integer_sqrt(price_ratio);
        sqrt_price << 32
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

struct TokenOrderForPool<'info> {
    token_mint_0: AccountInfo<'info>,
    token_mint_1: AccountInfo<'info>,
    token_vault_0: AccountInfo<'info>,
    token_vault_1: AccountInfo<'info>,
    token_program_0: AccountInfo<'info>,
    token_program_1: AccountInfo<'info>,
    sqrt_price: u128,
}

impl<'info> TokenOrderForPool<'info> {
    fn new(
        quote_mint: &AccountInfo<'info>,
        base_mint: &AccountInfo<'info>,
        quote_vault: &AccountInfo<'info>,
        base_vault: &AccountInfo<'info>,
        quote_program: &AccountInfo<'info>,
        base_program: &AccountInfo<'info>,
        sqrt_price_x64: u128,
    ) -> Result<Self> {
        if quote_mint.key() < base_mint.key() {
            Ok(Self {
                token_mint_0: quote_mint.clone(),
                token_mint_1: base_mint.clone(),
                token_vault_0: quote_vault.clone(),
                token_vault_1: base_vault.clone(),
                token_program_0: quote_program.clone(),
                token_program_1: base_program.clone(),
                sqrt_price: sqrt_price_x64,
            })
        } else {
            let inverted_sqrt_price = (1u128 << 64)
                .checked_mul(1u128 << 64)
                .and_then(|v| v.checked_div(sqrt_price_x64))
                .and_then(|v| v.checked_shr(64))
                .ok_or(ErrorCode::ArithmeticOverflow)?;
            Ok(Self {
                token_mint_0: base_mint.clone(),
                token_mint_1: quote_mint.clone(),
                token_vault_0: base_vault.clone(),
                token_vault_1: quote_vault.clone(),
                token_program_0: base_program.clone(),
                token_program_1: quote_program.clone(),
                sqrt_price: inverted_sqrt_price,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN_SQRT_PRICE_X64: u128 = 4295048016;
    const MAX_SQRT_PRICE_X64: u128 = 79226673521066979257578248091;

    #[test]
    fn test_sqrt_price_small_raise() {
        let calc = StakingCalculator::new(1_000_000_000, 500_000_000);
        let sqrt_price = calc.get_sqrt_price();
        assert!(
            sqrt_price >= MIN_SQRT_PRICE_X64,
            "sqrt_price {} < MIN {}",
            sqrt_price,
            MIN_SQRT_PRICE_X64
        );
        assert!(
            sqrt_price <= MAX_SQRT_PRICE_X64,
            "sqrt_price {} > MAX {}",
            sqrt_price,
            MAX_SQRT_PRICE_X64
        );
    }

    #[test]
    fn test_sqrt_price_medium_raise() {
        let calc = StakingCalculator::new(191_000_000_000, 459_460_000);
        let sqrt_price = calc.get_sqrt_price();
        assert!(
            sqrt_price >= MIN_SQRT_PRICE_X64,
            "sqrt_price {} < MIN {}",
            sqrt_price,
            MIN_SQRT_PRICE_X64
        );
        assert!(
            sqrt_price <= MAX_SQRT_PRICE_X64,
            "sqrt_price {} > MAX {}",
            sqrt_price,
            MAX_SQRT_PRICE_X64
        );
    }

    #[test]
    fn test_sqrt_price_large_raise() {
        let calc = StakingCalculator::new(500_000_000_000, 1_000_000_000);
        let sqrt_price = calc.get_sqrt_price();
        assert!(
            sqrt_price >= MIN_SQRT_PRICE_X64,
            "sqrt_price {} < MIN {}",
            sqrt_price,
            MIN_SQRT_PRICE_X64
        );
        assert!(
            sqrt_price <= MAX_SQRT_PRICE_X64,
            "sqrt_price {} > MAX {}",
            sqrt_price,
            MAX_SQRT_PRICE_X64
        );
    }

    #[test]
    fn test_sqrt_price_max_hardcap() {
        let calc = StakingCalculator::new(1_000 * 1_000_000_000, 10_000_000_000);
        let sqrt_price = calc.get_sqrt_price();
        assert!(
            sqrt_price >= MIN_SQRT_PRICE_X64,
            "sqrt_price {} < MIN {}",
            sqrt_price,
            MIN_SQRT_PRICE_X64
        );
        assert!(
            sqrt_price <= MAX_SQRT_PRICE_X64,
            "sqrt_price {} > MAX {}",
            sqrt_price,
            MAX_SQRT_PRICE_X64
        );
    }

    #[test]
    fn test_integer_sqrt_basic() {
        assert_eq!(StakingCalculator::integer_sqrt(0), 0);
        assert_eq!(StakingCalculator::integer_sqrt(1), 1);
        assert_eq!(StakingCalculator::integer_sqrt(4), 2);
        assert_eq!(StakingCalculator::integer_sqrt(9), 3);
        assert_eq!(StakingCalculator::integer_sqrt(16), 4);
        assert_eq!(StakingCalculator::integer_sqrt(100), 10);
    }

    #[test]
    fn test_integer_sqrt_non_perfect() {
        assert_eq!(StakingCalculator::integer_sqrt(2), 1);
        assert_eq!(StakingCalculator::integer_sqrt(3), 1);
        assert_eq!(StakingCalculator::integer_sqrt(5), 2);
        assert_eq!(StakingCalculator::integer_sqrt(8), 2);
        assert_eq!(StakingCalculator::integer_sqrt(15), 3);
    }
}
