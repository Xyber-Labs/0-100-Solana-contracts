use crate::errors::ErrorCode as EngineErrorCode;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct ProcessBatch {}

pub fn handler(_ctx: Context<ProcessBatch>, _max_items: u16) -> Result<()> {
    err!(EngineErrorCode::NotSupported)
}
