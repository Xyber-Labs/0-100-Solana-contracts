use anchor_lang::{prelude::*, solana_program::sysvar::rent::Rent};

use crate::errors::ErrorCode;

pub trait Reallocatable {
    fn required_space(&self) -> usize;
}

pub fn realloc_raw<'info>(
    account: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    required_space: usize,
) -> Result<()> {
    let current_space = account.data_len();

    if required_space > current_space {
        let rent = Rent::get()?;
        let new_min_balance = rent.minimum_balance(required_space);
        let current_lamports = account.lamports();
        let diff =
            new_min_balance.checked_sub(current_lamports).ok_or(ErrorCode::ArithmeticOverflow)?;

        **payer.try_borrow_mut_lamports()? =
            payer.lamports().checked_sub(diff).ok_or(ErrorCode::InsufficientFeeBalance)?;
        **account.try_borrow_mut_lamports()? =
            current_lamports.checked_add(diff).ok_or(ErrorCode::ArithmeticOverflow)?;

        account.realloc(required_space, true)?;
    }

    Ok(())
}
