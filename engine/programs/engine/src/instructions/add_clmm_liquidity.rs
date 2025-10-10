use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::Token;
use anchor_spl::token_interface::{Mint as InterfaceMint, TokenInterface};
use raydium_amm_v3::program::AmmV3;

use crate::{LaunchState, EscrowAccount};

#[derive(Accounts)]
pub struct AddClmmLiquidity<'info> {
    pub clmm_program: Program<'info, AmmV3>,

    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
    pub launch_state: Account<'info, LaunchState>,

    #[account(mut, seeds = [crate::SEED_ROOT, b"escrow", launch_state.key().as_ref()], bump)]
    pub escrow: Account<'info, EscrowAccount>,

    /// CHECK: Pool state PDA (created by Raydium)
    #[account(mut)]
    pub pool_state: UncheckedAccount<'info>,

    #[account(
        constraint = quote_mint.key() < base_mint.key(),
        mint::token_program = quote_token_program
    )]
    pub quote_mint: Box<InterfaceAccount<'info, InterfaceMint>>,

    #[account(
        constraint = launch_state.clmm_base_mint == Some(base_mint.key()),
        mint::token_program = base_token_program
    )]
    pub base_mint: Box<InterfaceAccount<'info, InterfaceMint>>,

    /// CHECK: Quote vault (created by Raydium)
    #[account(mut)]
    pub quote_vault: UncheckedAccount<'info>,

    /// CHECK: Base vault (created by Raydium)
    #[account(mut)]
    pub base_vault: UncheckedAccount<'info>,

    /// CHECK: ATA for base token
    #[account(mut)]
    pub base_token_ata: UncheckedAccount<'info>,

    /// CHECK: Position NFT mint
    #[account(mut)]
    pub position_nft_mint: Signer<'info>,

    /// CHECK: Position NFT account
    #[account(mut)]
    pub position_nft_account: UncheckedAccount<'info>,

    /// CHECK: Position metadata account
    #[account(mut)]
    pub metadata_account: UncheckedAccount<'info>,

    /// CHECK: Personal position state
    #[account(mut)]
    pub personal_position: UncheckedAccount<'info>,

    /// CHECK: Protocol position state
    #[account(mut)]
    pub protocol_position: UncheckedAccount<'info>,

    /// CHECK: Tick array lower
    #[account(mut)]
    pub tick_array_lower: UncheckedAccount<'info>,

    /// CHECK: Tick array upper
    #[account(mut)]
    pub tick_array_upper: UncheckedAccount<'info>,

    /// CHECK: Quote token account
    #[account(mut)]
    pub quote_token_account: UncheckedAccount<'info>,

    /// CHECK: Metadata program
    pub metadata_program: UncheckedAccount<'info>,

    /// CHECK: Token 2022 program
    pub token_2022_program: UncheckedAccount<'info>,

    pub quote_token_program: Interface<'info, TokenInterface>,
    pub base_token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn add_clmm_liquidity(ctx: Context<AddClmmLiquidity>) -> Result<()> {
    create_quote_token_ata(&ctx)?;
    add_initial_liquidity(&ctx)?;
    Ok(())
}

fn create_quote_token_ata(ctx: &Context<AddClmmLiquidity>) -> Result<()> {
    anchor_spl::associated_token::create(
        CpiContext::new(
            ctx.accounts.associated_token_program.to_account_info(),
            anchor_spl::associated_token::Create {
                payer: ctx.accounts.payer.to_account_info(),
                associated_token: ctx.accounts.quote_token_account.to_account_info(),
                authority: ctx.accounts.payer.to_account_info(),
                mint: ctx.accounts.quote_mint.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: ctx.accounts.quote_token_program.to_account_info(),
            },
        )
    )?;

    Ok(())
}

