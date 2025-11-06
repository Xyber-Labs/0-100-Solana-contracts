use anchor_lang::prelude::*;

use crate::{constants::SEED_ROOT, errors::ErrorCode as EngineErrorCode, state::EngineConfig};

#[derive(Accounts)]
pub struct UpdateEngineConfig<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_ROOT, b"config"],
        bump
    )]
    pub engine_config: Account<'info, EngineConfig>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateEngineConfigParams {
    pub new_treasury: Option<Pubkey>,
    pub new_creation_fee: Option<u64>,
    pub new_xyber_mint: Option<Pubkey>,
    pub new_admins: Option<[Pubkey; 3]>,
    pub new_threshold: Option<u8>,
}

pub fn update_engine_config(
    ctx: Context<UpdateEngineConfig>,
    params: UpdateEngineConfigParams,
) -> Result<()> {
    let cfg = &mut ctx.accounts.engine_config;

    let signer_set: std::collections::BTreeSet<Pubkey> = ctx
        .remaining_accounts
        .iter()
        .filter(|ai| ai.is_signer)
        .map(|ai| ai.key())
        .collect();

    let mut signed = 0u8;
    for k in cfg.admins.iter() {
        if signer_set.contains(k) {
            signed = signed.saturating_add(1);
        }
    }
    require!((signed as u8) >= cfg.threshold, EngineErrorCode::NotEnoughAdminSigners);

    if let Some(t) = params.new_treasury {
        cfg.treasury = t;
    }

    if let Some(fee) = params.new_creation_fee {
        cfg.creation_fee = fee;
    }

    if let Some(mint) = params.new_xyber_mint {
        require!(mint != Pubkey::default(), EngineErrorCode::InvalidAdminSet);
        cfg.xyber_mint = mint;
    }

    if let Some(admins) = params.new_admins {
        let mut unique: std::collections::BTreeSet<Pubkey> = std::collections::BTreeSet::new();
        for k in admins.iter() {
            require!(*k != Pubkey::default(), EngineErrorCode::InvalidAdminSet);
            unique.insert(*k);
        }
        require!(unique.len() == 3, EngineErrorCode::InvalidAdminSet);
        cfg.admins = admins;
    }

    if let Some(threshold) = params.new_threshold {
        require!(threshold == 2 || threshold == 3, EngineErrorCode::InvalidAdminThreshold);
        cfg.threshold = threshold;
    }

    Ok(())
}


