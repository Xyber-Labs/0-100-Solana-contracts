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
  quoteMint?: string;
  ammConfig?: string;
  clmmProgram?: string;
}


