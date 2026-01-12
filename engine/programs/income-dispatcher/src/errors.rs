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
    #[msg("Invalid pool state account")]
    InvalidPoolState,
    #[msg("Invalid token mint")]
    InvalidTokenMint,
    #[msg("Invalid nonce")]
    InvalidNonce,
    #[msg("Invalid calculator")]
    InvalidCalculator,
    #[msg("Not allowed")]
    NotAllowed,
    #[msg("Serialization error")]
    SerializationError,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Invalid parameter")]
    InvalidParameter,
}
