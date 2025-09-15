use anchor_lang::prelude::*;

declare_id!("HMVJWXWhpxEWWGhvLHYnTvkmYJcA819jAxw3EgdNYiYb");

#[program]
pub mod engine {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
