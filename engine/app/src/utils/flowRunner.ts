import { Program } from "@coral-xyz/anchor";
import type { LaunchConfig } from "../types/launch";
import { Keypair } from "@solana/web3.js";
import type { EngineClient } from "@xyber-labs/0-100-sdk";
import type { LaunchSummary, LaunchUserRow } from "./stats/launchStats";
import { createDefaultFlow } from "./flow/runner";
import type { SimulationConfig } from "./flow/types";

export type { SimulationConfig };

export async function runFullFlow(
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
  statsRows?: LaunchUserRow[];
  statsCsv?: string;
  statsSummary?: LaunchSummary;
}> {
  const orchestrator = createDefaultFlow();
  return await orchestrator.run(sdk, program, provider, config, addLog, simConfig, adminSigners);
}
