use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Funding is not active")]
    FundingInactive,
    #[msg("Funding has not ended yet")]
    FundingNotEnded,
    #[msg("Claims are not open")]
    ClaimsNotOpen,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Amount must be multiple of tau")]
    BadAmount,
    #[msg("Per-wallet cap exceeded")]
    DepositCapExceeded,
    #[msg("Insufficient deposit")]
    InsufficientDeposit,
    #[msg("Limit exceeded")]
    LimitExceeded,
    #[msg("Seed missing")]
    SeedMissing,
    #[msg("Selection already finalized")]
    AlreadyFinalized,
    #[msg("Selection not finalized")]
    NotFinalized,
    #[msg("Divisor must be greater than zero")]
    InvalidDivisor,
    #[msg("Already claimed refund")]
    AlreadyRefunded,
    #[msg("No recent blockhashes found in SlotHashes sysvar")]
    NoRecentBlockhashes,
    #[msg("Pool already created")]
    PoolAlreadyCreated,
    #[msg("No valid blockhash found in recent blocks")]
    NoValidBlockhash,
    #[msg("Invalid slot hashes data")]
    InvalidSlotHashesData,
    #[msg("An arithmetic operation overflowed")]
    ArithmeticOverflow,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Invalid mint for ATA")]
    InvalidMint,
    #[msg("Invalid owner for ATA")]
    InvalidOwner,
    #[msg("Invalid authority")]
    InvalidAuthority,
    #[msg("Malformed preset")]
    MalformedPreset,
    #[msg("Preset is disabled")]
    PresetDisabled,
    #[msg("Not enough admin signatures")]
    NotEnoughAdminSigners,
    #[msg("Invalid admin threshold")]
    InvalidAdminThreshold,
    #[msg("Invalid admin set")]
    InvalidAdminSet,
    #[msg("Insufficient fee balance")]
    InsufficientFeeBalance,
    #[msg("Invalid price: must be finite and positive")]
    InvalidPrice,
    #[msg("Price overflow: result exceeds u128::MAX")]
    PriceOverflow,
    #[msg("Bitmap is full")]
    BitmapFull,
    #[msg("Invalid account discriminator")]
    InvalidAccountDiscriminator,
    #[msg("Invalid params")]
    InvalidParams,
    #[msg("Invalid state")]
    InvalidState,
}
