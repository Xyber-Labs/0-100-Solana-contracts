use anchor_lang::prelude::*;

/// Calculate escrow address for a launch
pub fn escrow_address(launch: Pubkey) -> Pubkey {
    let (address, _) = Pubkey::find_program_address(
        &[b"escrow", launch.as_ref()],
        &crate::ID,
    );
    address
}
