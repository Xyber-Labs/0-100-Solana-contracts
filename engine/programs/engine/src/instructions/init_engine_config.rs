use anchor_lang::prelude::*;

use crate::{constants::SEED_ROOT, errors::ErrorCode as EngineErrorCode, state::EngineConfig};

#[derive(Accounts)]
#[instruction(params: InitEngineConfigParams)]
pub struct InitEngineConfig<'info> {
    #[account( signer, mut, constraint = engine_config.multisig == Pubkey::default() && multisig.key() == DEPLOYER || engine_config.multisig == multisig.key() @ EngineErrorCode::Unauthorized)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + EngineConfig::INIT_SPACE,
        seeds = [SEED_ROOT, b"config"],
        bump
    )]
    pub engine_config: Account<'info, EngineConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitEngineConfigParams {
    pub treasury: Pubkey,
    pub creation_fee: u64,
    pub xyber_mint: Pubkey,
    pub admins: [Pubkey; 3],
    pub threshold: u8,
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
    cfg.creation_fee = params.creation_fee;
    cfg.xyber_mint = params.xyber_mint;
    cfg.admins = params.admins;
    cfg.threshold = params.threshold;

    Ok(())
}
