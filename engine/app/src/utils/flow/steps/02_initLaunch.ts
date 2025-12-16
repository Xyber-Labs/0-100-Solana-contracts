import { FlowStep } from "../step";
import type { FlowContext } from "../types";
import { ComputeBudgetProgram } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

export class InitLaunchStep extends FlowStep {
  constructor() {
    super("[2/10] Initialize Launch");
  }

  async execute(context: FlowContext): Promise<void> {
    const { sdk, provider, config, admin, simConfig, xyberMint, addLog } = context;

    addLog(`[2/10] Initializing Launch...`);

    const balanceBeforeLaunch = await provider.connection.getBalance(admin.publicKey);
    const MINT_RENT = 2039280; 

    // Project ID
    let lastProjectId = 0;
    try {
      const counter: any = await sdk.fetchProjectCounter();
      lastProjectId = (counter?.lastProjectId?.toNumber && counter.lastProjectId.toNumber()) || 0;
    } catch (_) {}
    const projectId = lastProjectId + 1;
    const [testLaunchState] = sdk.getLaunchPdaByProjectId(projectId);
    context.testLaunchState = testLaunchState;

    // Config Calculations
    const estFundingBatches = Math.ceil(simConfig.numUsers / 50);
    const estDepositBatches = Math.ceil(simConfig.numUsers / 50);
    const estSec = estFundingBatches * 1 + estDepositBatches * 2 + 5;
    const estClamped = Math.max(30, Math.min(estSec, 600));
    const cfgSec = typeof config.fundingDurationSeconds === "number" ? config.fundingDurationSeconds : 0;
    const fundingDurationSeconds = Math.max(30, cfgSec, estClamped);

    const baseTotalTokensNum = Number((config as any).baseTotalAllocationTokens ?? 1_000_000_000);
    const DECIMALS_SCALE = new BN(1_000_000_000);
    const baseTotalAllocationBN = new BN(String(baseTotalTokensNum)).mul(DECIMALS_SCALE);
    const saleBpsNum = Number((config as any).saleBasisPoints ?? 0);
    const baseSaleBpsBN = new BN(saleBpsNum);

    const kCap = Math.floor(config.hardCapLamports / config.tauLamports);
    const rosterShardsTotal = (config as any).rosterShardsTotal && (config as any).rosterShardsTotal > 0
      ? Math.min(65535, (config as any).rosterShardsTotal)
      : Math.min(65535, Math.ceil(kCap / Math.max(1, config.rosterShardCap)));

    addLog("launch config: " + JSON.stringify(config));

    // Execute Transaction
    const { initLaunchTx } = await sdk.initLaunchTx({
      creator: admin.publicKey,
      projectId,
      hardCapLamports: new BN(config.hardCapLamports),
      minRaiseLamports: new BN(config.minRaiseLamports),
      perWalletCap: new BN(config.perWalletCap),
      tauLamports: new BN(config.tauLamports),
      baseTotalAllocation: baseTotalAllocationBN,
      baseSaleBasisPoints: baseSaleBpsBN,
      fundingDurationSeconds,
      unlockTimeSec: config.unlockTimeSec,
      rosterShardCap: config.rosterShardCap,
      rosterShardsTotal,
      poolCreationGracePeriodSec: config.poolCreationGracePeriodSec,
      creatorInitialDepositLamports: new BN(config.creatorInitialDepositLamports),
      creatorDailyLamportsLimit: new BN(config.creatorDailyLamportsLimit),
      creatorClaimLockPeriodSec: new BN(config.creatorClaimLockPeriodSec),
      creatorMaxDepositLamports: new BN((config as any).creatorMaxDepositLamports ?? config.creatorInitialDepositLamports),
      provider,
      xyberMint: xyberMint!,
      name: `Lumi Project #${projectId}`,
      symbol: "LUMI",
      uri: "https://ipfs.io/ipfs/QmNb2nS5krQAKq1rMojoGxSu6c5JTgMish4apbP7xCgTVV",
      isMutable: true,
      sellerFeeBasisPoints: 0,
      teamAllocationBasisPoints: (config as any).teamAllocationBasisPoints ?? 1000,
      teamVestingDurationSec: (config as any).teamVestingDurationSec ?? 1,
    });

    const cuInstruction = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });
    initLaunchTx.instructions.unshift(cuInstruction);

    const signature = await provider.sendAndConfirm!(initLaunchTx, []);

    const balanceAfterLaunch = await provider.connection.getBalance(admin.publicKey);
    const grossLaunchCost = balanceBeforeLaunch - balanceAfterLaunch;
    context.metrics.launchTxFees = grossLaunchCost - config.creatorInitialDepositLamports - MINT_RENT;

    addLog(`   -> Launch initialized. Signature: ${signature}`);
    addLog(`   -> Launch PDA: ${testLaunchState.toBase58()}`);

    // Init Team Vesting
    try {
      await sdk.initTeamVesting({ launch: testLaunchState });
      addLog(`   -> Team vesting initialized`);
    } catch (e: any) {
      addLog(`   -> Team vesting init skipped: ${e.message}`);
    }
  }
}
