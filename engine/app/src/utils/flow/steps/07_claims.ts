import { FlowStep } from "../step";
import type { FlowContext } from "../types";
import { PublicKey } from "@solana/web3.js";

export class ClaimsStep extends FlowStep {
  constructor() {
    super("[9/10] Claims & Refunds");
  }

  async execute(context: FlowContext): Promise<void> {
    const { sdk, provider, addLog, testLaunchState, mintedBaseMint, usersWithDeposits, stats } = context;
    if (!testLaunchState) throw new Error("Launch state not initialized");

    try {
        const poolStateAcc = await (sdk as any).fetchPoolState(testLaunchState);
        const claimsReady = !!(poolStateAcc?.claimsReady);
        if (!claimsReady) {
            addLog(`   -> Claims are not ready (CLMM liquidity not added). Skipping claims step.`);
            return;
        }
    } catch (_) {
        addLog(`   -> Pool state not found; skipping claims step.`);
        return;
    }

    const baseMintForClaims = mintedBaseMint!; 
    
    for (const [user, info] of usersWithDeposits.entries()) {
      stats.registerUser({
        user,
        shardId: info.shardId,
        tickets: info.tickets,
        depositLamports: BigInt(info.depositAmount.toString()),
      });
    }

    const allUsersData = Array.from(usersWithDeposits.values());

    const demoUser = allUsersData[0];
    if (demoUser) {
        addLog(`   -> Demo: simulating token claim for ${demoUser.keypair.publicKey.toBase58()}`);
        try {
            const { transaction, userAta } = await (sdk as any).claimTokensTx({
                launch: testLaunchState,
                baseMint: baseMintForClaims,
                userPubkey: demoUser.keypair.publicKey,
                shardId: demoUser.shardId,
                createAtaIfMissing: true,
            });
            const latest = await provider.connection.getLatestBlockhash();
            transaction.feePayer = provider.wallet.publicKey;
            transaction.recentBlockhash = latest.blockhash ?? latest;
            
            let sim: any;
            try {
                sim = await provider.connection.simulateTransaction(transaction, { sigVerify: false, replaceRecentBlockhash: true } as any);
            } catch (_) {
                sim = await provider.connection.simulateTransaction(transaction as any);
            }
            
            const logs = sim?.value?.logs ?? sim?.logs ?? [];
            const parsed = this.parseTokensClaimedFromLogs(logs);
            if (parsed && typeof parsed.amount === "number") {
                const amountUi = parsed.amount / 1e9;
                addLog(`simulation:      would receive: ${amountUi.toFixed(6)} tokens`);
            } else {
                 addLog("simulation:      simulation ok (no logs)");
            }
        } catch (e: any) {
             addLog(`      simulation failed: ${e?.message || e}`);
        }
    }

    const totalClaimUsers = allUsersData.length;
    const CLAIM_BATCH_SIZE = totalClaimUsers > 2000 ? 20 : 50;
    addLog(`   -> Claiming for ${totalClaimUsers} users in batches of ${CLAIM_BATCH_SIZE}...`);
    
    const allResults = [];
    for (let i = 0; i < allUsersData.length; i += CLAIM_BATCH_SIZE) {
        const batch = allUsersData.slice(i, i + CLAIM_BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(async (userData) => {
            return this.processUserClaim(context, userData, baseMintForClaims, testLaunchState);
        }));
        allResults.push(...batchResults);
    }
    
    let successfulTokenClaims = 0;
    let successfulRefundClaims = 0;
    let tokensClaimed = 0;
    let failedClaims = 0;
    
    for (const result of allResults) {
        if (result.status === "winner") {
            successfulTokenClaims++;
            tokensClaimed += result.tokensClaimed || 0;
        } else if (result.status === "loser") {
            successfulRefundClaims++;
        } else {
            failedClaims++;
        }
    }

    addLog(`   -> Winners: ${successfulTokenClaims}`);
    addLog(`   -> Losers: ${successfulRefundClaims}`);
    addLog(`   -> Failed: ${failedClaims}`);
    addLog(`   -> Total tokens claimed: ${tokensClaimed.toFixed(6)}`);

    if (failedClaims > 0) throw new Error(`${failedClaims} users failed to claim.`);
  }

  async processUserClaim(context: FlowContext, userData: any, baseMint: PublicKey, launch: PublicKey) {
      const { sdk, provider, stats } = context;
      const userPk = userData.keypair.publicKey;
      const userKey = userPk.toBase58();
      const userAta = sdk.getUserAta(baseMint, userPk);
      
      const getBal = async (ata: PublicKey) => {
          try { return (await provider.connection.getTokenAccountBalance(ata)).value.uiAmount || 0; } catch { return 0; }
      }
      const initialBalance = await getBal(userAta);

      let tokensClaimedUi = 0;
      try {
           let attempt = 0;
           while(attempt < 3) {
               try {
                   await sdk.claimTokens({
                       launch,
                       baseMint,
                       userKeypair: userData.keypair,
                       createAtaIfMissing: true,
                       shardId: userData.shardId
                   });
                   const finalBalance = await getBal(userAta);
                   const deltaUi = finalBalance - initialBalance;
                   if (deltaUi > 0) {
                       stats.recordWinner({ user: userKey, tokensAtomicDelta: BigInt(Math.round(deltaUi * 1e9)) });
                       tokensClaimedUi = deltaUi;
                   }
                   break;
               } catch (e: any) {
                   if (String(e).includes("NoTokensToClaim")) break;
                   attempt++;
                   if (attempt >= 3) throw e;
                   await new Promise(r => setTimeout(r, 200 * Math.pow(2, attempt)));
               }
           }
      } catch (e) {
          stats.recordFailure({ user: userKey, phase: "claim", error: e });
          return { status: "failed", error: e };
      }

      try {
          const preLamports = await provider.connection.getBalance(userPk);
          await sdk.claimRefund({ launch, userKeypair: userData.keypair, shardId: userData.shardId });
          const postLamports = await provider.connection.getBalance(userPk);
          const refund = postLamports - preLamports;
          if (refund > 0) stats.recordLoser({ user: userKey, refundLamportsDelta: BigInt(refund) });
      } catch (e: any) {
           if (!String(e).includes("NothingToClaim")) { /* ignore */ }
      }

      if (tokensClaimedUi > 0) return { status: "winner", tokensClaimed: tokensClaimedUi };
      return { status: "loser" };
  }

  parseTokensClaimedFromLogs(logs: string[]): { amount?: number; yApproved?: number } | null {
      if (!logs || !logs.length) return null;
      const discriminator = [25, 128, 244, 55, 241, 136, 200, 91];
      const toBytes = (b64: string) => {
          const bin = atob(b64);
          const u = new Uint8Array(bin.length);
          for (let i=0; i<bin.length; i++) u[i] = bin.charCodeAt(i);
          return u;
      }
      for (const line of logs) {
          if (line.includes("Program data: ")) {
              const b64 = line.split("Program data: ")[1].trim();
              const bytes = toBytes(b64);
              if (bytes.length < 8) continue;
              let match = true;
              for (let i=0; i<8; i++) if (bytes[i] !== discriminator[i]) match = false;
              if (match && bytes.length >= 8+32+32+8) {
                  const view = new DataView(bytes.buffer, bytes.byteOffset + 8 + 32 + 32, 8);
                  const lo = view.getUint32(0, true);
                  const hi = view.getUint32(4, true);
                  const amount = Number((BigInt(hi) << 32n) + BigInt(lo));
                  return { amount };
              }
          }
      }
      return null;
  }
}

