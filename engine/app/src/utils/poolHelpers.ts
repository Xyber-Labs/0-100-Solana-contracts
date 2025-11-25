import { PoolUtils, Raydium } from "@raydium-io/raydium-sdk-v2";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import BN from "bn.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

type SolanaCluster = "devnet" | "mainnet";

function detectCluster(endpoint: string): SolanaCluster {
  return endpoint.includes("devnet") ? "devnet" : "mainnet";
}

function solToLamports(value: number): BN {
  return new BN(Math.round(value * 1_000_000_000));
}

function splitAmount(amount: BN, parts: number): BN[] {
  if (parts <= 0) return [];
  const base = amount.divn(parts);
  if (base.isZero()) return [amount];
  const remainder = amount.sub(base.muln(parts));
  const segments = Array.from({ length: parts }, () => base.clone());
  const extra = remainder.toNumber();
  for (let i = 0; i < extra && i < segments.length; i++) {
    segments[i] = segments[i].addn(1);
  }
  return segments.filter((bn) => bn.gt(new BN(0)));
}

interface RaydiumContext {
  raydium: Raydium;
  ownerPubkey: PublicKey;
  signer?: Keypair | null;
}

async function createRaydiumContext(provider: any, signer?: Keypair | null, requireSigner = false): Promise<RaydiumContext> {
  const walletAdapter = provider?.wallet ?? {};
  const adapterSigner: Keypair | null = signer ?? walletAdapter.payer ?? null;
  const adapterPublicKey: PublicKey | null = adapterSigner?.publicKey ?? walletAdapter.publicKey ?? null;
  const signAllTransactions =
    typeof walletAdapter.signAllTransactions === "function"
      ? walletAdapter.signAllTransactions.bind(walletAdapter)
      : undefined;
  if (requireSigner && !adapterSigner && !signAllTransactions) {
    throw new Error("Wallet is read-only; connect a signer capable of submitting transactions.");
  }
  const owner = adapterSigner ?? adapterPublicKey ?? Keypair.generate();
  const raydium = await Raydium.load({
    connection: provider.connection,
    owner,
    cluster: detectCluster(provider?.connection?.rpcEndpoint ?? ""),
    disableLoadToken: true,
    disableFeatureCheck: true,
    signAllTransactions,
  });
  const ownerPubkey = owner instanceof PublicKey ? owner : (owner as Keypair).publicKey;
  return { raydium, ownerPubkey, signer: adapterSigner ?? (owner instanceof Keypair ? owner : null) };
}

async function ensureAtaExists(provider: any, owner: PublicKey, mint: PublicKey): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const info = await provider.connection.getAccountInfo(ata);
  if (!info) {
    const tx = new Transaction().add(createAssociatedTokenAccountInstruction(owner, ata, owner, mint));
    await provider.sendAndConfirm!(tx, []);
  }
  return ata;
}

export interface ClmmPoolSnapshot {
  id: string;
  mintA: { address: string; symbol?: string; decimals: number };
  mintB: { address: string; symbol?: string; decimals: number };
  price: number;
  mintAmountA: number;
  mintAmountB: number;
  tickCurrent: number;
}

export async function fetchClmmPoolSnapshot(params: {
  provider: any;
  poolId: PublicKey;
  signer?: Keypair | null;
}): Promise<ClmmPoolSnapshot | null> {
  try {
    const context = await createRaydiumContext(params.provider, params.signer, false);
    const snapshot = await context.raydium.clmm.getPoolInfoFromRpc(params.poolId.toBase58());
    const poolInfo = snapshot.poolInfo;
    return {
      id: params.poolId.toBase58(),
      mintA: {
        address: poolInfo.mintA.address,
        symbol: poolInfo.mintA.symbol,
        decimals: poolInfo.mintA.decimals,
      },
      mintB: {
        address: poolInfo.mintB.address,
        symbol: poolInfo.mintB.symbol,
        decimals: poolInfo.mintB.decimals,
      },
      price: poolInfo.price,
      mintAmountA: poolInfo.mintAmountA ?? 0,
      mintAmountB: poolInfo.mintAmountB ?? 0,
      tickCurrent: snapshot.computePoolInfo?.tickCurrent ?? 0,
    };
  } catch {
    return null;
  }
}

