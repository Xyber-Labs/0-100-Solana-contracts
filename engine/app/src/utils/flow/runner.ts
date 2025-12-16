import type { FlowContext, SimulationConfig } from "./types";
import { FlowStep } from "./step";
import type { LaunchConfig } from "../../types/launch";
import type { EngineClient } from "@xyber-labs/0-100-sdk";
import type { Program } from "@coral-xyz/anchor";
import type { Keypair } from "@solana/web3.js";
import { LaunchStatsCollector } from "../stats/launchStats";

import { SetupStep } from "./steps/01_setup";
import { InitLaunchStep } from "./steps/02_initLaunch";
import { DepositStep } from "./steps/03_deposit";
import { WaitFundingStep } from "./steps/04_waitFunding";
import { FinalizeStep } from "./steps/05_finalize";
import { CreatePoolStep } from "./steps/06_createPool";
import { ClaimsStep } from "./steps/07_claims";
import { CreatorClaimStep } from "./steps/08_creatorClaim";
import { SwapStep } from "./steps/09_swap";
import { AnalysisStep } from "./steps/10_analysis";

export class FlowOrchestrator {
  private steps: FlowStep[] = [];

  constructor(steps: FlowStep[]) {
    this.steps = steps;
  }

  async run(
    sdk: EngineClient,
    program: Program,
    provider: any,
    config: LaunchConfig,
    addLog: (log: string) => void,
    simConfig: SimulationConfig,
    adminSigners: Keypair[] = []
  ): Promise<{
    success: boolean;
    message: string;
    statsRows?: any[];
    statsCsv?: string;
    statsSummary?: any;
  }> {
    // Initialize Context
    const context: FlowContext = {
      sdk,
      program,
      provider,
      config,
      simConfig,
      addLog,
      adminSigners,
      admin: provider.wallet,
      stats: new LaunchStatsCollector(),
      users: [],
      usersWithDeposits: new Map(),
      adminInitialBalance: 0,
      userFundingCost: 0,
      metrics: {
        sealCost: 0,
        sealDetails: [],
        shardsRentRefundLamports: 0,
        closedShardsCount: 0,
        launchTxFees: 0,
        shardCreationCost: 0,
        setSeedCost: 0,
        finalizeCost: 0,
        creatorClaimCost: 0,
        simulationTxFees: 0,
      }
    };

    try {
      try {
        context.adminInitialBalance = await provider.connection.getBalance(context.admin.publicKey);
      } catch (e) {
         context.adminInitialBalance = 0;
      }
      
      context.addLog(`--- Starting Full Flow (Refactored) ---`);
      context.addLog(`Admin wallet: ${context.admin.publicKey.toBase58()}`);

      for (const step of this.steps) {
        await step.execute(context);
      }

      // Finalize Stats
      const statsSummary = context.stats.getSummary();
      const statsRows = context.stats.getRows();
      const statsCsv = context.stats.toCSV();

      context.addLog("\n✅ Full flow finished successfully!");
      return {
        success: true,
        message: "Flow completed successfully",
        statsRows,
        statsCsv,
        statsSummary,
      };

    } catch (error: any) {
      context.addLog(`\n--- FLOW FAILED ---`);
      context.addLog(`Error: ${error.message}`);
      console.error("Full flow error details:", error);
      
      return {
        success: false,
        message: error.message,
        statsRows: context.stats.getRows(),
        statsCsv: context.stats.toCSV(),
        statsSummary: context.stats.getSummary(),
      };
    }
  }
}

export function createDefaultFlow(): FlowOrchestrator {
    return new FlowOrchestrator([
        new SetupStep(),
        new InitLaunchStep(),
        new DepositStep(),
        new WaitFundingStep(),
        new FinalizeStep(),
        new CreatePoolStep(),
        new ClaimsStep(),
        new CreatorClaimStep(),
        new SwapStep(),
        new AnalysisStep(),
    ]);
}
