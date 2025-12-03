import { BN, AnchorProvider } from "@coral-xyz/anchor";
import { SystemProgram, Transaction, PublicKey, Keypair } from "@solana/web3.js";
import type EngineSDK from "@xyber-labs/0-100-sdk";

export type AddLog = (msg: string) => void;

export interface SimUser {
  keypair: Keypair;
  tickets: number;
  depositAmount: BN;
  shardId: number;
}

export async function waitForFundingPeriodEnd(params: {
  provider: AnchorProvider;
  sdk: ReturnType<typeof EngineSDK.create>;
  launchPda: PublicKey;
  addLog?: AddLog;
}): Promise<void> {
  const { provider, sdk, launchPda, addLog } = params;
  addLog?.("Fetching launch state to check funding period...");
  const state = await sdk.fetchLaunch(launchPda);
  const fundingEndTime = (state.fundingPeriodEnd as any).toNumber?.() ?? Number(state.fundingPeriodEnd);

  async function getChainTimeSec(): Promise<number> {
    try {
      const slot = await provider.connection.getSlot();
      const ts = await provider.connection.getBlockTime(slot);
      if (typeof ts === "number") return ts;
    } catch {}
    return Math.floor(Date.now() / 1000);
  }

  let chainNow = await getChainTimeSec();
  if (chainNow >= fundingEndTime) {
    addLog?.("Funding period has already ended (chain time).");
    return;
  }

  const initialWait = Math.max(0, fundingEndTime - chainNow);
  addLog?.(`Waiting ~${initialWait} seconds for funding period to end (chain time)...`);
  while (true) {
    await new Promise((r) => setTimeout(r, 1000));
    chainNow = await getChainTimeSec();
    if (chainNow >= fundingEndTime) break;
  }
}

export async function getChainTimeSec(provider: AnchorProvider): Promise<number> {
  try {
    const slot = await provider.connection.getSlot();
    const ts = await provider.connection.getBlockTime(slot);
    if (typeof ts === "number") return ts;
  } catch {}
  return Math.floor(Date.now() / 1000);
}

export async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>) {
  let index = 0;
  let aborted = false;
  let firstError: any = null;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      if (aborted) break;
      const current = index++;
      if (current >= items.length) break;
      try {
        await worker(items[current], current);
      } catch (e) {
        if (!firstError) firstError = e;
        aborted = true;
        break;
      }
    }
  });
  await Promise.allSettled(runners);
  if (firstError) throw firstError;
}

export async function fundUsersParallel(params: {
  provider: AnchorProvider;
  admin: PublicKey;
  users: SimUser[];
  feeBufferLamports?: number;
  concurrency?: number;
  addLog?: AddLog;
}): Promise<void> {
  const { provider, admin, users, feeBufferLamports = 5_000_000, concurrency = 200, addLog } = params;
  const total = users.length;
  const step = Math.max(1, Math.floor(total / 20));
  let completed = 0;
  addLog?.(`Funding ${total} users in parallel...`);
  await runWithConcurrency(users, Math.min(concurrency, total), async (user) => {
    const fundingAmount = user.depositAmount.toNumber() + feeBufferLamports;
    let attempt = 0;
    const maxAttempts = 5;
    const baseDelay = 200;
    for (;;) {
      try {
        const transferIx = SystemProgram.transfer({ fromPubkey: admin, toPubkey: user.keypair.publicKey, lamports: fundingAmount });
        const tx = new Transaction().add(transferIx);
        tx.feePayer = admin;
        tx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;
        await provider.sendAndConfirm(tx, []);
        break;
      } catch (e: any) {
        const msg = String(e?.message || "");
        const transient = msg.includes("aborted") || msg.includes("Blockhash") || msg.includes("429") || msg.includes("Too many") || msg.includes("ETIMEDOUT") || msg.includes("ECONNRESET");
        attempt++;
        if (!transient || attempt >= maxAttempts) throw e;
        const delay = baseDelay * Math.min(8, 2 ** (attempt - 1));
        await new Promise(r => setTimeout(r, delay));
      }
    }
    const c = ++completed;
    if (c % step === 0 || c === total) {
      const percent = Math.round((c / total) * 100);
      addLog?.(`Funding progress: ${c}/${total} (${percent}%)`);
    }
  });
}

export async function airdropUsersParallel(params: {
  provider: AnchorProvider;
  users: SimUser[];
  feeBufferLamports?: number;
  concurrency?: number;
  addLog?: AddLog;
}): Promise<void> {
  const { provider, users, feeBufferLamports = 5_000_000, concurrency = 200, addLog } = params;
  const total = users.length;
  const step = Math.max(1, Math.floor(total / 20));
  let completed = 0;
  addLog?.(`Funding ${total} users via airdrop in parallel...`);
  await runWithConcurrency(users, Math.min(concurrency, total), async (user) => {
    const fundingAmount = user.depositAmount.toNumber() + feeBufferLamports;
    let attempt = 0;
    const maxAttempts = 5;
    const baseDelay = 200;
    for (;;) {
      try {
        const sig = await provider.connection.requestAirdrop(user.keypair.publicKey, fundingAmount);
        await provider.connection.confirmTransaction(sig, "confirmed");
        break;
      } catch (e: any) {
        const msg = String(e?.message || "");
        const transient = msg.includes("aborted") || msg.includes("Blockhash") || msg.includes("429") || msg.includes("Too many") || msg.includes("ETIMEDOUT") || msg.includes("ECONNRESET");
        attempt++;
        if (!transient || attempt >= maxAttempts) throw e;
        const delay = baseDelay * Math.min(8, 2 ** (attempt - 1));
        await new Promise(r => setTimeout(r, delay));
      }
    }
    const c = ++completed;
    if (c % step === 0 || c === total) {
      const percent = Math.round((c / total) * 100);
      addLog?.(`Airdrop funding progress: ${c}/${total} (${percent}%)`);
    }
  });
}