export interface ClmmSwapSmokeTestParams {
  provider: any;
  poolId: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  addLog: (msg: string) => void;
  signer?: Keypair | null;
}

export interface ClmmManualSwapParams extends ClmmSwapSmokeTestParams {
  inputMint: PublicKey;
  amountIn: BN;
  slippage?: number;
}

export async function performClmmSwap(params: ClmmManualSwapParams): Promise<{ txId: string; amountOut: BN }> {
  const context = await createRaydiumContext(params.provider, params.signer, true);
  const { raydium, ownerPubkey } = context;
  // Ensure token accounts exist for both legs before submitting swap
  await ensureAtaExists(params.provider, ownerPubkey, params.inputMint);
  const outputMint = params.inputMint.equals(params.baseMint) ? params.quoteMint : params.baseMint;
  await ensureAtaExists(params.provider, ownerPubkey, outputMint);
  await raydium.account.fetchWalletTokenAccounts({ forceUpdate: true });
  const poolIdStr = params.poolId.toBase58();
  const snapshot = await raydium.clmm.getPoolInfoFromRpc(poolIdStr);
  const tickCache = snapshot.tickData?.[poolIdStr];
  if (!tickCache) throw new Error("Missing CLMM tick cache");
  const epochInfo = await raydium.fetchEpochInfo();
  const computation = PoolUtils.computeAmountOut({
    poolInfo: snapshot.computePoolInfo,
    tickArrayCache: tickCache,
    baseMint: params.inputMint,
    amountIn: params.amountIn,
    slippage: params.slippage ?? 0.03,
    epochInfo,
    catchLiquidityInsufficient: true,
  });
  if (!computation.allTrade) throw new Error("Insufficient CLMM liquidity");
  const swapTx = await raydium.clmm.swap({
    poolInfo: snapshot.poolInfo,
    poolKeys: snapshot.poolKeys,
    inputMint: params.inputMint,
    amountIn: params.amountIn,
    amountOutMin: computation.minAmountOut.amount,
    observationId: new PublicKey(snapshot.poolKeys.observationId),
    ownerInfo: {
      useSOLBalance: params.inputMint.equals(params.quoteMint) && params.quoteMint.equals(WSOL_MINT),
      feePayer: ownerPubkey,
    },
    remainingAccounts: computation.remainingAccounts,
  });
  const { txId } = await swapTx.execute({ sendAndConfirm: true, skipPreflight: false });
  return { txId, amountOut: computation.minAmountOut.amount };
}

export async function executeClmmSwapSmokeTest(params: ClmmSwapSmokeTestParams): Promise<void> {
  const { baseMint, quoteMint, addLog } = params;
  const buyInputs = [0.05, 0.04, 0.03].map((value) => solToLamports(value));
  let acquiredBase = new BN(0);
  for (let i = 0; i < buyInputs.length; i++) {
    const { txId, amountOut } = await performClmmSwap({
      ...params,
      inputMint: quoteMint,
      amountIn: buyInputs[i],
    });
    addLog(`      - CLMM swap buy #${i + 1}: ${txId}`);
    acquiredBase = acquiredBase.add(amountOut);
  }

  if (acquiredBase.isZero()) {
    addLog("      - CLMM sell swaps skipped (no base acquired).");
    return;
  }

  const sellChunks = splitAmount(acquiredBase, 3);
  let sellIndex = 0;
  for (const chunk of sellChunks) {
    if (chunk.isZero() || sellIndex >= 3) continue;
    const { txId } = await performClmmSwap({
      ...params,
      inputMint: baseMint,
      amountIn: chunk,
    });
    addLog(`      - CLMM swap sell #${sellIndex + 1}: ${txId}`);
    sellIndex += 1;
  }
}
