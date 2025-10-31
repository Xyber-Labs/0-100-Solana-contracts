import * as anchor from "@coral-xyz/anchor";
import { Raydium } from "@raydium-io/raydium-sdk-v2";
import BN from "bn.js";
const Decimal = require("decimal.js");
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  createInitializeMintInstruction,
  createMintToInstruction,
} from "@solana/spl-token";



type Args = {
  airdropSol: number;
  quoteMint: string;
  ammConfig: string;
  clmmProgram: string;
  baseDecimals: number;
  mintAmount: string;
  tickSpacing: number;
  feeRateBps: number;
  initPrice: string;
  initPricePctAbove: number;
  initPriceNum: string;
  initPriceDen: string;
  liquidityBaseAmount: string;
  liquidityBaseAmountHuman: string;
  liquidityQuoteAmountSol: string;
  liquidityUseQuoteExact: string;
  swapDirection: string;
  swapAmount: string;
  swapAmountSol: string;
  swapBudgetSol: string;
  fullRange: string;
  swapCount: number;
  swapParallel: string;
  swapConcurrency: number;
  swapSlippageBps: number;
  swapNoMinOut: string;
  doCollect: string;
  swapSplitHalf: string;
  initFracIsQuoteOverBase: string;
  initFracHuman: string;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string, fallback?: string) => {
    const idx = argv.findIndex(a => a === flag || a.startsWith(`${flag}=`));
    if (idx === -1) return fallback;
    const v = argv[idx];
    if (v.includes("=")) return v.split("=").slice(1).join("=");
    const next = argv[idx + 1];
    if (!next || next.startsWith("--")) return fallback;
    return next;
  };

  const toNumber = (v: string | undefined, d: number) => {
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) ? n : d;
  };

  const toString = (v: string | undefined, d: string) => v ?? d;

  return {
    airdropSol: toNumber(get("--airdrop"), 10),
    quoteMint: toString(get("--quoteMint"), "So11111111111111111111111111111111111111112"),
    ammConfig: toString(get("--ammConfig"), ""),
    clmmProgram: toString(get("--clmmProgram"), "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"),
    baseDecimals: toNumber(get("--baseDecimals"), 6),
    mintAmount: toString(get("--mintAmount"), "0"),
    tickSpacing: toNumber(get("--tickSpacing"), 60),
    feeRateBps: toNumber(get("--feeRateBps"), 2500),
    initPrice: toString(get("--initPrice"), "1"),
    initPricePctAbove: toNumber(get("--initPricePctAbove"), 0),
    initPriceNum: toString(get("--initPriceNum"), "0"),
    initPriceDen: toString(get("--initPriceDen"), "0"),
    liquidityBaseAmount: toString(get("--liquidityBaseAmount"), "0"),
    liquidityBaseAmountHuman: toString(get("--liquidityBaseAmountHuman"), "0"),
    liquidityQuoteAmountSol: toString(get("--liquidityQuoteAmountSol"), "0"),
    liquidityUseQuoteExact: toString(get("--liquidityUseQuoteExact"), "0"),
    swapDirection: toString(get("--swapDirection"), ""),
    swapAmount: toString(get("--swapAmount"), "0"),
    swapAmountSol: toString(get("--swapAmountSol"), "0"),
    swapBudgetSol: toString(get("--swapBudgetSol"), "0"),
    fullRange: toString(get("--fullRange"), "1"),
    swapCount: toNumber(get("--swapCount"), 1),
    swapParallel: toString(get("--swapParallel"), "0"),
    swapConcurrency: toNumber(get("--swapConcurrency"), 8),
    swapSlippageBps: toNumber(get("--swapSlippageBps"), 100),
    swapNoMinOut: toString(get("--swapNoMinOut"), "0"),
    doCollect: toString(get("--doCollect"), "1"),
    swapSplitHalf: toString(get("--swapSplitHalf"), "0"),
    initFracIsQuoteOverBase: toString(get("--initFracIsQuoteOverBase"), "1"),
    initFracHuman: toString(get("--initFracHuman"), "1"),
  };
}

function getProvider(): anchor.AnchorProvider {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  return provider;
}

async function airdrop(provider: anchor.AnchorProvider, amountSol: number) {
  const pk = provider.publicKey!;
  const sig = await provider.connection.requestAirdrop(pk, Math.round(amountSol * anchor.web3.LAMPORTS_PER_SOL));
  await provider.connection.confirmTransaction(sig, "confirmed");
  console.log(`Airdropped ${amountSol} SOL to ${pk.toBase58()}`);
}

async function createBaseMint(provider: anchor.AnchorProvider, decimals: number) {
  const baseMint = anchor.web3.Keypair.generate();
  const lamports = await provider.connection.getMinimumBalanceForRentExemption(82);
  const createMintAccountIx = anchor.web3.SystemProgram.createAccount({
    fromPubkey: provider.publicKey!,
    newAccountPubkey: baseMint.publicKey,
    space: 82,
    lamports,
    programId: TOKEN_PROGRAM_ID,
  });
  const initMintIx = createInitializeMintInstruction(baseMint.publicKey, decimals, provider.publicKey!, null);
  const tx = new anchor.web3.Transaction().add(createMintAccountIx, initMintIx);
  const sig = await provider.sendAndConfirm(tx, [baseMint]);
  console.log(`Base mint created ${baseMint.publicKey.toBase58()} tx ${sig}`);
  return baseMint;
}

