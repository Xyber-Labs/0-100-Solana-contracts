use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("An arithmetic operation overflowed")]
    ArithmeticOverflow,
    #[msg("Invalid base decimals")]
    InvalidBaseDecimals,
    #[msg("No distribution rules found for market cap")]
    NoDistributionRules,
    #[msg("Recipient not found in distribution")]
    RecipientNotFound,
    #[msg("Sum of shares in tier must equal 10000 basis points")]
    InvalidShareSum,
    #[msg("Income calculator not set")]
    IncomeCalculatorNotSet,
    #[msg("Invalid pool state account")]
    InvalidPoolState,
    #[msg("Invalid token mint")]
    InvalidTokenMint,
    #[msg("Invalid authority")]
    InvalidAuthority,
    #[msg("Invalid project id")]
    InvalidProjectId,
    #[msg("Invalid nonce")]
    InvalidNonce,
}
