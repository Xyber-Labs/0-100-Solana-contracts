use crate::errors::ErrorCode as EngineErrorCode;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct ProcessBatch<'info> {
    pub system_program: Program<'info, System>,
}

pub fn process_batch(_ctx: Context<ProcessBatch>, _max_items: u16) -> Result<()> {
    err!(EngineErrorCode::NotSupported)
}
