use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::Token,
    token_interface::{transfer as spl_if_transfer, Mint as InterfaceMint, TokenAccount, TokenInterface, Transfer},
};

use crate::{errors::ErrorCode, EscrowAccount, LaunchState, SEED_ROOT};

#[derive(Accounts)]
pub struct AddClmmLiquidity<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Executable account for the Raydium program
    #[account(executable)]
    pub raydium_program: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = launch_state.clmm_pool.is_some() @ ErrorCode::PoolNotCreated,
    )]
    pub launch_state: Account<'info, LaunchState>,

    #[account(
        constraint = launch_state.clmm_base_mint == Some(base_mint.key()),
        mint::token_program = base_token_program
    )]
    pub base_mint: Box<InterfaceAccount<'info, InterfaceMint>>,

    #[account(mut, seeds = [SEED_ROOT, b"escrow", launch_state.key().as_ref()], bump)]
    pub escrow: Account<'info, EscrowAccount>,

    /// CHECK: Fee payer PDA - system-owned account for paying system operations
    /// This account must be initialized as a system account (space=0, owner=SystemProgram)
    #[account(
        mut,
        seeds = [SEED_ROOT, b"fee_payer", launch_state.key().as_ref()],
        bump,
        constraint = *fee_payer_pda.owner == System::id() @ ErrorCode::InvalidAccountOwner,
        constraint = fee_payer_pda.data_is_empty() @ ErrorCode::AccountHasData
    )]
    pub fee_payer_pda: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [escrow.key().as_ref(), base_token_program.key().as_ref(), base_mint.key().as_ref()],
        bump,
        seeds::program = associated_token_program.key()
    )]
    pub base_escrow_ata: Box<InterfaceAccount<'info, TokenAccount>>,


    #[account(
        mint::token_program = quote_token_program,
        address = anchor_lang::solana_program::pubkey ! ("So11111111111111111111111111111111111111112")
    )]
    pub quote_mint: Box<InterfaceAccount<'info, InterfaceMint>>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = quote_mint,
        associated_token::authority = escrow,
        associated_token::token_program = quote_token_program
    )]
    pub wsol_escrow_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    // Temporary user ATAs (executor) to satisfy SPL owner checks inside Raydium CPI
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = base_mint,
        associated_token::authority = payer,
        associated_token::token_program = base_token_program
    )]
    pub base_user_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = quote_mint,
        associated_token::authority = payer,
        associated_token::token_program = quote_token_program
    )]
    pub wsol_user_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_2022_program: Interface<'info, TokenInterface>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub base_token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

/// Adds initial liquidity to Raydium CLMM pool
///
/// Requires 400,000-600,000 compute units due to complex CPI operations with Raydium.
/// Caller must add ComputeBudgetProgram::setComputeUnitLimit instruction to transaction.
pub fn add_clmm_liquidity<'info>(
    ctx: Context<'_, '_, '_, 'info, AddClmmLiquidity<'info>>,
) -> Result<()> {
    let params = StakingCalculator::new(
        ctx.accounts.launch_state.total_deposited,
        ctx.accounts.launch_state.sale_allocation,
        ctx.accounts.launch_state.lp_allocation,
    )
    .get_pool_params()?;

    let launch_key = ctx.accounts.launch_state.key();
    let escrow_bump = ctx.bumps.escrow;
    
    let escrow_seeds: &[&[u8]] = &[
        SEED_ROOT,
        b"escrow",
        launch_key.as_ref(),
        &[escrow_bump],
    ];

    // Move funds from escrow ATAs into payer ATAs so SPL owner matches signer
    let signer_slices: &[&[u8]] = escrow_seeds;
    let signer_vec: &[&[&[u8]]] = &[signer_slices];
    if ctx.accounts.base_escrow_ata.amount > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.base_escrow_ata.to_account_info(),
            to: ctx.accounts.base_user_ata.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.base_token_program.to_account_info(),
            cpi_accounts,
            signer_vec,
        );
        spl_if_transfer(cpi_ctx, ctx.accounts.base_escrow_ata.amount)?;
    }
    if ctx.accounts.wsol_escrow_ata.amount > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.wsol_escrow_ata.to_account_info(),
            to: ctx.accounts.wsol_user_ata.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.quote_token_program.to_account_info(),
            cpi_accounts,
            signer_vec,
        );
        spl_if_transfer(cpi_ctx, ctx.accounts.wsol_escrow_ata.amount)?;
    }

    // TEMP: relax preconditions to simplify local bring-up
    let _state = &mut ctx.accounts.launch_state;

    // Invoke CPI and obtain the position NFT mint that was used/created
    let position_nft_mint = invoke_raydium_cpi(&ctx, params, escrow_seeds)?;

    let state = &mut ctx.accounts.launch_state;
    // Guard against overwriting with a different mint on re-entry
    require!(
        state.clmm_position_mint.is_none() || state.clmm_position_mint == Some(position_nft_mint),
        ErrorCode::PositionMintMismatch
    );
    state.clmm_position_mint = Some(position_nft_mint);
    state.claims_open = true;
    state.claims_opened_at = Some(Clock::get()?.unix_timestamp);

    Ok(())
}

