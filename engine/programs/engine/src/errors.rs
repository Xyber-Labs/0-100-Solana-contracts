use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Minimum raise not met")]
    MinRaiseNotMet,
    #[msg("Funding period has ended")]
    FundingPeriodEnded,
    #[msg("Funding period has not ended yet")]
    FundingPeriodNotEnded,
    #[msg("Invalid funding duration (must be 0-5, where 0 = 10 seconds for testing)")]
    InvalidFundingDuration,
    #[msg("Claims are not open")]
    ClaimsNotOpen,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Amount must be multiple of tau")]
    AmountNotMultipleTau,
    #[msg("Per-wallet cap exceeded")]
    PerWalletCapExceeded,
    #[msg("Insufficient deposit")]
    InsufficientDeposit,
    #[msg("Seed already set")]
    SeedAlreadySet,
    #[msg("Seed missing")]
    SeedMissing,
    #[msg("Selection already finalized")]
    AlreadyFinalized,
    #[msg("Selection not finalized")]
    NotFinalized,
    #[msg("Threshold missing")]
    ThresholdMissing,
    #[msg("Tokens per ticket missing")]
    TokensPerTicketMissing,
    #[msg("Invalid tau")]
    InvalidTau,
    #[msg("Invalid K")]
    InvalidK,
    #[msg("Not fully processed")]
    NotFullyProcessed,
    #[msg("Heap not full")]
    HeapNotFull,
    #[msg("User not found in roster")]
    UserNotFoundInRoster,
    #[msg("t out of range")]
    TOutOfRange,
    #[msg("Mapping error")]
    MappingError,
    #[msg("Already claimed refund")]
    AlreadyClaimedRefund,
    #[msg("Already claimed tokens")]
    AlreadyClaimedTokens,
    #[msg("No recent blockhashes found in SlotHashes sysvar")]
    NoRecentBlockhashes,
    #[msg("Pool already created")]
    PoolAlreadyCreated,
    #[msg("No valid blockhash found in recent blocks")]
    NoValidBlockhash,
    #[msg("Invalid N value for hash range calculation (must be between MIN_N and MAX_N)")]
    InvalidNumBlocks,
    #[msg("Mint already exists")]
    MintAlreadyExists,
    #[msg("An arithmetic operation overflowed")]
    ArithmeticOverflow,
}