fn add_initial_liquidity(ctx: &Context<AddClmmLiquidity>) -> Result<()> {
    let params = StakingCalculator::new(
        ctx.accounts.launch_state.total_deposited,
        ctx.accounts.launch_state.sale_allocation,
        ctx.accounts.launch_state.lp_allocation,
    ).get_pool_params();

    let amount_0_max = params.quote_volume as u64;
    let amount_1_max = params.base_volume as u64;

    let liquidity = params.quote_volume / 10;

    anchor_lang::system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.payer.to_account_info(),
                to: ctx.accounts.quote_token_account.to_account_info(),
            },
        ),
        amount_0_max,
    )?;

    anchor_lang::solana_program::program::invoke(
        &anchor_spl::token::spl_token::instruction::sync_native(
            &ctx.accounts.quote_token_program.key(),
            &ctx.accounts.quote_token_account.key(),
        )?,
        &[
            ctx.accounts.quote_token_account.to_account_info(),
        ],
    )?;

    let cpi_accounts = raydium_amm_v3::cpi::accounts::OpenPositionV2 {
        payer: ctx.accounts.payer.to_account_info(),
        position_nft_owner: ctx.accounts.payer.to_account_info(),
        position_nft_mint: ctx.accounts.position_nft_mint.to_account_info(),
        position_nft_account: ctx.accounts.position_nft_account.to_account_info(),
        metadata_account: ctx.accounts.metadata_account.to_account_info(),
        pool_state: ctx.accounts.pool_state.to_account_info(),
        protocol_position: ctx.accounts.protocol_position.to_account_info(),
        tick_array_lower: ctx.accounts.tick_array_lower.to_account_info(),
        tick_array_upper: ctx.accounts.tick_array_upper.to_account_info(),
        personal_position: ctx.accounts.personal_position.to_account_info(),
        token_account_0: ctx.accounts.quote_token_account.to_account_info(),
        token_account_1: ctx.accounts.base_token_ata.to_account_info(),
        token_vault_0: ctx.accounts.quote_vault.to_account_info(),
        token_vault_1: ctx.accounts.base_vault.to_account_info(),
        rent: ctx.accounts.rent.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
        token_program: ctx.accounts.base_token_program.to_account_info(),
        associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
        metadata_program: ctx.accounts.metadata_program.to_account_info(),
        token_program_2022: ctx.accounts.token_2022_program.to_account_info(),
        vault_0_mint: ctx.accounts.quote_mint.to_account_info(),
        vault_1_mint: ctx.accounts.base_mint.to_account_info(),
    };

    let cpi_context = CpiContext::new(ctx.accounts.clmm_program.to_account_info(), cpi_accounts);

    raydium_amm_v3::cpi::open_position_v2(
        cpi_context,
        params.tick_lower_index,
        params.tick_upper_index,
        params.tick_array_lower_start_index,
        params.tick_array_upper_start_index,
        liquidity,
        amount_0_max,
        amount_1_max,
        false,
        None,
    )?;

    Ok(())
}

struct StakingCalculator {
    raised_lamports: u64,
    sale_allocation: u64,
    lp_allocation: u64,
}

struct RaydiumPoolParams {
    tick_lower_index: i32,
    tick_upper_index: i32,
    tick_array_lower_start_index: i32,
    tick_array_upper_start_index: i32,
    base_volume: u128,
    quote_volume: u128,
}

impl StakingCalculator {
    fn new(raised_lamports: u64, sale_allocation: u64, lp_allocation: u64) -> Self {
        Self {
            raised_lamports,
            sale_allocation,
            lp_allocation,
        }
    }

    fn get_pool_params(&self) -> RaydiumPoolParams {
        let tick_lower_index = 0i32;
        let tick_upper_index = 443580i32;

        let tick_spacing = 60i32;
        let tick_array_size = 60i32;
        let ticks_in_array = tick_spacing * tick_array_size;

        let tick_array_lower_start_index = (tick_lower_index / ticks_in_array) * ticks_in_array;
        let tick_array_upper_start_index = (tick_upper_index / ticks_in_array) * ticks_in_array;

        let base_volume = self.lp_allocation as u128 * 1_000_000_000;
        let quote_volume = (base_volume * self.raised_lamports as u128) / (self.sale_allocation as u128 * 1_000_000_000);

        RaydiumPoolParams {
            tick_lower_index,
            tick_upper_index,
            tick_array_lower_start_index,
            tick_array_upper_start_index,
            base_volume,
            quote_volume,
        }
    }
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
