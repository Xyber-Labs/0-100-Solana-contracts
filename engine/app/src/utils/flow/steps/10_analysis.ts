import { FlowStep } from "../step";
import type { FlowContext } from "../types";

export class AnalysisStep extends FlowStep {
  constructor() {
    super("Analysis & Summary");
  }

  async execute(context: FlowContext): Promise<void> {
    const { addLog, metrics, admin, adminInitialBalance, userFundingCost, config, testLaunchState, sdk } = context;
    const LAMPORTS_PER_SOL = 1_000_000_000;
    const MINT_RENT = 2039280;

    const adminFinalBalance = await context.provider.connection.getBalance(admin.publicKey);
    const totalSpentByAdmin = adminInitialBalance - adminFinalBalance;

    let totalSOLCollected = 0;
    try {
        const launchAtEnd = await sdk.fetchLaunch(testLaunchState!);
        totalSOLCollected = launchAtEnd.totalDeposited.toNumber();
    } catch (_) {}

    const netFundingCost = userFundingCost - totalSOLCollected;
    const trueOperationalCost = metrics.launchTxFees + metrics.shardCreationCost + metrics.setSeedCost + metrics.finalizeCost + metrics.sealCost + metrics.creatorClaimCost;
    const totalFeesPaid = totalSpentByAdmin - netFundingCost - config.creatorInitialDepositLamports - MINT_RENT;
    const simulationTxFees = totalFeesPaid - trueOperationalCost;

    addLog(`\n--- COST ANALYSIS ---`);
    addLog(`   Admin balance before test: ${adminInitialBalance / LAMPORTS_PER_SOL} SOL`);
    addLog(`   Admin balance after test: ${adminFinalBalance / LAMPORTS_PER_SOL} SOL`);
    addLog(`   Total SOL spent by admin: ${(totalSpentByAdmin / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

    addLog(`\n   --- True Operational Cost (Production Estimate) ---`);
    addLog(`     -> Initial launch (tx fees): ${(metrics.launchTxFees / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    addLog(`     -> Roster shard creation:    ${(metrics.shardCreationCost / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    addLog(`     -> Cranking operations:      ${((metrics.setSeedCost + metrics.finalizeCost) / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    addLog(`     -> Creator claims:           ${(metrics.creatorClaimCost / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    addLog(`     --------------------------------------------------`);
    addLog(`     -> TOTAL OPERATIONAL COST:   ${(trueOperationalCost / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

    addLog(`\n   --- Simulation-Specific Items ---`);
    addLog(`     -> User funding tx fees:     ${(simulationTxFees / LAMPORTS_PER_SOL).toFixed(6)} SOL (approx)`);
    addLog(`     -> Net simulation funding:   ${(netFundingCost / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

    addLog(`\n   --- Rent Refund Summary ---`);
    addLog(`     -> Total rent returned:      ${(metrics.shardsRentRefundLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    addLog(`     -> Net operational cost:     ${(Math.max(0, trueOperationalCost - metrics.shardsRentRefundLamports) / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    
    addLog(`--- END COST ANALYSIS ---`);
  }
}

