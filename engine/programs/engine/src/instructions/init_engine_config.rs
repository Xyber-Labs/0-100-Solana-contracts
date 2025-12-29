use anchor_lang::prelude::*;

use crate::{constants::SEED_ROOT, errors::ErrorCode as EngineErrorCode, state::EngineConfig};

#[derive(Accounts)]
#[instruction(params: InitEngineConfigParams)]
pub struct InitEngineConfig<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(init, payer = payer, space = 8 + EngineConfig::INIT_SPACE, seeds = [SEED_ROOT, b"config"], bump)]
    pub engine_config: Account<'info, EngineConfig>,

    /// CHECK: PDA for storing SOL to pay for realloc operations (zero-data, program-owned)
    #[account(init, payer = payer, space = 0, seeds = [SEED_ROOT, b"realloc_funds"], bump)]
    pub realloc_funds: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitEngineConfigParams {
    pub treasury: Pubkey,
    pub xyber_mint: Pubkey,
    pub admins: [Pubkey; 3],
    pub threshold: u8,
    pub realloc_fund_lamports: u64,
}

pub fn init_engine_config(
    ctx: Context<InitEngineConfig>,
    params: InitEngineConfigParams,
) -> Result<()> {
    require!(
        params.threshold == 2 || params.threshold == 3,
        EngineErrorCode::InvalidAdminThreshold
    );

    let mut unique: std::collections::BTreeSet<Pubkey> = std::collections::BTreeSet::new();
    for k in params.admins.iter() {
        require!(*k != Pubkey::default(), EngineErrorCode::InvalidAdminSet);
        unique.insert(*k);
    }
    require!(unique.len() == 3, EngineErrorCode::InvalidAdminSet);

    let signer_set: std::collections::BTreeSet<Pubkey> =
        ctx.remaining_accounts.iter().filter(|ai| ai.is_signer).map(|ai| ai.key()).collect();
    let mut signed = 0u8;
    for k in params.admins.iter() {
        if signer_set.contains(k) {
            signed = signed.saturating_add(1);
        }
    }
    require!((signed as u8) >= params.threshold, EngineErrorCode::NotEnoughAdminSigners);

    let cfg = &mut ctx.accounts.engine_config;
    cfg.treasury = params.treasury;
    cfg.xyber_mint = params.xyber_mint;
    cfg.admins = params.admins;
    cfg.threshold = params.threshold;

    let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
        &ctx.accounts.payer.key(),
        &ctx.accounts.realloc_funds.key(),
        params.realloc_fund_lamports,
    );
    anchor_lang::solana_program::program::invoke(
        &transfer_ix,
        &[
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.realloc_funds.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
    )?;

    Ok(())
}
