import { FlowStep } from "../step";
import type { FlowContext } from "../types";
import { Transaction, ComputeBudgetProgram } from "@solana/web3.js";

export class CreatorClaimStep extends FlowStep {
  constructor() {
    super("[10/10] Creator & Team Claims");
  }

  async execute(context: FlowContext): Promise<void> {
    const { config, admin, provider, addLog, sdk, testLaunchState, mintedBaseMint } = context;
    if (!testLaunchState) throw new Error("Launch state not initialized");
    if (!mintedBaseMint) {
        addLog("   -> No base mint (claims skipped).");
        return;
    }

    const baseMintForClaims = mintedBaseMint;

    if (config.creatorInitialDepositLamports > 0) {
        const balanceBefore = await provider.connection.getBalance(admin.publicKey);
        addLog(`\n[10/10] Testing Creator Token Claiming (Accrued Vesting)...`);
        
        const creatorAta = sdk.getUserAta(baseMintForClaims, admin.publicKey);
        try {
            const { ix } = sdk.buildCreateAtaIx({ payer: admin.publicKey, owner: admin.publicKey, mint: baseMintForClaims });
            await provider.sendAndConfirm!(new Transaction().add(ix), []);
        } catch (_) {}

        addLog(`\n   --- Firing 3 rapid claims to test initial lock ---`);
        let initialSuccess = 0;
        for (let i = 0; i < 3; i++) {
             try {
                 await sdk.claimCreatorTokens({ launch: testLaunchState, baseMint: baseMintForClaims, creatorAta, createAtaIfMissing: true });
                 initialSuccess++;
             } catch (e: any) { /* expected failures */ }
             await new Promise(r => setTimeout(r, 200));
        }
        addLog(`   -> Rapid claims result: ${initialSuccess} success(es)`);

        const waitTime = 3;
        addLog(`\n   --- Waiting ${waitTime}s... ---`);
        await new Promise(r => setTimeout(r, waitTime * 1000));

        try {
             await sdk.claimCreatorTokens({ launch: testLaunchState, baseMint: baseMintForClaims, creatorAta });
             addLog(`   -> ✅ SUCCESS: Claimed remaining tokens.`);
        } catch (e: any) {
             addLog(`   -> Note: ${e.message}`);
        }

        const balanceAfter = await provider.connection.getBalance(admin.publicKey);
        context.metrics.creatorClaimCost = balanceBefore - balanceAfter;
    }

    try {
         const vestSec = (config as any).teamVestingDurationSec ?? 1;
         await new Promise(r => setTimeout(r, Math.max(1, vestSec) * 1000 + 600));
         
         const teamCreatorAta = sdk.getUserAta(baseMintForClaims, admin.publicKey);
         const attemptClaim = async () => {
             const before = (await provider.connection.getTokenAccountBalance(teamCreatorAta)).value.uiAmount || 0;
             const { transaction } = await sdk.claimTeamTokensTx({
                 launch: testLaunchState,
                 baseMint: baseMintForClaims,
                 creator: admin.publicKey,
                 creatorAta: teamCreatorAta,
                 createAtaIfMissing: true
             });
             transaction.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: 3_000_000 }));
             transaction.feePayer = admin.publicKey;
             const latest = await provider.connection.getLatestBlockhash();
             transaction.recentBlockhash = latest.blockhash;
             await provider.wallet.signTransaction(transaction);
             await provider.sendAndConfirm!(transaction, []);
             const after = (await provider.connection.getTokenAccountBalance(teamCreatorAta)).value.uiAmount || 0;
             return after - before;
         }

         let retries = 3;
         while(retries-- > 0) {
             try {
                 const got = await attemptClaim();
                 if (got > 0) addLog(`[Team Vesting] Claimed ${got.toFixed(6)} tokens`);
                 if (got === 0) break;
             } catch (e: any) {
                 if (String(e).includes("NothingToClaim")) break;
                 await new Promise(r => setTimeout(r, 1000));
             }
         }
    } catch (e: any) {
        addLog(`[Team Vesting] Error: ${e.message}`);
    }
  }
}