fn invoke_raydium_cpi<'info>(
    ctx: &Context<'_, '_, '_, 'info, AddClmmLiquidity<'info>>,
    params: RaydiumPoolParams,
    escrow_seeds: &[&[u8]],
) -> Result<Pubkey> {
    let rem_accounts = &mut ctx.remaining_accounts.iter();
    let raydium_pool_state = next_account_info(rem_accounts)?; // 0
    let raydium_quote_vault = next_account_info(rem_accounts)?;
    let raydium_base_vault = next_account_info(rem_accounts)?;
    let raydium_position_nft_mint = next_account_info(rem_accounts)?;
    let raydium_position_nft_account = next_account_info(rem_accounts)?;
    let raydium_metadata_account = next_account_info(rem_accounts)?;
    let raydium_personal_position = next_account_info(rem_accounts)?;
    let raydium_protocol_position = next_account_info(rem_accounts)?;
    let raydium_tick_array_lower = next_account_info(rem_accounts)?;
    let raydium_tick_array_upper = next_account_info(rem_accounts)?;
    let metadata_program = next_account_info(rem_accounts)?;

    // Use user ATA balances (moved from escrow) as amounts going into the pool
    let quote_amount = ctx.accounts.wsol_user_ata.amount;
    let base_amount = ctx.accounts.base_user_ata.amount;

    let order = TokenOrder::new(
        &ctx.accounts.quote_mint.to_account_info(),
        &ctx.accounts.base_mint.to_account_info(),
        raydium_quote_vault,
        raydium_base_vault,
        &ctx.accounts.wsol_user_ata.to_account_info(),
        &ctx.accounts.base_user_ata.to_account_info(),
        quote_amount,
        base_amount,
    );

    // Choose conservative liquidity so required token amounts fit within caps
    let min_side = core::cmp::min(quote_amount, base_amount);
    let liquidity = core::cmp::max(1, min_side / 1_000);

    // Debug logs to verify CPI account mapping and keys
    msg!("[AddClmmLiquidity] payer...............: {}", ctx.accounts.payer.key());
    msg!("[AddClmmLiquidity] escrow..............: {}", ctx.accounts.escrow.key());
    msg!("[AddClmmLiquidity] fee_payer_pda.......: {}", ctx.accounts.fee_payer_pda.key());
    msg!("[AddClmmLiquidity] wsol_escrow_ata.....: {}", ctx.accounts.wsol_escrow_ata.key());
    msg!("[AddClmmLiquidity] base_escrow_ata.....: {}", ctx.accounts.base_escrow_ata.key());
    msg!("[AddClmmLiquidity] position_nft_owner..: {}", ctx.accounts.payer.key());
    msg!("[AddClmmLiquidity] CPI payer...........: {}", ctx.accounts.payer.key());

    // TEMP: trust client-provided start indices to avoid local seeds drift
    let lower_start_idx = params.tick_array_lower_start_index;
    let upper_start_idx = params.tick_array_upper_start_index;

    let cpi_accounts = raydium_amm_v3::cpi::accounts::OpenPositionV2 {
        payer: ctx.accounts.payer.to_account_info(),
        position_nft_owner: ctx.accounts.payer.to_account_info(),
        position_nft_mint: raydium_position_nft_mint.clone(),
        position_nft_account: raydium_position_nft_account.clone(),
        metadata_account: raydium_metadata_account.clone(),
        pool_state: raydium_pool_state.clone(),
        protocol_position: raydium_protocol_position.clone(),
        tick_array_lower: raydium_tick_array_lower.clone(),
        tick_array_upper: raydium_tick_array_upper.clone(),
        personal_position: raydium_personal_position.clone(),
        token_account_0: order.token_account_0,
        token_account_1: order.token_account_1,
        token_vault_0: order.token_vault_0,
        token_vault_1: order.token_vault_1,
        rent: ctx.accounts.rent.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
        token_program: ctx.accounts.base_token_program.to_account_info(),
        associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
        metadata_program: metadata_program.clone(),
        token_program_2022: ctx.accounts.token_2022_program.to_account_info(),
        vault_0_mint: order.token_mint_0,
        vault_1_mint: order.token_mint_1,
    };

    // Build CPI context (no PDA signers needed; token authority = payer on user ATAs)
    let cpi_context = CpiContext::new(
        ctx.accounts.raydium_program.to_account_info(),
        cpi_accounts,
    )
    .with_remaining_accounts(ctx.remaining_accounts.to_vec());

    raydium_amm_v3::cpi::open_position_v2(
        cpi_context,
        params.tick_lower_index,
        params.tick_upper_index,
        lower_start_idx,
        upper_start_idx,
        u128::from(liquidity),
        u64::MAX,
        u64::MAX,
        false,
        None,
    )?;
    // Move leftovers back: payer authority signs
    if ctx.accounts.base_user_ata.amount > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.base_user_ata.to_account_info(),
            to: ctx.accounts.base_escrow_ata.to_account_info(),
            authority: ctx.accounts.payer.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.base_token_program.to_account_info(),
            cpi_accounts,
        );
        spl_if_transfer(cpi_ctx, ctx.accounts.base_user_ata.amount)?;
    }
    if ctx.accounts.wsol_user_ata.amount > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.wsol_user_ata.to_account_info(),
            to: ctx.accounts.wsol_escrow_ata.to_account_info(),
            authority: ctx.accounts.payer.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.quote_token_program.to_account_info(),
            cpi_accounts,
        );
        spl_if_transfer(cpi_ctx, ctx.accounts.wsol_user_ata.amount)?;
    }
    Ok(raydium_position_nft_mint.key())
}

