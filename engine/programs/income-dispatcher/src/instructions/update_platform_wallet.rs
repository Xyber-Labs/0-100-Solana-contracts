use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct UpdatePlatformWallet<'info> {
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

pub fn update_platform_wallet(
    ctx: Context<UpdatePlatformWallet>,
    new_platform_wallet: Pubkey,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.platform_wallet = new_platform_wallet;
    Ok(())
}
