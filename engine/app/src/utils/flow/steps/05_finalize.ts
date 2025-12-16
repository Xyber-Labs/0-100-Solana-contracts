import { FlowStep } from "../step";
import type { FlowContext } from "../types";
import { ComputeBudgetProgram, PublicKey } from "@solana/web3.js";

export class FinalizeStep extends FlowStep {
  constructor() {
    super("[5-6/10] Finalize & Seal");
  }

  async execute(context: FlowContext): Promise<void> {
    const { sdk, provider, addLog, testLaunchState, program, admin } = context;
    if (!testLaunchState) throw new Error("Launch state not initialized");

    const balanceBeforeSetSeed = await provider.connection.getBalance(admin.publicKey);

    addLog(`\n[5/10] Setting VRF Seed...`);
    {
      let seeded = false;
      for (let i = 0; i < 60; i++) {
        try {
          await sdk.setSeed({ launch: testLaunchState });
          seeded = true;
          break;
        } catch (e: any) {
          const msg = (e && e.message) ? String(e.message) : "";
          if (msg.includes("Funding period has not ended") || msg.includes("FundingPeriodNotEnded") || msg.includes("6002")) {
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
          throw e;
        }
      }
      if (!seeded) throw new Error("Timeout waiting for funding period to end on-chain");
      addLog("   -> VRF seed set.");
    }

    const balanceAfterSetSeed = await provider.connection.getBalance(admin.publicKey);
    context.metrics.setSeedCost = balanceBeforeSetSeed - balanceAfterSetSeed;

    addLog(`\n[6/10] Finalizing roster shards...`);
    const launchAfterDeposits: any = await sdk.fetchLaunch(testLaunchState);
    const totalShards: number = Number(launchAfterDeposits.rosterShards ?? 0);
    const balanceBeforeFinalize = await provider.connection.getBalance(admin.publicKey);

    for (let i = 1; i <= totalShards; i++) {
      try {
        await sdk.initRosterShard({ launch: testLaunchState, shardId: i });
      } catch (_) { /* ignore */ }
      
      await sdk.finalizeRosterShard({ launch: testLaunchState, shardId: i });
      addLog(`   -> Shard ${i}/${totalShards} finalized.`);
    }

    const balanceAfterFinalize = await provider.connection.getBalance(admin.publicKey);
    context.metrics.finalizeCost = balanceBeforeFinalize - balanceAfterFinalize;
    
    addLog(`\n[6.5/10] Sealing and closing roster shards...`);
    
    const launch: any = await sdk.fetchLaunch(testLaunchState);
    const finalTotalShards: number = Number(launch.rosterShards ?? 0);

    for (let shardId = 1; shardId <= finalTotalShards; shardId++) {
        const [rosterShardPda] = sdk.getRosterShardPda(testLaunchState, shardId);
        let shardAcc: any = null;
        try {
          shardAcc = await (program.account as any).rosterShard.fetch(rosterShardPda);
        } catch (_) {
          shardAcc = null;
        }

        const wallets: PublicKey[] = (shardAcc?.wallets as PublicKey[]) || [];
        const MAX_UNITS = 1_400_000;
        const MAX_BATCH = 24; 
        let batchSize = Math.min(20, MAX_BATCH);
        
        const sealBefore = await provider.connection.getBalance(admin.publicKey);
        let batches = 0;

        for (let from = 0; from < wallets.length;) {
          const end = Math.min(from + batchSize, wallets.length);
          const slice = wallets.slice(from, end);
          const { transaction } = await (sdk as any).sealRosterShardTx({
            launch: testLaunchState,
            shardId,
            from,
            max: slice.length,
            walletsSlice: slice,
          });
          try {
            try { transaction.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: MAX_UNITS })); } catch (_) {}
            await provider.sendAndConfirm!(transaction, []);
            addLog(`   -> Shard ${shardId}: sealed users [${from}..${end - 1}]`);
            batches += 1;
            from = end;
            if (batchSize < MAX_BATCH) batchSize = Math.min(MAX_BATCH, batchSize + 2);
          } catch (e: any) {
            const msg = String(e?.message || "");
            const cuExceeded = msg.includes("exceeded CUs meter") || msg.includes("consumed 200000 of 200000 compute units") || msg.includes("Program failed to complete");
            const txTooLarge = msg.includes("Transaction too large") || msg.includes("> 1232");
            
            if (cuExceeded && batchSize > 1) {
              batchSize = Math.max(1, Math.floor(batchSize / 2));
              addLog(`   -> Shard ${shardId}: CU exceeded, reducing batch size to ${batchSize} and retrying...`);
              continue;
            } else if (txTooLarge && batchSize > 1) {
              batchSize = Math.max(1, Math.floor(batchSize * 3 / 4));
              addLog(`   -> Shard ${shardId}: TX too large, reducing batch size to ${batchSize} and retrying...`);
              continue;
            }
            addLog(`   -> Shard ${shardId}: seal batch failed [${from}..${end - 1}]: ${e?.message || e}`);
            throw e;
          }
        }

        const sealAfter = await provider.connection.getBalance(admin.publicKey);
        const shardSealCost = Math.max(0, sealBefore - sealAfter);
        context.metrics.sealCost += shardSealCost;
        context.metrics.sealDetails.push({ shardId, costLamports: shardSealCost, batches });

        const before = await provider.connection.getBalance(admin.publicKey);
        const { transaction: closeTx } = await (sdk as any).closeRosterShardTx({
          launch: testLaunchState,
          shardId,
          payer: admin.publicKey,
          refundTo: admin.publicKey,
        });

        try {
          await provider.sendAndConfirm!(closeTx, []);
          const after = await provider.connection.getBalance(admin.publicKey);
          const delta = after - before;
          addLog(`   -> Shard ${shardId} closed. Payer delta: ${(delta / 1e9).toFixed(9)} SOL`);
          if (delta > 0) {
            context.metrics.shardsRentRefundLamports += delta;
          }
          context.metrics.closedShardsCount += 1;
        } catch (e: any) {
          addLog(`   -> Shard ${shardId}: close failed: ${e?.message || e}`);
          throw e;
        }
    }
  }
}