// TODO (@xykeeper) to be refined within the other issue processing
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
    base_volume: u64,
    quote_volume: u64,
}

impl StakingCalculator {
    fn new(raised_lamports: u64, sale_allocation: u64, lp_allocation: u64) -> Self {
        Self {
            raised_lamports,
            sale_allocation,
            lp_allocation,
        }
    }

    fn get_pool_params(&self) -> Result<RaydiumPoolParams> {
        // Wide range: approximate full protocol range for chosen spacing
        // Raydium v3 typical extremes are around [-443_580, 443_580] for spacing=60
        const MIN_TICK: i32 = -443_580;
        const MAX_TICK: i32 = 443_580;

        let tick_lower_index = MIN_TICK;
        let tick_upper_index = MAX_TICK;

        let tick_spacing = 60i32;
        let tick_array_size = 60i32;
        let ticks_in_array = tick_spacing * tick_array_size;

        // floor_div for negatives so arrays align correctly
        let floor_div = |a: i32, b: i32| -> i32 {
            if a >= 0 { a / b } else { -(((-a) + b - 1) / b) }
        };

        let tick_array_lower_start_index = floor_div(tick_lower_index, ticks_in_array) * ticks_in_array;
        let tick_array_upper_start_index = floor_div(tick_upper_index, ticks_in_array) * ticks_in_array;

        let base_volume = self.lp_allocation;
        let quote_volume = u128::from(self.lp_allocation)
            .checked_mul(u128::from(self.raised_lamports))
            .and_then(|v| v.checked_div(u128::from(self.sale_allocation)))
            .and_then(|v| u64::try_from(v).ok())
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        Ok(RaydiumPoolParams {
            tick_lower_index,
            tick_upper_index,
            tick_array_lower_start_index,
            tick_array_upper_start_index,
            base_volume,
            quote_volume,
        })
    }
}

struct TokenOrder<'info> {
    token_mint_0: AccountInfo<'info>,
    token_mint_1: AccountInfo<'info>,
    token_vault_0: AccountInfo<'info>,
    token_vault_1: AccountInfo<'info>,
    token_account_0: AccountInfo<'info>,
    token_account_1: AccountInfo<'info>,
    amount_0: u64,
    amount_1: u64,
}

impl<'info> TokenOrder<'info> {
    fn new(
        quote_mint: &AccountInfo<'info>,
        base_mint: &AccountInfo<'info>,
        quote_vault: &AccountInfo<'info>,
        base_vault: &AccountInfo<'info>,
        quote_account: &AccountInfo<'info>,
        base_account: &AccountInfo<'info>,
        quote_amount: u64,
        base_amount: u64,
    ) -> Self {
        if quote_mint.key() < base_mint.key() {
            Self {
                token_mint_0: quote_mint.clone(),
                token_mint_1: base_mint.clone(),
                token_vault_0: quote_vault.clone(),
                token_vault_1: base_vault.clone(),
                token_account_0: quote_account.clone(),
                token_account_1: base_account.clone(),
                amount_0: quote_amount,
                amount_1: base_amount,
            }
        } else {
            Self {
                token_mint_0: base_mint.clone(),
                token_mint_1: quote_mint.clone(),
                token_vault_0: base_vault.clone(),
                token_vault_1: quote_vault.clone(),
                token_account_0: base_account.clone(),
                token_account_1: quote_account.clone(),
                amount_0: base_amount,
                amount_1: quote_amount,
            }
        }
    }
}