export async function depositUsersParallel(params: {
  sdk: ReturnType<typeof EngineSDK.create>;
  launchPda: PublicKey;
  users: SimUser[];
  concurrency?: number;
  addLog?: AddLog;
}): Promise<Array<{ pubkey: PublicKey; shardId: number }>> {
  const { sdk, launchPda, users, concurrency = 200, addLog } = params;
  const total = users.length;
  const step = Math.max(1, Math.floor(total / 20));
  let completed = 0;
  addLog?.(`Depositing for ${total} users in parallel (sequential per shard)...`);

  const results: Array<{ pubkey: PublicKey; shardId: number }> = new Array(users.length);

  // Group users by shardId to respect on-chain rule: shard s>1 is only usable when s-1 is full.
  const usersByShard = new Map<number, { user: SimUser; index: number }[]>();
  users.forEach((u, idx) => {
    const list = usersByShard.get(u.shardId) ?? [];
    list.push({ user: u, index: idx });
    usersByShard.set(u.shardId, list);
  });

  const sortedShardIds = Array.from(usersByShard.keys()).sort((a, b) => a - b);

  for (const shardId of sortedShardIds) {
    const shardUsers = usersByShard.get(shardId)!;
    addLog?.(`   -> Processing shard ${shardId} with ${shardUsers.length} users...`);

    await runWithConcurrency(
      shardUsers,
      Math.min(concurrency, shardUsers.length),
      async ({ user, index: globalIndex }) => {
        let attempt = 0;
        const maxAttempts = 6;
        const baseDelay = 250;
        try {
          const res = await (async () => {
            for (;;) {
              try {
                const out = await (sdk as any).deposit({
                  launch: launchPda,
                  amountLamports: user.depositAmount,
                  userKeypair: user.keypair,
                  shardId: user.shardId,
                });
                return { shardId: user.shardId, ...out };
              } catch (e: any) {
                const msg = String(e?.message || "");
                const transient =
                  msg.includes("aborted") ||
                  msg.includes("Blockhash") ||
                  msg.includes("429") ||
                  msg.includes("Too many") ||
                  msg.includes("ETIMEDOUT") ||
                  msg.includes("ECONNRESET") ||
                  msg.includes("not confirmed in 30.00 seconds");
                attempt++;
                if (!transient || attempt >= maxAttempts) throw e;
                const jitter = Math.floor(Math.random() * 100);
                const delay = baseDelay * Math.min(8, 2 ** (attempt - 1)) + jitter;
                await new Promise((r) => setTimeout(r, delay));
              }
            }
          })();
          results[globalIndex] = { pubkey: user.keypair.publicKey, shardId: res.shardId };
        } catch (e: any) {
          addLog?.(`Deposit failed for ${user.keypair.publicKey.toBase58()}: ${String(e?.message || e)}`);
          results[globalIndex] = undefined as any;
        } finally {
          const c = ++completed;
          if (c % step === 0 || c === total) {
            const percent = Math.round((c / total) * 100);
            addLog?.(`Deposits progress: ${c}/${total} (${percent}%)`);
          }
        }
      }
    );
  }

  return results;
}

export async function preparePoolCreationWithRetry(params: {
  sdk: ReturnType<typeof EngineSDK.create>;
  launchPda: PublicKey;
  retries?: number;
  computeUnits?: number;
  addLog?: AddLog;
}): Promise<void> {
  const { sdk, launchPda, retries = 5, computeUnits = 2_000_000, addLog } = params;
  const provider: any = (sdk as any).program?.provider;
  const payer = provider?.wallet?.publicKey;
  if (!provider || !payer) throw new Error("Missing provider or wallet for preparePoolCreation");
  let prepared = false;
  for (let i = 0; i < retries; i++) {
    try {
      const { transaction } = await (sdk as any).preparePoolCreationTx({ payer, launch: launchPda, computeUnits });
      await provider.sendAndConfirm(transaction, []);
      prepared = true;
      addLog?.("preparePoolCreation succeeded (valid recent blockhash found).");
      break;
    } catch (e: any) {
      const msg = (e && e.message) ? String(e.message) : "";
      if (msg.includes("NoValidBlockhash")) {
        if (i === 0) addLog?.("Waiting for a valid recent blockhash (retrying up to 60s)...");
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      throw e;
    }
  }
  if (!prepared) throw new Error("No valid recent blockhash observed within retry window");
}

export async function mintForTestSafe(params: {
  sdk: ReturnType<typeof EngineSDK.create>;
  launchPda: PublicKey;
  baseMintKeypair?: Keypair | null;
  addLog?: AddLog;
}): Promise<PublicKey> {
  const { sdk, launchPda, baseMintKeypair, addLog } = params;
  const isRealKeypair = !!(baseMintKeypair && (baseMintKeypair as any).secretKey && typeof (baseMintKeypair as any).secretKey.length === "number");
  try {
    const res = await sdk.mintForTest({ launch: launchPda, baseMint: isRealKeypair ? (baseMintKeypair as Keypair) : undefined });
    addLog?.(`Minted base tokens to escrow. Signature: ${res.signature}`);
    return res.baseMint;
  } catch (e: any) {
    const msg = String(e?.message || e || "");
    // Anchor fallback when instruction is not compiled (feature "test" not enabled)
    if (msg.includes("InstructionFallbackNotFound") || msg.includes("0x65")) {
      const friendly = "mintForTest is unavailable on this deployment (program built without test feature). Use LiteSVM tests or deploy a test build, or create CLMM pool and add liquidity instead.";
      addLog?.(friendly);
      throw new Error(friendly);
    }
    throw e;
  }
}