async function ensureAtaAndMint(provider: anchor.AnchorProvider, mint: anchor.web3.PublicKey, owner: anchor.web3.PublicKey, amountStr: string) {
  const ata = getAssociatedTokenAddressSync(mint, owner, true);
  const ixs: anchor.web3.TransactionInstruction[] = [];
  const info = await provider.connection.getAccountInfo(ata);
  if (!info) {
    ixs.push(createAssociatedTokenAccountInstruction(provider.publicKey!, ata, owner, mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
  }
  if (amountStr !== "0") {
    const amount = BigInt(amountStr);
    ixs.push(createMintToInstruction(mint, ata, provider.publicKey!, Number(amount)));
  }
  if (ixs.length) {
    const tx = new anchor.web3.Transaction().add(...ixs);
    const sig = await provider.sendAndConfirm(tx);
    console.log(`ATA ready ${ata.toBase58()} tx ${sig}`);
  }
  return ata;
}

function deriveRaydiumPdas(ammConfig: anchor.web3.PublicKey, quoteMint: anchor.web3.PublicKey, baseMint: anchor.web3.PublicKey, clmmProgram: anchor.web3.PublicKey) {
  const pool = anchor.web3.PublicKey.findProgramAddressSync([
    Buffer.from("pool"),
    ammConfig.toBuffer(),
    quoteMint.toBuffer(),
    baseMint.toBuffer(),
  ], clmmProgram)[0];
  const observation = anchor.web3.PublicKey.findProgramAddressSync([
    Buffer.from("observation"),
    pool.toBuffer(),
  ], clmmProgram)[0];
  const baseVault = anchor.web3.PublicKey.findProgramAddressSync([
    Buffer.from("pool_vault"),
    pool.toBuffer(),
    baseMint.toBuffer(),
  ], clmmProgram)[0];
  const quoteVault = anchor.web3.PublicKey.findProgramAddressSync([
    Buffer.from("pool_vault"),
    pool.toBuffer(),
    quoteMint.toBuffer(),
  ], clmmProgram)[0];
  const tickArrayBitmap = anchor.web3.PublicKey.findProgramAddressSync([
    Buffer.from("pool_tick_array_bitmap_extension"),
    pool.toBuffer(),
  ], clmmProgram)[0];
  return { pool, observation, baseVault, quoteVault, tickArrayBitmap };
}

async function createClmmPoolWithSdk(provider: anchor.AnchorProvider, params: {
  baseMint: anchor.web3.PublicKey;
  quoteMint: anchor.web3.PublicKey;
  ammConfig: anchor.web3.PublicKey;
  clmmProgram: anchor.web3.PublicKey;
  tickSpacing: number;
  feeRateBps: number;
  initPrice: string;
  baseDecimals: number;
  quoteDecimals?: number;
}) {
  const owner: any = (provider as any).wallet?.payer || (provider as any).wallet;
  const ray: any = await Raydium.load({ connection: provider.connection, owner });

  const mint1 = {
    address: params.baseMint.toBase58(),
    decimals: params.baseDecimals,
    programId: TOKEN_PROGRAM_ID.toBase58(),
  };
  const mint2 = {
    address: params.quoteMint.toBase58(),
    decimals: params.quoteDecimals ?? 9,
    programId: TOKEN_PROGRAM_ID.toBase58(),
  };
  const ammConfig = {
    id: params.ammConfig,
    index: 0,
    protocolFeeRate: 0,
    tradeFeeRate: params.feeRateBps,
    tickSpacing: params.tickSpacing,
    fundFeeRate: 0,
    description: "",
  };

  const tx = await ray.clmm.createPool({
    programId: params.clmmProgram,
    mint1,
    mint2,
    ammConfig,
    initialPrice: new Decimal(params.initPrice),
  });

  try {
    if (typeof (tx as any).simulate === "function") {
      const sim = await (tx as any).simulate();
      const logs = sim?.value?.logs || sim?.logs || [];
      if (Array.isArray(logs) && logs.length) {
        console.log("simulate logs (createPool):");
        for (const l of logs) console.log(l);
      }
    }
    const { txId } = await tx.execute({ sendAndConfirm: true, skipPreflight: false });
    console.log(`Raydium pool created tx ${txId}`);
    return txId;
  } catch (e: any) {
    const sig = e?.signature || e?.txId;
    printErrorDetails(e);
    if (sig) await printTxLogs((anchor.getProvider() as anchor.AnchorProvider), sig);
    throw e;
  }
}

function computeFullRangeTicks(tickSpacing: number) {
  const MIN_TICK = -443636;
  const MAX_TICK = 443636;
  const lower = Math.ceil(MIN_TICK / tickSpacing) * tickSpacing;
  const upper = Math.floor(MAX_TICK / tickSpacing) * tickSpacing;
  return { lower, upper };
}

async function addLiquidityWithSdk(provider: anchor.AnchorProvider, params: {
  poolId: anchor.web3.PublicKey;
  tickSpacing: number;
  baseDecimals: number;
  baseAmount: BN;
  fullRange: boolean;
  otherAmountMax?: BN;
  baseMint: anchor.web3.PublicKey;
  quoteExact?: boolean;
}) {
  const owner: any = (provider as any).wallet?.payer || (provider as any).wallet;
  const ray: any = await Raydium.load({ connection: provider.connection, owner });
  const poolIdStr = params.poolId.toBase58();
  const { poolInfo, poolKeys } = await ray.clmm.getPoolInfoFromRpc(poolIdStr);

  let tickLower: number;
  let tickUpper: number;
  if (params.fullRange) {
    const r = computeFullRangeTicks(params.tickSpacing);
    tickLower = r.lower;
    tickUpper = r.upper;
  } else {
    const width = params.tickSpacing * 10;
    tickLower = -width;
    tickUpper = width;
  }

  const isFullRange = (() => {
    const r = computeFullRangeTicks(params.tickSpacing);
    return r.lower === tickLower && r.upper === tickUpper;
  })();
  console.log(`liquidity range tickLower ${tickLower} tickUpper ${tickUpper} fullRange ${isFullRange}`);

  const baseIsMintA = poolInfo.mintA.address === params.baseMint.toBase58();
  let tx: any;
  if (params.quoteExact && params.otherAmountMax && typeof (ray.clmm as any).openPositionFromQuote === "function") {
    const quoteIsA = !baseIsMintA;
    tx = await (ray.clmm as any).openPositionFromQuote({
      poolInfo,
      poolKeys,
      ownerInfo: { useSOLBalance: true },
      tickLower,
      tickUpper,
      quote: quoteIsA ? "MintA" : "MintB",
      quoteAmount: params.otherAmountMax,
      baseAmountMax: new BN("1000000000000000000"),
      withMetadata: "create",
    });
  } else if (params.quoteExact && params.otherAmountMax) {
    const sqrtStr = (poolInfo.sqrtPriceX64?.toString?.()) || String(poolInfo.sqrtPriceX64 ?? poolInfo.state?.sqrtPriceX64 ?? "0");
    const sqrt = new Decimal(sqrtStr);
    const aDec = poolInfo.mintA.decimals;
    const bDec = poolInfo.mintB.decimals;
    const priceAinB = sqrt.eq(0) ? new Decimal(0) : sqrt.mul(sqrt).div(new Decimal(2).pow(128)).mul(new Decimal(10).pow(bDec - aDec));
    const priceBaseInQuote = baseIsMintA ? priceAinB : (priceAinB.eq(0) ? new Decimal(0) : new Decimal(1).div(priceAinB));
    const quoteHuman = new Decimal(params.otherAmountMax.toString()).div(new Decimal(10).pow(baseIsMintA ? bDec : aDec));
    const baseHuman = priceBaseInQuote.gt(0) ? quoteHuman.div(priceBaseInQuote) : new Decimal(0);
    const baseRaw = new BN(baseHuman.mul(new Decimal(10).pow(params.baseDecimals)).toFixed(0));
    tx = await ray.clmm.openPositionFromBase({
      poolInfo,
      poolKeys,
      ownerInfo: { useSOLBalance: true },
      tickLower,
      tickUpper,
      base: baseIsMintA ? "MintA" : "MintB",
      baseAmount: baseRaw,
      otherAmountMax: params.otherAmountMax,
      withMetadata: "create",
    });
  } else {
    tx = await ray.clmm.openPositionFromBase({
      poolInfo,
      poolKeys,
      ownerInfo: { useSOLBalance: true },
      tickLower,
      tickUpper,
      base: baseIsMintA ? "MintA" : "MintB",
      baseAmount: params.baseAmount,
      otherAmountMax: params.otherAmountMax ?? new BN("1000000000000"),
      withMetadata: "create",
    });
  }
  try {
    if (typeof (tx as any).simulate === "function") {
      const sim = await (tx as any).simulate();
      const logs = sim?.value?.logs || sim?.logs || [];
      if (Array.isArray(logs) && logs.length) {
        console.log("simulate logs (addLiquidity):");
        for (const l of logs) console.log(l);
      }
    }
    const { txId } = await tx.execute({ sendAndConfirm: true, skipPreflight: false });
    console.log(`addLiquidity tx ${txId}`);
    return { txId, tickLower, tickUpper };
  } catch (e: any) {
    const sig = e?.signature || e?.txId;
    printErrorDetails(e);
    if (sig) await printTxLogs((anchor.getProvider() as anchor.AnchorProvider), sig);
    throw e;
  }
}

async function collectFeesWithSdk(provider: anchor.AnchorProvider, params: {
  ray: any;
  poolId: anchor.web3.PublicKey;
  expectedTickLower?: number;
  expectedTickUpper?: number;
}): Promise<{ txId: string; collectedA: BN; collectedB: BN } | null> {
  const owner: any = (provider as any).wallet?.payer || (provider as any).wallet;
  const poolIdStr = params.poolId.toBase58();
  const { poolInfo, poolKeys, computePoolInfo, tickData } = await params.ray.clmm.getPoolInfoFromRpc(poolIdStr);
  const positions = await params.ray.clmm.getOwnerPositionInfo({ programId: poolKeys.programId });
  let target = positions.find((p: any) => (p.poolId?.toBase58?.() || p.poolId?.toString?.()) === params.poolId.toBase58());
  if (params.expectedTickLower !== undefined && params.expectedTickUpper !== undefined) {
    const specific = positions.find((p: any) => (p.poolId?.toBase58?.() || p.poolId?.toString?.()) === params.poolId.toBase58() && Number(p.tickLower) === params.expectedTickLower && Number(p.tickUpper) === params.expectedTickUpper);
    if (specific) target = specific;
  }
  if (!target) {
    console.log("No owner position found for pool; skipping collect");
    return null;
  }
  const mintA = new anchor.web3.PublicKey(poolInfo.mintA.address);
  const mintB = new anchor.web3.PublicKey(poolInfo.mintB.address);
  const ataA = getAssociatedTokenAddressSync(mintA, owner.publicKey, true);
  const ataB = getAssociatedTokenAddressSync(mintB, owner.publicKey, true);
  const getBal = async (acc: anchor.web3.PublicKey) => {
    try {
      const r = await provider.connection.getTokenAccountBalance(acc);
      return new BN(r.value.amount);
    } catch {
      return new BN(0);
    }
  };
  const beforeA = await getBal(ataA);
  const beforeB = await getBal(ataB);
  try {
    const { PositionUtils } = await import("@raydium-io/raydium-sdk-v2/lib/raydium/clmm/utils/position.js");
    const { TickUtils } = await import("@raydium-io/raydium-sdk-v2/lib/raydium/clmm/utils/tick.js");
    const lowerStart = TickUtils.getTickArrayStartIndexByTick(Number(target.tickLower), poolInfo.config.tickSpacing);
    const upperStart = TickUtils.getTickArrayStartIndexByTick(Number(target.tickUpper), poolInfo.config.tickSpacing);
    const lowerArr = tickData[poolIdStr][String(lowerStart)];
    const upperArr = tickData[poolIdStr][String(upperStart)];
    const lowerTick = lowerArr?.ticks?.find((t: any) => Number(t.tick) === Number(target.tickLower));
    const upperTick = upperArr?.ticks?.find((t: any) => Number(t.tick) === Number(target.tickUpper));
    if (lowerTick && upperTick) {
      const owed = PositionUtils.GetPositionFeesV2(computePoolInfo[poolIdStr], target, lowerTick, upperTick);
      const aRaw = owed.tokenFeeAmountA.toString();
      const bRaw = owed.tokenFeeAmountB.toString();
      const aHuman = new Decimal(aRaw).div(new Decimal(10).pow(poolInfo.mintA.decimals)).toString();
      const bHuman = new Decimal(bRaw).div(new Decimal(10).pow(poolInfo.mintB.decimals)).toString();
      console.log(`claimable fees A raw ${aRaw} human ${aHuman}`);
      console.log(`claimable fees B raw ${bRaw} human ${bHuman}`);
    }
  } catch {}
  const ix = await params.ray.clmm.decreaseLiquidity({
    poolInfo,
    poolKeys,
    ownerPosition: target,
    ownerInfo: { useSOLBalance: false },
    amountMinA: new BN(0),
    amountMinB: new BN(0),
    liquidity: new BN(0),
  });
  let txId = "";
  try {
    if (typeof (ix as any).simulate === "function") {
      const sim = await (ix as any).simulate();
      const logs = sim?.value?.logs || sim?.logs || [];
      if (Array.isArray(logs) && logs.length) {
        console.log("simulate logs (collect):");
        for (const l of logs) console.log(l);
      }
    }
    ({ txId } = await ix.execute({ sendAndConfirm: true, skipPreflight: false }));
    console.log(`collectFees tx ${txId}`);
  } catch (e: any) {
    const sig = e?.signature || e?.txId;
    printErrorDetails(e);
    if (sig) await printTxLogs((anchor.getProvider() as anchor.AnchorProvider), sig);
    throw e;
  }
  const afterA = await getBal(ataA);
  const afterB = await getBal(ataB);
  const deltaA = afterA.sub(beforeA);
  const deltaB = afterB.sub(beforeB);
  const deltaAHuman = new Decimal(deltaA.toString()).div(new Decimal(10).pow(poolInfo.mintA.decimals)).toString();
  const deltaBHuman = new Decimal(deltaB.toString()).div(new Decimal(10).pow(poolInfo.mintB.decimals)).toString();
  console.log(`collected A raw ${deltaA.toString()} human ${deltaAHuman}`);
  console.log(`collected B raw ${deltaB.toString()} human ${deltaBHuman}`);
  return { txId, collectedA: deltaA, collectedB: deltaB };
}

async function swapWithSdk(provider: anchor.AnchorProvider, params: {
  poolId: anchor.web3.PublicKey;
  inputMint: anchor.web3.PublicKey;
  amountIn: BN;
  slippageBps: number;
  ray?: any;
  noMinOut?: boolean;
}): Promise<{ txId: string; amountIn: BN; amountOutPlanned: BN; inputIsA: boolean }> {
  const owner: any = (provider as any).wallet?.payer || (provider as any).wallet;
  const ray: any = params.ray ?? (await Raydium.load({ connection: provider.connection, owner }));
  const poolIdStr = params.poolId.toBase58();
  const { poolInfo, poolKeys, computePoolInfo, tickData } = await ray.clmm.getPoolInfoFromRpc(poolIdStr);
  const { PoolUtils } = await import("@raydium-io/raydium-sdk-v2/lib/raydium/clmm/utils/pool.js");
  const epochInfo = await provider.connection.getEpochInfo();
  const plan = PoolUtils.computeAmountOut({
    poolInfo: computePoolInfo,
    tickArrayCache: tickData[poolIdStr],
    baseMint: params.inputMint,
    amountIn: params.amountIn,
    slippage: params.slippageBps / 10_000,
    epochInfo,
    priceLimit: new Decimal(0),
    catchLiquidityInsufficient: true,
  });

  const tx = await ray.clmm.swap({
    poolInfo,
    poolKeys,
    inputMint: params.inputMint,
    amountIn: params.amountIn,
    amountOutMin: params.noMinOut ? new BN(0) : plan.minAmountOut.amount,
    priceLimit: new Decimal(0),
    observationId: new anchor.web3.PublicKey(poolKeys.observationId),
    ownerInfo: { useSOLBalance: true },
    remainingAccounts: plan.remainingAccounts,
  });
  try {
    if (typeof (tx as any).simulate === "function") {
      const sim = await (tx as any).simulate();
      const logs = sim?.value?.logs || sim?.logs || [];
      if (Array.isArray(logs) && logs.length) {
        console.log("simulate logs (swap):");
        for (const l of logs) console.log(l);
      }
    }
    const { txId } = await tx.execute({ sendAndConfirm: true, skipPreflight: false });
    console.log(`swap tx ${txId}`);
    const inputIsA = poolInfo.mintA.address === params.inputMint.toString();
    return { txId, amountIn: params.amountIn, amountOutPlanned: plan.amountOut.amount, inputIsA };
  } catch (e: any) {
    const sig = e?.signature || e?.txId;
    printErrorDetails(e);
    if (sig) await printTxLogs((anchor.getProvider() as anchor.AnchorProvider), sig);
    throw e;
  }
}

async function printBaseMintSupply(provider: anchor.AnchorProvider, params: {
  mint: anchor.web3.PublicKey;
  decimals: number;
}) {
  const supply = await provider.connection.getTokenSupply(params.mint);
  const raw = supply.value.amount;
  const human = new Decimal(raw).div(new Decimal(10).pow(params.decimals)).toString();
  console.log(`base mint ${params.mint.toBase58()} supply raw ${raw}`);
  console.log(`base mint ${params.mint.toBase58()} supply ${human}`);
}

async function runWithConcurrency<T>(factories: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = [];
  let next = 0;
  async function worker() {
    while (next < factories.length) {
      const i = next++;
      results[i] = await factories[i]();
    }
  }
  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function getLamportsSpentByPayerForTx(provider: anchor.AnchorProvider, txId: string) {
  const resp: any = await provider.connection.getTransaction(txId, { commitment: "confirmed", maxSupportedTransactionVersion: 0 } as any);
  if (!resp || !resp.meta) return 0;
  const meta = resp.meta;
  const message: any = resp.transaction?.message;
  const keys: any[] = (message && (message.accountKeys || message.staticAccountKeys)) || [];
  const payer = provider.publicKey!.toBase58();
  const keyStrs = keys.map((k: any) => {
    const pk = k?.pubkey ? k.pubkey : k;
    return typeof pk?.toBase58 === "function" ? pk.toBase58() : pk?.toString?.();
  });
  const idx = Math.max(0, keyStrs.findIndex((s: any) => s === payer));
  const pre: number[] = meta.preBalances || [];
  const post: number[] = meta.postBalances || [];
  if (pre[idx] === undefined || post[idx] === undefined) return meta.fee || 0;
  const diff = pre[idx] - post[idx];
  return diff >= 0 ? diff : meta.fee || 0;
}

function lamportsToSolString(lamports: number) {
  return new Decimal(lamports).div(new Decimal(anchor.web3.LAMPORTS_PER_SOL)).toString();
}

async function printTxLogs(provider: anchor.AnchorProvider, sig: string) {
  try {
    const tx = await provider.connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 } as any);
    const logs = tx?.meta?.logMessages || [];
    if (logs.length) {
      console.log(`tx logs for ${sig}:`);
      for (const l of logs) console.log(l);
    } else {
      console.log(`no logs found for ${sig}`);
    }
  } catch (err) {
    console.log(`failed to fetch logs for ${sig}`);
  }
}

function printErrorDetails(e: any) {
  try {
    if (!e) return;
    if (e.transactionLogs && Array.isArray(e.transactionLogs)) {
      console.log("transactionLogs:");
      for (const l of e.transactionLogs) console.log(l);
    }
    if (e.logs && Array.isArray(e.logs)) {
      console.log("logs:");
      for (const l of e.logs) console.log(l);
    }
    if (typeof e.getLogs === "function") {
      const l = e.getLogs();
      if (Array.isArray(l)) {
        console.log("getLogs():");
        for (const x of l) console.log(x);
      }
    }
    if (e.transactionMessage) console.log(String(e.transactionMessage));
    if (e.message) console.log(String(e.message));
  } catch {}
}

async function getPoolPriceAinB(provider: anchor.AnchorProvider, poolId: anchor.web3.PublicKey) {
  const owner: any = (provider as any).wallet?.payer || (provider as any).wallet;
  const ray: any = await Raydium.load({ connection: provider.connection, owner });
  const { poolInfo } = await ray.clmm.getPoolInfoFromRpc(poolId.toBase58());
  const aDec = poolInfo.mintA.decimals;
  const bDec = poolInfo.mintB.decimals;
  const sqrtStr = (poolInfo.sqrtPriceX64?.toString?.()) || String(poolInfo.sqrtPriceX64 ?? poolInfo.state?.sqrtPriceX64 ?? "0");
  const sqrt = new Decimal(sqrtStr);
  if (sqrt.eq(0)) return { priceAinB: "0", priceBinA: "0" };
  const base = sqrt.mul(sqrt).div(new Decimal(2).pow(128));
  const scale = new Decimal(10).pow(bDec - aDec);
  const priceAinB = base.mul(scale);
  const priceBinA = new Decimal(1).div(priceAinB);
  return { priceAinB: priceAinB.toString(), priceBinA: priceBinA.toString() };
}

async function swapClmm(provider: anchor.AnchorProvider, params: {
  ray: any;
  poolId: anchor.web3.PublicKey;
  inputMint: anchor.web3.PublicKey;
  amountIn: number;
  a2b: boolean;
  slippageBps: number;
}) {
  const tx = await params.ray.clmm.swap({
    poolId: params.poolId,
    inputMint: params.inputMint,
    amountIn: params.amountIn,
    a2b: params.a2b,
    slippage: params.slippageBps,
  });
  return await provider.sendAndConfirm(tx, []);
}

async function main() {
  const args = parseArgs();
  const provider = getProvider();

  await airdrop(provider, args.airdropSol);

  const baseMint = await createBaseMint(provider, args.baseDecimals);
  const ownerAta = await ensureAtaAndMint(provider, baseMint.publicKey, provider.publicKey!, args.mintAmount);

  const balStartSol = await provider.connection.getBalance(provider.publicKey!);
  const getTokenBal = async (acc: anchor.web3.PublicKey) => {
    try {
      const r = await provider.connection.getTokenAccountBalance(acc);
      return new BN(r.value.amount);
    } catch {
      return new BN(0);
    }
  };
  const balStartA = await getTokenBal(ownerAta);
  const quoteMintPk = new anchor.web3.PublicKey(args.quoteMint);
  const isWsolQuote = args.quoteMint === "So11111111111111111111111111111111111111112";
  const ownerQuoteAta = isWsolQuote ? null : getAssociatedTokenAddressSync(quoteMintPk, provider.publicKey!, true);
  const balStartQuoteToken = ownerQuoteAta ? await getTokenBal(ownerQuoteAta) : new BN(0);

  if (!args.ammConfig || !args.ammConfig.trim()) {
    console.error("Missing --ammConfig. Set Raydium AmmConfig pubkey and rerun.");
    return;
  }

  const clmmProgram = new anchor.web3.PublicKey(args.clmmProgram);
  const ammConfig = new anchor.web3.PublicKey(args.ammConfig);
  const quoteMint = new anchor.web3.PublicKey(args.quoteMint);
  const pdas = deriveRaydiumPdas(ammConfig, quoteMint, baseMint.publicKey, clmmProgram);

  console.log(`Base mint ${baseMint.publicKey.toBase58()}`);
  console.log(`Base ATA ${ownerAta.toBase58()}`);
  console.log(`Raydium pool ${pdas.pool.toBase58()}`);
  console.log(`Raydium base vault ${pdas.baseVault.toBase58()}`);
  console.log(`Raydium quote vault ${pdas.quoteVault.toBase58()}`);
  console.log(`Raydium observation ${pdas.observation.toBase58()}`);
  console.log(`Raydium tick bitmap ${pdas.tickArrayBitmap.toBase58()}`);

  if (!args.ammConfig) {
    console.log("--ammConfig need for pool creation");
    return;
  }

  try {
    const isWsol = args.quoteMint === "So11111111111111111111111111111111111111112";
    const preBalance = await provider.connection.getBalance(provider.publicKey!);
    const initPriceFromFrac =
      (args.initPriceNum !== "0" && args.initPriceDen !== "0")
        ? (args.initFracIsQuoteOverBase === "1"
            ? new Decimal(args.initPriceNum).div(new Decimal(args.initPriceDen)) // QUOTE / BASE (human units)
            : new Decimal(args.initPriceDen).div(new Decimal(args.initPriceNum))) // BASE / QUOTE (human units)
        : null;
    const initPriceBase = initPriceFromFrac ?? new Decimal(args.initPrice);
    const initPriceEffective = initPriceBase.mul(new Decimal(1).add(new Decimal(args.initPricePctAbove).div(100)));
    const sig = await createClmmPoolWithSdk(provider, {
      baseMint: baseMint.publicKey,
      quoteMint,
      ammConfig,
      clmmProgram,
      tickSpacing: args.tickSpacing,
      feeRateBps: args.feeRateBps,
      initPrice: initPriceEffective.toString(),
      baseDecimals: args.baseDecimals,
      quoteDecimals: isWsol ? 9 : undefined,
    });
    console.log(`createPool signature ${sig}`);
    const postBalance = await provider.connection.getBalance(provider.publicKey!);
    const spentByBalance = Math.max(0, preBalance - postBalance);
    const spentByTx = await getLamportsSpentByPayerForTx(provider, sig);
    const createPoolLamportsSpent = spentByBalance > 0 ? spentByBalance : spentByTx;
    let startPriceStr = "";
    try {
      const p = await getPoolPriceAinB(provider, pdas.pool);
      startPriceStr = p.priceAinB;
      console.log(`start price BASE/QUOTE ${startPriceStr}`);
    } catch {}
    let added: { txId: string; tickLower: number; tickUpper: number } | null = null;
    if (args.liquidityBaseAmount !== "0" || args.liquidityBaseAmountHuman !== "0" || args.liquidityQuoteAmountSol !== "0") {
      const baseRaw = args.liquidityBaseAmountHuman !== "0" ? new BN(new Decimal(args.liquidityBaseAmountHuman).mul(new Decimal(10).pow(args.baseDecimals)).toFixed(0)) : new BN(args.liquidityBaseAmount);
      const quoteMax = args.liquidityQuoteAmountSol !== "0" ? new BN(new Decimal(args.liquidityQuoteAmountSol).mul(new Decimal(anchor.web3.LAMPORTS_PER_SOL)).toFixed(0)) : null;
      added = await addLiquidityWithSdk(provider, {
        poolId: pdas.pool,
        tickSpacing: args.tickSpacing,
        baseDecimals: args.baseDecimals,
        baseAmount: baseRaw,
        fullRange: args.fullRange === "1",
        otherAmountMax: quoteMax ?? undefined,
        baseMint: baseMint.publicKey,
        quoteExact: args.liquidityUseQuoteExact === "1",
      });
    }
    if ((args.swapAmount !== "0" || args.swapAmountSol !== "0" || args.swapBudgetSol !== "0") && (args.swapDirection === "a2b" || args.swapDirection === "b2a")) {
      const inputMintPrimary = args.swapDirection === "a2b" ? baseMint.publicKey : quoteMint;
      const inputMintSecondary = args.swapDirection === "a2b" ? quoteMint : baseMint.publicKey;
      const count = Math.max(1, args.swapCount);
      const owner: any = (provider as any).wallet?.payer || (provider as any).wallet;
      const sharedRay: any = await Raydium.load({ connection: provider.connection, owner });
      const noMinOut = args.swapNoMinOut === "1";
      const useSplit = args.swapSplitHalf === "1" && count > 1;
      const half = Math.floor(count / 2);
      const wsolAddr = "So11111111111111111111111111111111111111112";
      const inputPrimaryIsWsol = inputMintPrimary.toBase58() === wsolAddr;
      const inputSecondaryIsWsol = inputMintSecondary.toBase58() === wsolAddr;
      const wsolSwapsCount = useSplit ? (inputPrimaryIsWsol ? count - half : 0) + (inputSecondaryIsWsol ? half : 0) : (inputPrimaryIsWsol ? count : 0);
      const budgetLamportsBN = args.swapBudgetSol !== "0" ? new BN(new Decimal(args.swapBudgetSol).mul(new Decimal(anchor.web3.LAMPORTS_PER_SOL)).toFixed(0)) : null;
      const amountSolBN = args.swapAmountSol !== "0" ? new BN(new Decimal(args.swapAmountSol).mul(new Decimal(anchor.web3.LAMPORTS_PER_SOL)).toFixed(0)) : null;
      const perWsolAmountBN = budgetLamportsBN && wsolSwapsCount > 0 ? budgetLamportsBN.divn(wsolSwapsCount) : null;
      let totalInA = new BN(0);
      let totalInB = new BN(0);
      let totalOutA = new BN(0);
      let totalOutB = new BN(0);
      if (args.swapParallel === "1") {
        const factories = Array.from({ length: count }, (_, i) => async () => {
          console.log(`swap ${i + 1}/${count}`);
          let lastErr: any = null;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              const useSecondary = useSplit && i >= half;
              const chosenInput = useSecondary ? inputMintSecondary : inputMintPrimary;
              const chosenIsWsol = chosenInput.toBase58() === wsolAddr;
              const amountIn = chosenIsWsol ? (perWsolAmountBN ?? amountSolBN ?? new BN(args.swapAmount)) : new BN(args.swapAmount);
              return await swapWithSdk(provider, {
                ray: sharedRay,
                poolId: pdas.pool,
                inputMint: chosenInput,
                amountIn,
                slippageBps: args.swapSlippageBps,
                noMinOut,
              });
            } catch (e) {
              lastErr = e;
            }
          }
          throw lastErr;
        });
        const res = await runWithConcurrency(factories, Math.max(1, args.swapConcurrency));
        for (const r of res) {
          if (!r) continue;
          if (r.inputIsA) {
            totalInA = totalInA.add(r.amountIn);
            totalOutB = totalOutB.add(r.amountOutPlanned);
          } else {
            totalInB = totalInB.add(r.amountIn);
            totalOutA = totalOutA.add(r.amountOutPlanned);
          }
        }
      } else {
        for (let i = 0; i < count; i++) {
          console.log(`swap ${i + 1}/${count}`);
          const useSecondary = useSplit && i >= half;
          const chosenInput = useSecondary ? inputMintSecondary : inputMintPrimary;
          const chosenIsWsol = chosenInput.toBase58() === wsolAddr;
          const amountIn = chosenIsWsol ? (perWsolAmountBN ?? amountSolBN ?? new BN(args.swapAmount)) : new BN(args.swapAmount);
          const r = await swapWithSdk(provider, { ray: sharedRay, poolId: pdas.pool, inputMint: chosenInput, amountIn, slippageBps: args.swapSlippageBps, noMinOut });
          if (r.inputIsA) {
            totalInA = totalInA.add(r.amountIn);
            totalOutB = totalOutB.add(r.amountOutPlanned);
          } else {
            totalInB = totalInB.add(r.amountIn);
            totalOutA = totalOutA.add(r.amountOutPlanned);
          }
        }
      }
      // expose totals to summary via closure scope variables
      (global as any).__swapTotals__ = { totalInA, totalInB, totalOutA, totalOutB };
    }

    let collected: { a: BN; b: BN } | null = null;
    if (args.doCollect === "1") {
      const ray = await Raydium.load({ connection: provider.connection, owner: (provider as any).wallet?.payer || (provider as any).wallet });
      const res = await collectFeesWithSdk(provider, {
        ray,
        poolId: pdas.pool,
        expectedTickLower: added?.tickLower,
        expectedTickUpper: added?.tickUpper,
      });
      if (res) collected = { a: res.collectedA, b: res.collectedB };
    }

    await printBaseMintSupply(provider, { mint: baseMint.publicKey, decimals: args.baseDecimals });

    const owner: any = (provider as any).wallet?.payer || (provider as any).wallet;
    const ray: any = await Raydium.load({ connection: provider.connection, owner });
    const { poolInfo } = await ray.clmm.getPoolInfoFromRpc(pdas.pool.toBase58());
    const aDec = poolInfo.mintA.decimals;
    const bDec = poolInfo.mintB.decimals;
    const aAddr = poolInfo.mintA.address;
    const bAddr = poolInfo.mintB.address;
    const baseAddr = baseMint.publicKey.toBase58();
    const quoteAddr = quoteMint.toBase58();
    const baseDec = baseAddr === aAddr ? aDec : (baseAddr === bAddr ? bDec : args.baseDecimals);
    const quoteDec = quoteAddr === aAddr ? aDec : (quoteAddr === bAddr ? bDec : (isWsol ? 9 : 0));
    const aHuman = collected ? new Decimal(collected.a.toString()).div(new Decimal(10).pow(aDec)).toString() : "0";
    const bHuman = collected ? new Decimal(collected.b.toString()).div(new Decimal(10).pow(bDec)).toString() : "0";
    const splitInfo = args.swapSplitHalf === "1" ? `, splitHalf: ${Math.floor(Math.max(1, args.swapCount)/2)}/${Math.ceil(Math.max(1, args.swapCount)/2)}` : "";
    console.log("=== SUMMARY ===");
    if (initPriceFromFrac) {
      console.log(`expected init price BASE/QUOTE ${initPriceFromFrac.toString()}`);
    }
    console.log(`createPool lamportsSpent ${createPoolLamportsSpent} (${lamportsToSolString(createPoolLamportsSpent)} SOL)`);
    console.log(`pool ${pdas.pool.toBase58()} tickLower ${added?.tickLower ?? "-"} tickUpper ${added?.tickUpper ?? "-"} fullRange ${args.fullRange === "1"}`);
    try {
      const baseVaultBal = await provider.connection.getTokenAccountBalance(pdas.baseVault);
      const quoteVaultBal = await provider.connection.getTokenAccountBalance(pdas.quoteVault);
      const baseVaultRaw = baseVaultBal.value.amount;
      const quoteVaultRaw = quoteVaultBal.value.amount;
      const baseVaultHuman = new Decimal(baseVaultRaw).div(new Decimal(10).pow(args.baseDecimals)).toString();
      const quoteDecimals = isWsol ? 9 : (new anchor.web3.PublicKey(poolInfo.mintA.address).toBase58() === quoteMint.toBase58() ? aDec : bDec);
      const quoteVaultHuman = new Decimal(quoteVaultRaw).div(new Decimal(10).pow(quoteDecimals)).toString();
      console.log(`pool baseVault ${pdas.baseVault.toBase58()} balance raw ${baseVaultRaw} (${baseVaultHuman})`);
      console.log(`pool quoteVault ${pdas.quoteVault.toBase58()} balance raw ${quoteVaultRaw} (${quoteVaultHuman})`);
    } catch {}
    try {
      const end = await getPoolPriceAinB(provider, pdas.pool);
      if (startPriceStr) console.log(`start price BASE/QUOTE ${startPriceStr}`);
      console.log(`end price BASE/QUOTE ${end.priceAinB}`);
    } catch {}
    const balEndSol = await provider.connection.getBalance(provider.publicKey!);
    const balEndA = await getTokenBal(ownerAta);
    const aStartHuman = new Decimal(balStartA.toString()).div(new Decimal(10).pow(baseDec)).toString();
    const aEndHuman = new Decimal(balEndA.toString()).div(new Decimal(10).pow(baseDec)).toString();
    console.log(`owner BASE start ${balStartA.toString()} (${aStartHuman}) end ${balEndA.toString()} (${aEndHuman})`);
    const aDeltaRaw = balEndA.sub(balStartA);
    const aDeltaHuman = new Decimal(aDeltaRaw.toString()).div(new Decimal(10).pow(baseDec)).toString();
    console.log(`owner BASE delta ${aDeltaRaw.toString()} (${aDeltaHuman})`);
    if (isWsol) {
      console.log(`owner SOL start ${balStartSol} (${lamportsToSolString(balStartSol)} SOL) end ${balEndSol} (${lamportsToSolString(balEndSol)} SOL)`);
      const solDelta = balEndSol - balStartSol;
      console.log(`owner QUOTE(SOL) delta ${solDelta} (${lamportsToSolString(solDelta)} SOL)`);
      console.log(`final wallet BASE ${aEndHuman}, QUOTE(SOL) ${lamportsToSolString(balEndSol)} SOL`);
    } else {
      const ownerQuoteAta2 = ownerQuoteAta!;
      const balEndQuote = await getTokenBal(ownerQuoteAta2);
      const qStartHuman = new Decimal(balStartQuoteToken.toString()).div(new Decimal(10).pow(quoteDec)).toString();
      const qEndHuman = new Decimal(balEndQuote.toString()).div(new Decimal(10).pow(quoteDec)).toString();
      console.log(`owner QUOTE start ${balStartQuoteToken.toString()} (${qStartHuman}) end ${balEndQuote.toString()} (${qEndHuman})`);
      const qDeltaRaw = balEndQuote.sub(balStartQuoteToken);
      const qDeltaHuman = new Decimal(qDeltaRaw.toString()).div(new Decimal(10).pow(quoteDec)).toString();
      console.log(`owner QUOTE delta ${qDeltaRaw.toString()} (${qDeltaHuman})`);
      console.log(`final wallet BASE ${aEndHuman}, QUOTE ${qEndHuman}`);
    }
    console.log(`swaps count ${Math.max(1, args.swapCount)} dir ${args.swapDirection}${splitInfo} parallel ${args.swapParallel}`);
    const totals = (global as any).__swapTotals__ as { totalInA: BN; totalInB: BN; totalOutA: BN; totalOutB: BN } | undefined;
    if (totals) {
      const inAH = new Decimal(totals.totalInA.toString()).div(new Decimal(10).pow(aDec)).toString();
      const inBH = new Decimal(totals.totalInB.toString()).div(new Decimal(10).pow(bDec)).toString();
      const outAH = new Decimal(totals.totalOutA.toString()).div(new Decimal(10).pow(aDec)).toString();
      const outBH = new Decimal(totals.totalOutB.toString()).div(new Decimal(10).pow(bDec)).toString();
      console.log(`volume in A raw ${totals.totalInA.toString()} (${inAH}), in B raw ${totals.totalInB.toString()} (${inBH})`);
      console.log(`volume out A raw ${totals.totalOutA.toString()} (${outAH}), out B raw ${totals.totalOutB.toString()} (${outBH})`);
    }
    console.log(`mintA ${aAddr} collected ${collected ? collected.a.toString() : "0"} (${aHuman})`);
    console.log(`mintB ${bAddr} collected ${collected ? collected.b.toString() : "0"} (${bHuman})`);
  } catch (e) {
    console.error("Raydium SDK call failed. Ensure @raydium-io/raydium-sdk is installed and your local validator has CLMM + AmmConfig.");
    throw e;
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});


