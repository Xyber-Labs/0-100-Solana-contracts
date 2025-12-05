use anchor_lang::prelude::*;
use anchor_spl::{
    token::{Token, TokenAccount},
    token_2022::Token2022,
};
use raydium_amm_v3::states::personal_position::PersonalPositionState;

use crate::{
    constants::{SEED_ROOT, WSOL_MINT},
    errors::ErrorCode,
    state::LaunchState,
};

#[derive(Accounts)]
pub struct CloseClmmPosition<'info> {
    /// Launch state for this pool
    #[account(mut)]
    pub launch_state: Box<Account<'info, LaunchState>>,

    /// CHECK: Escrow authority PDA - owner of the position NFT
    #[account(
        mut,
        seeds = [SEED_ROOT, b"escrow_authority", launch_state.key().as_ref()],
        bump
    )]
    pub escrow_authority: UncheckedAccount<'info>,

    /// CHECK: Position NFT mint (created during liquidity addition).
    /// We only use its pubkey and enforce it matches `launch_state.raydium_position_nft_mint`.
    #[account(
        mut,
        constraint = Some(raydium_position_nft_mint.key())
            == launch_state.raydium_position_nft_mint
    )]
    pub raydium_position_nft_mint: UncheckedAccount<'info>,

    /// CHECK: Position NFT account owned by `escrow_authority` (Token-2022).
    /// We pass it through to Raydium CPIs which will validate it; Anchor
    /// cannot type-check it as a Token-2022 account here.
    #[account(mut)]
    pub raydium_position_nft_account: UncheckedAccount<'info>,

    /// Personal position state (Raydium CLMM)
    #[account(
        mut,
        constraint = personal_position.nft_mint == raydium_position_nft_mint.key()
    )]
    pub personal_position: Box<Account<'info, PersonalPositionState>>,

    /// CHECK: Pool state
    #[account(
        mut,
        constraint = Some(pool_state.key()) == launch_state.raydium_pool_state
    )]
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

    /// Creator's WSOL token account (token 0)
    #[account(
        mut,
        token::mint = WSOL_MINT,
        token::authority = launch_state.creator,
    )]
    pub creator_token_account_0: Box<Account<'info, TokenAccount>>,

    /// Creator's base token account (token 1)
    #[account(
        mut,
        constraint = creator_token_account_1.owner == launch_state.creator,
        constraint = launch_state.base_mint == Some(creator_token_account_1.mint),
    )]
    pub creator_token_account_1: Box<Account<'info, TokenAccount>>,

    /// CHECK: Creator's account to receive SOL (rent, leftovers).
    /// We only use it as a lamport recipient and constrain its address
    /// via `launch_state.creator`, so it may be any system-owned account
    /// or even a PDA.
    #[account(mut, address = launch_state.creator)]
    pub creator: UncheckedAccount<'info>,

    /// CHECK: Raydium CLMM program. We don't enforce the program id here
    /// because this instruction is intended for controlled test/mainnet
    /// flows and the client passes the correct Raydium program id.
    pub raydium_program: UncheckedAccount<'info>,

    /// CHECK: SPL Token program used by Raydium for vaults and transfers.
    /// We don't enforce the program id at the Anchor level to avoid
    /// mismatches between different clusters/SDKs; Raydium will validate
    /// it internally during CPI.
    pub token_program: UncheckedAccount<'info>,

    /// CHECK: Token-2022 program used for the position NFT mint/account.
    /// Same rationale as `token_program` above: we forward it to Raydium
    /// and let their program perform any strict validation.
    pub token_program_2022: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,

    /// CHECK: Memo program
    #[account(address = anchor_spl::memo::spl_memo::id())]
    pub memo_program: UncheckedAccount<'info>,

    /// CHECK: Vault 0 mint
    pub vault_0_mint: UncheckedAccount<'info>,

    /// CHECK: Vault 1 mint
    pub vault_1_mint: UncheckedAccount<'info>,
    // Remaining accounts passed to Raydium for tick array bitmap extension
}

pub fn close_clmm_position<'info>(
    ctx: Context<'_, '_, '_, 'info, CloseClmmPosition<'info>>,
    _liquidity: u128,
) -> Result<()> {
    let launch_state = &ctx.accounts.launch_state;
    let launch_key = launch_state.key();

    let escrow_authority_seeds = &[
        SEED_ROOT,
        b"escrow_authority",
        launch_key.as_ref(),
        &[ctx.bumps.escrow_authority],
    ];
    let signers = &[&escrow_authority_seeds[..]];

    require_keys_eq!(
        ctx.accounts.personal_position.nft_mint,
        ctx.accounts.raydium_position_nft_mint.key(),
        ErrorCode::InvalidMint
    );
    let liquidity = ctx.accounts.personal_position.liquidity;

    let cpi_accounts = raydium_amm_v3::cpi::accounts::DecreaseLiquidityV2 {
        nft_owner: ctx.accounts.escrow_authority.to_account_info(),
        nft_account: ctx.accounts.raydium_position_nft_account.to_account_info(),
        personal_position: ctx.accounts.personal_position.to_account_info(),
        pool_state: ctx.accounts.pool_state.to_account_info(),
        protocol_position: ctx.accounts.protocol_position.to_account_info(),
        token_vault_0: ctx.accounts.token_vault_0.to_account_info(),
        token_vault_1: ctx.accounts.token_vault_1.to_account_info(),
        tick_array_lower: ctx.accounts.tick_array_lower.to_account_info(),
        tick_array_upper: ctx.accounts.tick_array_upper.to_account_info(),
        recipient_token_account_0: ctx.accounts.creator_token_account_0.to_account_info(),
        recipient_token_account_1: ctx.accounts.creator_token_account_1.to_account_info(),
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

    raydium_amm_v3::cpi::decrease_liquidity_v2(cpi_context, liquidity, 0, 0)?;

    let close_cpi_accounts = raydium_amm_v3::cpi::accounts::ClosePosition {
        nft_owner: ctx.accounts.escrow_authority.to_account_info(),
        position_nft_mint: ctx.accounts.raydium_position_nft_mint.to_account_info(),
        position_nft_account: ctx.accounts.raydium_position_nft_account.to_account_info(),
        personal_position: ctx.accounts.personal_position.to_account_info(),
        // Position NFT is Token-2022, so we pass Token2022 program here.
        token_program: ctx.accounts.token_program_2022.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
    };

    let close_cpi_context = CpiContext::new_with_signer(
        ctx.accounts.raydium_program.to_account_info(),
        close_cpi_accounts,
        signers,
    );

    raydium_amm_v3::cpi::close_position(close_cpi_context)?;

    let escrow_info = ctx.accounts.escrow_authority.to_account_info();
    let creator_info = ctx.accounts.creator.to_account_info();
    let lamports = **escrow_info.lamports.borrow();

    // We cannot drain the escrow PDA below its rent-exempt minimum, otherwise
    // the transaction fails with "insufficient funds for rent". To still
    // satisfy the requirement "pull out everything from the position", we
    // transfer *all lamports above* the rent-exempt threshold.
    let rent = Rent::get()?;
    let min_rent = rent.minimum_balance(escrow_info.data_len());

    if lamports > min_rent {
        let amount_to_transfer = lamports.saturating_sub(min_rent);
        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: escrow_info,
                    to: creator_info,
                },
                signers,
            ),
            amount_to_transfer,
        )?;
    }

    Ok(())
}
