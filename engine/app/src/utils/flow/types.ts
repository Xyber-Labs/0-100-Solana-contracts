import type { Program } from "@coral-xyz/anchor";
import type { Keypair, PublicKey } from "@solana/web3.js";
import type { EngineClient } from "@xyber-labs/0-100-sdk";
import type { LaunchConfig } from "../../types/launch";
import type { LaunchStatsCollector } from "../stats/launchStats";
import type { BN } from "@coral-xyz/anchor";

export interface SimulationConfig {
  numUsers: number;
  maxTicketsPerUser: number;
  useTestMintForBase?: boolean;
  raydiumSwapsCount?: number;
  raydiumSolPerSwap?: number;
  minTicketsPerUser?: number;
  ticketsTargetMultiplier?: number;
  useAirdropForUsers?: boolean;
}

export interface UserSimData {
  keypair: Keypair;
  tickets: number;
  depositAmount: BN;
  shardId: number;
}

export interface FlowContext {
  // Inputs
  sdk: EngineClient;
  program: Program;
  provider: any; // AnchorProvider-like
  config: LaunchConfig;
  simConfig: SimulationConfig;
  addLog: (log: string) => void;
  adminSigners: Keypair[];

  // Derived/Global State
  admin: { publicKey: PublicKey; signTransaction: Function; signAllTransactions: Function };
  stats: LaunchStatsCollector;

  // Flow State (populated by steps)
  xyberMint?: PublicKey;
  testLaunchState?: PublicKey;
  mintedBaseMint?: PublicKey;
  poolBaseLiquidityUi?: number;
  poolQuoteLiquidityUi?: number;
  
  // User Data
  users: UserSimData[];
  usersWithDeposits: Map<string, UserSimData>;

  // Metrics
  adminInitialBalance: number;
  userFundingCost: number;
  
  // Shared globals (legacy support for refund/seal costs)
  metrics: {
    sealCost: number;
    sealDetails: any[];
    shardsRentRefundLamports: number;
    closedShardsCount: number;
    launchTxFees: number;
    shardCreationCost: number;
    setSeedCost: number;
    finalizeCost: number;
    creatorClaimCost: number;
    simulationTxFees: number;
  }
}

