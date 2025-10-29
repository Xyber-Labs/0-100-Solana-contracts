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
  liquidityBaseAmount: string;
  swapDirection: string;
  swapAmount: string;
  fullRange: string;
  swapCount: number;
  swapParallel: string;
  swapConcurrency: number;
  swapSlippageBps: number;
  swapNoMinOut: string;
  doCollect: string;
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
    liquidityBaseAmount: toString(get("--liquidityBaseAmount"), "0"),
    swapDirection: toString(get("--swapDirection"), ""),
    swapAmount: toString(get("--swapAmount"), "0"),
    fullRange: toString(get("--fullRange"), "1"),
    swapCount: toNumber(get("--swapCount"), 1),
    swapParallel: toString(get("--swapParallel"), "0"),
    swapConcurrency: toNumber(get("--swapConcurrency"), 8),
    swapSlippageBps: toNumber(get("--swapSlippageBps"), 100),
    swapNoMinOut: toString(get("--swapNoMinOut"), "0"),
    doCollect: toString(get("--doCollect"), "1"),
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

  const { txId } = await tx.execute({ sendAndConfirm: true, skipPreflight: true });
  console.log(`Raydium pool created tx ${txId}`);
  return txId;
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

  const tx = await ray.clmm.openPositionFromBase({
    poolInfo,
    poolKeys,
    ownerInfo: { useSOLBalance: true },
    tickLower,
    tickUpper,
    base: "MintA",
    baseAmount: params.baseAmount,
    otherAmountMax: new BN("1000000000000"),
    withMetadata: "create",
  });
  const { txId } = await tx.execute({ sendAndConfirm: true, skipPreflight: true });
  console.log(`addLiquidity tx ${txId}`);
  return { txId, tickLower, tickUpper };
}

async function collectFeesWithSdk(provider: anchor.AnchorProvider, params: {
  ray: any;
  poolId: anchor.web3.PublicKey;
  expectedTickLower?: number;
  expectedTickUpper?: number;
}) {
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
  const { txId } = await ix.execute({ sendAndConfirm: true, skipPreflight: true });
  console.log(`collectFees tx ${txId}`);
  const afterA = await getBal(ataA);
  const afterB = await getBal(ataB);
  const deltaA = afterA.sub(beforeA);
  const deltaB = afterB.sub(beforeB);
  const deltaAHuman = new Decimal(deltaA.toString()).div(new Decimal(10).pow(poolInfo.mintA.decimals)).toString();
  const deltaBHuman = new Decimal(deltaB.toString()).div(new Decimal(10).pow(poolInfo.mintB.decimals)).toString();
  console.log(`collected A raw ${deltaA.toString()} human ${deltaAHuman}`);
  console.log(`collected B raw ${deltaB.toString()} human ${deltaBHuman}`);
  return txId;
}

async function swapWithSdk(provider: anchor.AnchorProvider, params: {
  poolId: anchor.web3.PublicKey;
  inputMint: anchor.web3.PublicKey;
  amountIn: BN;
  slippageBps: number;
  ray?: any;
  noMinOut?: boolean;
}) {
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
  const { txId } = await tx.execute({ sendAndConfirm: true, skipPreflight: true });
  console.log(`swap tx ${txId}`);
  return txId;
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
    const sig = await createClmmPoolWithSdk(provider, {
      baseMint: baseMint.publicKey,
      quoteMint,
      ammConfig,
      clmmProgram,
      tickSpacing: args.tickSpacing,
      feeRateBps: args.feeRateBps,
      initPrice: args.initPrice,
      baseDecimals: args.baseDecimals,
      quoteDecimals: isWsol ? 9 : undefined,
    });
    console.log(`createPool signature ${sig}`);
    let added: { txId: string; tickLower: number; tickUpper: number } | null = null;
    if (args.liquidityBaseAmount !== "0") {
      added = await addLiquidityWithSdk(provider, {
        poolId: pdas.pool,
        tickSpacing: args.tickSpacing,
        baseDecimals: args.baseDecimals,
        baseAmount: new BN(args.liquidityBaseAmount),
        fullRange: args.fullRange === "1",
      });
    }
    if (args.swapAmount !== "0" && (args.swapDirection === "a2b" || args.swapDirection === "b2a")) {
      const inputMint = args.swapDirection === "a2b" ? baseMint.publicKey : quoteMint;
      const count = Math.max(1, args.swapCount);
      const owner: any = (provider as any).wallet?.payer || (provider as any).wallet;
      const sharedRay: any = await Raydium.load({ connection: provider.connection, owner });
      const noMinOut = args.swapNoMinOut === "1";
      if (args.swapParallel === "1") {
        const factories = Array.from({ length: count }, (_, i) => async () => {
          console.log(`swap ${i + 1}/${count}`);
          let lastErr: any = null;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              return await swapWithSdk(provider, {
                ray: sharedRay,
                poolId: pdas.pool,
                inputMint,
                amountIn: new BN(args.swapAmount),
                slippageBps: args.swapSlippageBps,
                noMinOut,
              });
            } catch (e) {
              lastErr = e;
            }
          }
          throw lastErr;
        });
        await runWithConcurrency(factories, Math.max(1, args.swapConcurrency));
      } else {
        for (let i = 0; i < count; i++) {
          console.log(`swap ${i + 1}/${count}`);
          await swapWithSdk(provider, {
            ray: sharedRay,
            poolId: pdas.pool,
            inputMint,
            amountIn: new BN(args.swapAmount),
            slippageBps: args.swapSlippageBps,
            noMinOut,
          });
        }
      }
    }

    if (args.doCollect === "1") {
      const ray = await Raydium.load({ connection: provider.connection, owner: (provider as any).wallet?.payer || (provider as any).wallet });
      await collectFeesWithSdk(provider, {
        ray,
        poolId: pdas.pool,
        expectedTickLower: added?.tickLower,
        expectedTickUpper: added?.tickUpper,
      });
    }

    await printBaseMintSupply(provider, { mint: baseMint.publicKey, decimals: args.baseDecimals });
  } catch (e) {
    console.error("Raydium SDK call failed. Ensure @raydium-io/raydium-sdk is installed and your local validator has CLMM + AmmConfig.");
    throw e;
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});


