use anchor_lang::prelude::*;
use crate::errors::ErrorCode as EngineErrorCode;

#[derive(Accounts)]
pub struct ProcessBatch {}

pub fn handler(_ctx: Context<ProcessBatch>, _max_items: u16) -> Result<()> {
    err!(EngineErrorCode::NotSupported)
}
