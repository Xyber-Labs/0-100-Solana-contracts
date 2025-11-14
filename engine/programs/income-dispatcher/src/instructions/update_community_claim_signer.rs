use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct UpdateCommunityClaimSigner<'info> {
    #[account(
        mut,
        seeds = [crate::SEED_ROOT, b"config"],
        bump,
    )]
    pub config: Account<'info, crate::state::Config>,

    #[account(
        constraint = admin.key() == config.admin @ crate::errors::ErrorCode::InvalidAuthority
    )]
    pub admin: Signer<'info>,
}

pub fn update_community_claim_signer(
    ctx: Context<UpdateCommunityClaimSigner>,
    new_community_claim_signer: Pubkey,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.community_claim_signer = new_community_claim_signer;
    Ok(())
}
