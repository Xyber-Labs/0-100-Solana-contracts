use std::cmp::min;

use anchor_lang::{AnchorDeserialize, AnchorSerialize, Key, prelude::*};
use anchor_spl::token::{Mint, Token, TokenAccount};
use raydium_amm_v3::{libraries::fixed_point_64::Q64, states::TickArrayState};

use crate::{errors::ErrorCode, LaunchState};

pub(crate) struct ClmmOrder<'info> {
    pub(crate) token_mint_0: AccountInfo<'info>,
    pub(crate) token_mint_1: AccountInfo<'info>,
    pub(crate) token_source_0: Option<AccountInfo<'info>>,
    pub(crate) token_source_1: Option<AccountInfo<'info>>,
    pub(crate) token_vault_0: AccountInfo<'info>,
    pub(crate) token_vault_1: AccountInfo<'info>,
    pub(crate) token_program_0: AccountInfo<'info>,
    pub(crate) token_program_1: AccountInfo<'info>,
    pub(crate) sqrt_price: u128,
    pub(crate) price_ratio: f64,
    pub(crate) token_0_supply: u64,
    pub(crate) token_1_supply: u64,
    pub(crate) base_flag: Option<bool>,
    pub(crate) quote_supply: u64,
}

const MYRIAD: u128 = 10000;
const PRICE_GROWING_RATE: f64 = 1.15f64;
pub(crate) const AMMV3_CREATION_RESERVE: u64 = 152_500_000;

impl<'info> ClmmOrder<'info> {
    pub(crate) fn from_inputs(
        launch_state: &Account<'info, LaunchState>,
        quote_mint: &Account<'info, Mint>,
        base_mint: &Account<'info, Mint>,
        quote_vault: &UncheckedAccount<'info>,
        base_vault: &UncheckedAccount<'info>,
        quote_program: &Program<'info, Token>,
        base_program: &Program<'info, Token>,
        base_source: Option<&Account<'info, TokenAccount>>,
        quote_source: Option<&Account<'info, TokenAccount>>,
    ) -> Result<ClmmOrder<'info>> {
        let quote_clmm_supply = min(launch_state.total_deposited, launch_state.hard_cap_lamports)
            .checked_sub(AMMV3_CREATION_RESERVE)
            .expect("quote counted well");

        let base_sale_supply = (launch_state.base_total_allocation as u128)
            .checked_mul(launch_state.base_sale_basis_points as u128)
            .and_then(|v| v.checked_div(MYRIAD))
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        let base_clmm_supply = (launch_state.base_total_allocation as u128)
            .checked_mul(
                MYRIAD
                    .checked_sub(launch_state.base_sale_basis_points as u128)
                    .and_then(|v| v.checked_sub(launch_state.team_allocation_basis_points as u128))
                    .ok_or(ErrorCode::ArithmeticOverflow)?,
            )
            .and_then(|v| v.checked_div(MYRIAD))
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        let base_clmm_supply =
            u64::try_from(base_clmm_supply).map_err(|_| ErrorCode::ArithmeticOverflow)?;

        let price_ratio: f64 =
            quote_clmm_supply as f64 / base_sale_supply as f64 * PRICE_GROWING_RATE;

        let get_sqrt_price = |price: f64| -> Result<u128> {
            require!(price.is_finite() && price > 0.0, crate::errors::ErrorCode::InvalidPrice);
            let sqrt_price = price.sqrt() * Q64 as f64;
            require!(sqrt_price <= u128::MAX as f64, crate::errors::ErrorCode::PriceOverflow);
            Ok(sqrt_price as u128)
        };

        if quote_mint.key() < base_mint.key() {
            let final_price_ratio = 1f64 / price_ratio;
            let sqrt_price_val = get_sqrt_price(final_price_ratio)?;

            Ok(Self {
                token_mint_0: quote_mint.to_account_info(),
                token_mint_1: base_mint.to_account_info(),
                token_source_0: quote_source.map(|a| a.to_account_info()),
                token_source_1: base_source.map(|a| a.to_account_info()),
                token_vault_0: quote_vault.to_account_info(),
                token_vault_1: base_vault.to_account_info(),
                token_program_0: quote_program.to_account_info(),
                token_program_1: base_program.to_account_info(),
                price_ratio: final_price_ratio,
                sqrt_price: sqrt_price_val,
                token_0_supply: quote_clmm_supply,
                token_1_supply: base_clmm_supply,
                base_flag: Some(true),
                quote_supply: quote_clmm_supply,
            })
        } else {
            let sqrt_price_val = get_sqrt_price(price_ratio)?;

            Ok(Self {
                token_mint_0: base_mint.to_account_info(),
                token_mint_1: quote_mint.to_account_info(),
                token_source_0: base_source.map(|a| a.to_account_info()),
                token_source_1: quote_source.map(|a| a.to_account_info()),
                token_vault_0: base_vault.to_account_info(),
                token_vault_1: quote_vault.to_account_info(),
                token_program_0: base_program.to_account_info(),
                token_program_1: quote_program.to_account_info(),
                price_ratio: price_ratio,
                sqrt_price: sqrt_price_val,
                token_0_supply: base_clmm_supply,
                token_1_supply: quote_clmm_supply,
                base_flag: Some(false),
                quote_supply: quote_clmm_supply,
            })
        }
    }
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct LiquidityRange {
    pub tick_array_lower: i32,
    pub tick_array_lower_start_index: i32,
    pub tick_array_upper: i32,
    pub tick_array_upper_start_index: i32,
}

const PRICE_LOWER_EXP: f64 = -5.975;
const PRICE_UPPER_EXP: f64 = 6.0;

pub fn get_liquidity_range_impl(tick_spacing: u16, price_ratio: f64) -> LiquidityRange {
    use raydium_amm_v3::{libraries, libraries::fixed_point_64};

    let price_lower = price_ratio * 10f64.powf(PRICE_LOWER_EXP);
    let price_upper = price_ratio * 10f64.powf(PRICE_UPPER_EXP);

    let sqrt_price_lower_x64 = (price_lower.sqrt() * fixed_point_64::Q64 as f64) as u128;
    let sqrt_price_upper_x64 = (price_upper.sqrt() * fixed_point_64::Q64 as f64) as u128;

    let tick_lower_raw = libraries::get_tick_at_sqrt_price(sqrt_price_lower_x64)
        .expect("Expected to be allowed sqrt price range");
    let tick_upper_raw = libraries::get_tick_at_sqrt_price(sqrt_price_upper_x64)
        .expect("Expected to be allowed sqrt price range");

    let spacing = tick_spacing as i32;
    let tick_array_lower = tick_lower_raw - tick_lower_raw.rem_euclid(spacing);
    let tick_array_upper =
        tick_upper_raw + (spacing - tick_upper_raw.rem_euclid(spacing)) % spacing;

    let tick_array_lower_start_index =
        TickArrayState::get_array_start_index(tick_lower_raw, tick_spacing);
    let tick_array_upper_start_index =
        TickArrayState::get_array_start_index(tick_upper_raw, tick_spacing);

    LiquidityRange {
        tick_array_lower,
        tick_array_lower_start_index,
        tick_array_upper,
        tick_array_upper_start_index,
    }
}
