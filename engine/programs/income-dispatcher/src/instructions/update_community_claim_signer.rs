use anchor_lang::prelude::*;

use crate::{errors::ErrorCode, state::Config};

#[derive(Accounts)]
pub struct UpdateCommunityClaimSigner<'info> {
    #[account(address = config.admin @ ErrorCode::InvalidAuthority)]
    pub admin: Signer<'info>,

    #[account(mut, seeds = [crate::SEED_ROOT, b"config"], bump)]
    pub config: Account<'info, Config>,
}

pub fn update_community_claim_signer(
    ctx: Context<UpdateCommunityClaimSigner>,
    new_community_wallet: Pubkey,
) -> Result<()> {
    ctx.accounts.config.community_wallet = new_community_wallet;
    Ok(())
}
