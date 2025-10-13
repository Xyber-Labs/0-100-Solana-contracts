use anchor_lang::prelude::borsh::BorshSchema;
use anchor_lang::prelude::*;

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

// Deprecated: ProcessBatch accounts removed in permutation-based flow
