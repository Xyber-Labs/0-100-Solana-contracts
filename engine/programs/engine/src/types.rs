use anchor_lang::prelude::*;
use anchor_lang::prelude::borsh::BorshSchema;

// -------------------------------
// Helper Types and Structures
// -------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone, BorshSchema, InitSpace)]
pub struct HeapEntry {
    pub score: u128,
    pub wallet: Pubkey,
    pub local_j: u32,
}

// -------------------------------
// Instruction Context Structures
// -------------------------------

#[derive(Accounts)]
pub struct ProcessBatch<'info> {
    #[account(mut)]
    pub launch_state: Account<'info, crate::state::LaunchState>,
    #[account(
        mut,
        seeds = [crate::SEED_ROOT, b"selection", launch_state.key().as_ref()],
        bump,
        constraint = selection_state.launch == launch_state.key(),
    )]
    pub selection_state: Account<'info, crate::state::SelectionState>,
    #[account(
        mut,
        seeds = [crate::SEED_ROOT, b"roster", launch_state.key().as_ref()],
        bump,
    )]
    pub roster: Account<'info, crate::state::Roster>,
}
