import { FlowStep } from "../step";
import type { FlowContext } from "../types";
import { runRaydiumSwaps } from "../../raydiumSwaps";

export class SwapStep extends FlowStep {
  constructor() {
    super("[11/10] Raydium Swaps");
  }

  async execute(context: FlowContext): Promise<void> {
    const { simConfig, addLog, provider, sdk, testLaunchState, mintedBaseMint, poolBaseLiquidityUi, poolQuoteLiquidityUi } = context;

    const raydiumSwapsCount = (simConfig as any)?.raydiumSwapsCount ?? 10;
    const raydiumSolPerSwap = (simConfig as any)?.raydiumSolPerSwap ?? 1;

    addLog(`\n------------------------------------`);
    addLog(`--- RAYDIUM SWAP PARAMETERS ---`);
    addLog(`   Swaps count: ${raydiumSwapsCount}`);
    addLog(`   SOL per swap: ${raydiumSolPerSwap}`);
    addLog(`------------------------------------`);

    if (mintedBaseMint && poolBaseLiquidityUi !== null && poolQuoteLiquidityUi !== null && raydiumSwapsCount > 0 && raydiumSolPerSwap > 0) {
        addLog(`\n[11/10] Executing Raydium swaps...`);
        try {
            await runRaydiumSwaps({
                provider,
                sdk,
                launchPda: testLaunchState!,
                baseMint: mintedBaseMint,
                swapsCount: raydiumSwapsCount,
                solPerSwap: raydiumSolPerSwap,
                addLog,
            });
        } catch (e: any) {
            addLog(`\n[11/10] Raydium swaps step failed: ${String(e?.message || e)}`);
        }
    } else {
        addLog(`\n[11/10] Raydium swaps skipped (pool/liquidity unavailable or zero parameters).`);
    }
  }
}

