use anchor_lang::{prelude::*, solana_program::sysvar::rent::Rent};

use crate::errors::ErrorCode;

pub trait Reallocatable {
    fn required_space(&self) -> usize;
}

pub fn realloc_with_payer<'info, T: AccountSerialize + AccountDeserialize + Clone + Reallocatable>(
    account: &Account<'info, T>,
    payer: &AccountInfo<'info>,
) -> Result<()> {
    let required_space = (**account).required_space();
    let account_info = account.to_account_info();
    realloc_raw(&account_info, payer, required_space)
}

pub fn realloc_raw<'info>(
    account: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    required_space: usize,
) -> Result<()> {
    let current_space = account.data_len();

    if required_space > current_space {
        account.realloc(required_space, false)?;

        let rent = Rent::get()?;
        let new_min_balance = rent.minimum_balance(required_space);
        let current_lamports = account.lamports();
        let diff = new_min_balance
            .checked_sub(current_lamports)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        **payer.try_borrow_mut_lamports()? = payer
            .lamports()
            .checked_sub(diff)
            .ok_or(ErrorCode::InsufficientFeeBalance)?;
        **account.try_borrow_mut_lamports()? = current_lamports
            .checked_add(diff)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
    }

    Ok(())
}
