export interface LaunchConfig {
  hardCapLamports: number;
  minRaiseLamports: number;
  perWalletCap: number;
  tauLamports: number;
  saleAllocation: string;
  lpAllocation: number;
  fundingDurationSeconds: number;
  fundingDurationDays?: number;
  unlockTimeSec: number;
  rosterShardCap: number;
  creatorInitialDepositLamports: number;
  creatorDailyLamportsLimit: number;
  creatorClaimLockPeriodSec: number;
  creatorMaxDepositLamports?: number;
  quoteMint?: string;
  ammConfig?: string;
  clmmProgram?: string;
  rosterShardsTotal?: number;
  teamAllocationBasisPoints?: number; // default 1000 (10%)
  teamVestingDurationSec?: number;    // default 1 year; can set to 1 for tests
}


