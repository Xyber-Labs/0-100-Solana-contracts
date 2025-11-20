use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Minimum raise not met")]
    MinRaiseNotMet,
    #[msg("Funding period has ended")]
    FundingPeriodEnded,
    #[msg("Funding period has not started yet")]
    FundingPeriodNotStarted,
    #[msg("Funding period has not ended yet")]
    FundingPeriodNotEnded,
    #[msg("Invalid funding duration (must be 0-5, where 0 = 10 seconds for testing)")]
    InvalidFundingDuration,
    #[msg("Invalid start time")]
    InvalidStartTime,
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
    #[msg("Divisor must be greater than zero")]
    InvalidDivisor,
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
    InvalidNumPartitions,
    #[msg("Invalid slot hashes data")]
    InvalidSlotHashesData,
    #[msg("Roster is full")]
    RosterFull,
    #[msg("Heap capacity exceeded")]
    HeapCapacityExceeded,
    #[msg("Mint already exists")]
    MintAlreadyExists,
    #[msg("An arithmetic operation overflowed")]
    ArithmeticOverflow,
    #[msg("u64 to u32 conversion overflow")]
    U64ConversionOverflow,
    #[msg("Creator reserved tickets exceed capacity")]
    ReservedExceedsCapacity,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Creator initial deposit must be multiple of tau")]
    InvalidCreatorDeposit,
    #[msg("Creator refund already claimed")]
    CreatorRefundAlreadyClaimed,
    #[msg("Invalid mint for ATA")]
    InvalidMint,
    #[msg("Invalid owner for ATA")]
    InvalidOwner,

    #[msg("Invalid authority")]
    InvalidAuthority,

    #[msg("Hard cap must be > 0")]
    InvalidHardCap,
    #[msg("Min raise must be > 0")]
    InvalidMinRaise,
    #[msg("Hard cap must be divisible by tau")]
    HardCapNotDivisibleByTau,
    #[msg("Per-wallet cap must be >= tau")]
    PerWalletCapTooSmall,
    #[msg("Min raise must be <= hard cap")]
    MinRaiseTooHigh,
    #[msg("Creator claim lock period must be > 0")]
    InvalidClaimLockPeriod,

    // New errors for sharded roster / new flow
    #[msg("Operation not supported in current version")]
    NotSupported,
    #[msg("Roster shard is full")]
    RosterShardFull,
    #[msg("Roster finalization order violated")]
    InvalidFinalizeOrder,
    #[msg("Roster shard not finalized")]
    ShardNotFinalized,
    #[msg("Claims cannot be opened before all shards finalized")]
    ShardsNotFullyFinalized,
    #[msg("Roster shard id is out of allowed range")]
    ShardIdOutOfRange,
    #[msg("User has no tokens to claim")]
    NoTokensToClaim,
    #[msg("No distribution rules found for market cap")]
    NoDistributionRules,
    #[msg("Recipient not found in distribution")]
    RecipientNotFound,
    #[msg("Sum of shares in tier must equal 10000 basis points")]
    InvalidShareSum,
    #[msg("Base token decimals must be less than 18")]
    InvalidBaseDecimals,

    #[msg("Pool not created yet")]
    PoolNotCreated,

    #[msg("Team vesting account is missing")]
    TeamVestingMissing,
    #[msg("Team vesting is not started yet")]
    TeamVestingNotStarted,
    #[msg("Team claims are not open yet")]
    TeamClaimsNotOpen,
    #[msg("Claim is too frequent")]
    TeamClaimTooFrequent,

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
}
