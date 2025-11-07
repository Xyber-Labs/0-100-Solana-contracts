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
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const current = index++;
      if (current >= items.length) break;
      await worker(items[current], current);
    }
  });
  await Promise.all(runners);
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
  addLog?.(`Funding ${users.length} users in parallel...`);
  await runWithConcurrency(users, Math.min(concurrency, users.length), async (user) => {
    const fundingAmount = user.depositAmount.toNumber() + feeBufferLamports;
    const transferIx = SystemProgram.transfer({ fromPubkey: admin, toPubkey: user.keypair.publicKey, lamports: fundingAmount });
    const tx = new Transaction().add(transferIx);
    tx.feePayer = admin;
    tx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;
    await provider.sendAndConfirm(tx, []);
  });
}

export async function depositUsersParallel(params: {
  sdk: ReturnType<typeof EngineSDK.create>;
  launchPda: PublicKey;
  users: SimUser[];
  concurrency?: number;
  addLog?: AddLog;
}): Promise<void> {
  const { sdk, launchPda, users, concurrency = 200, addLog } = params;
  addLog?.(`Depositing for ${users.length} users in parallel...`);
  await runWithConcurrency(users, Math.min(concurrency, users.length), async (user) => {
    await sdk.deposit({ launch: launchPda, amountLamports: user.depositAmount, userKeypair: user.keypair, shardId: user.shardId });
  });
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


