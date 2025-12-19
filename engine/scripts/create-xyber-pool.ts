import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Command } from "commander";
import { Decimal } from "decimal.js";
import { Raydium, TxVersion, PoolUtils, ApiV3PoolInfoConcentratedItem } from "@raydium-io/raydium-sdk-v2";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { getPdaTickArrayAddress, TickUtils } from "@raydium-io/raydium-sdk-v2";

import { getExplorerUrl, initializeSdk, loadKeypair } from "./utils";

interface InitTickArrayBitmapExtensionParams<T extends TxVersion> {
  poolInfo: ApiV3PoolInfoConcentratedItem;
  txVersion: T;
}

interface InitTickArrayBitmapExtensionResult {
  execute: (opts: { sendAndConfirm: boolean }) => Promise<{ txId: string }>;
}

interface ClmmWithBitmapExtension {
  initTickArrayBitmapExtension<T extends TxVersion>(
    params: InitTickArrayBitmapExtensionParams<T>
  ): Promise<InitTickArrayBitmapExtensionResult>;
}

const program = new Command();

program
  .requiredOption("--xyber-mint <pubkey>", "XYBER token mint address")
  .option("--initial-price <number>", "Initial price (SOL per XYBER)", "10000")
  .option("--sol-amount <number>", "SOL amount for liquidity (in SOL)", "7")
  .option("--xyber-amount <number>", "XYBER amount for liquidity (with decimals)", "500000000000")
  .option("--mint-xyber", "Mint XYBER tokens to admin wallet before adding liquidity")
  .option("--mint-amount <number>", "Amount of XYBER to mint (with decimals)", "1000000000000")
  .option("--skip-liquidity", "Only create pool, skip adding liquidity")
  .parse(process.argv);

const opts = program.opts();

interface Args {
  xyberMint: anchor.web3.PublicKey;
  initialPrice: Decimal;
  solAmount: BN;
  xyberAmount: BN;
  mintXyber: boolean;
  mintAmount: bigint;
  skipLiquidity: boolean;
}

function parseArgs(): Args {
  return {
    xyberMint: new anchor.web3.PublicKey(opts.xyberMint),
    initialPrice: new Decimal(opts.initialPrice),
    solAmount: new BN(parseFloat(opts.solAmount) * anchor.web3.LAMPORTS_PER_SOL),
    xyberAmount: new BN(opts.xyberAmount),
    mintXyber: !!opts.mintXyber,
    mintAmount: BigInt(opts.mintAmount),
    skipLiquidity: !!opts.skipLiquidity,
  };
}

async function withNoLogging<T>(fn: () => Promise<T>): Promise<T> {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
}

async function main() {
  const args = parseArgs();
  const { provider, sdk } = initializeSdk();

  const payerKeypair = (provider.wallet as anchor.Wallet).payer;
  const WSOL_MINT = new anchor.web3.PublicKey("So11111111111111111111111111111111111111112");
  const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

  console.log("=== Create XYBER/SOL Pool for BuyBack ===");
  console.log("XYBER Mint:", args.xyberMint.toString());
  console.log("Initial Price:", args.initialPrice.toString(), "SOL per XYBER");

  if (args.mintXyber) {
    console.log("\n--- Minting XYBER tokens ---");
    const adminXyberAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payerKeypair,
      args.xyberMint,
      payerKeypair.publicKey
    );
    await mintTo(
      provider.connection,
      payerKeypair,
      args.xyberMint,
      adminXyberAta.address,
      payerKeypair,
      args.mintAmount
    );
    console.log("Minted XYBER tokens:", args.mintAmount.toString());
  }

  const raydium = await Raydium.load({
    owner: payerKeypair,
    connection: provider.connection,
    cluster: "mainnet",
    disableFeatureCheck: true,
    disableLoadToken: true,
    blockhashCommitment: "finalized",
  });

  const [ammConfigAddress] = sdk.getRaydiumAmmConfigPda();

  const wsolToken = {
    chainId: 101,
    address: WSOL_MINT.toString(),
    programId: TOKEN_PROGRAM_ID,
    logoURI: "",
    symbol: "SOL",
    name: "Wrapped SOL",
    decimals: 9,
    tags: [],
    extensions: {},
  };

  const xyberToken = {
    chainId: 101,
    address: args.xyberMint.toString(),
    programId: TOKEN_PROGRAM_ID,
    logoURI: "",
    symbol: "XYBER",
    name: "XYBER Token",
    decimals: 6,
    tags: [],
    extensions: {},
  };

  const ammConfigInfo = {
    id: ammConfigAddress,
    index: 0,
    protocolFeeRate: 12000,
    tradeFeeRate: 2500,
    tickSpacing: 10,
    fundFeeRate: 0,
    fundOwner: "",
    description: "",
  };

  console.log("\n--- Creating XYBER/SOL pool ---");

  const { execute, extInfo } = await raydium.clmm.createPool({
    programId: sdk.getRaydiumClmmProgramId(),
    mint1: wsolToken as any,
    mint2: xyberToken as any,
    ammConfig: ammConfigInfo as any,
    initialPrice: args.initialPrice,
    txVersion: TxVersion.V0,
  });

  const { txId } = await withNoLogging(() => execute({ sendAndConfirm: true }));
  console.log("Pool created!");
  console.log("Explorer:", getExplorerUrl(provider, txId));

  const poolId = extInfo.address.id;
  const poolState = new anchor.web3.PublicKey(poolId);
  const quoteVault = new anchor.web3.PublicKey(extInfo.address.vault.A);
  const xyberVault = new anchor.web3.PublicKey(extInfo.address.vault.B);
  const observationState = new anchor.web3.PublicKey(extInfo.address.observationId);

  console.log("\nPool addresses:");
  console.log("  Pool State:", poolState.toString());
  console.log("  Quote Vault:", quoteVault.toString());
  console.log("  XYBER Vault:", xyberVault.toString());
  console.log("  Observation:", observationState.toString());

  if (args.skipLiquidity) {
    console.log("\n--skip-liquidity flag set, skipping liquidity addition");
    return;
  }

  console.log("\n--- Adding liquidity to XYBER/SOL pool ---");

  const clmmProgram = sdk.getRaydiumClmmProgramId();
  const tickSpacing = 10;

  const MIN_TICK = -443636;
  const MAX_TICK = 443636;
  const tickLower = Math.ceil(MIN_TICK / tickSpacing) * tickSpacing;
  const tickUpper = Math.floor(MAX_TICK / tickSpacing) * tickSpacing;

  console.log("Full range position: tickLower =", tickLower, ", tickUpper =", tickUpper);

  const data = await raydium.clmm.getPoolInfoFromRpc(poolState.toString());
  const poolInfo = data.poolInfo;
  const poolKeys = data.poolKeys;
  const computePoolInfo = data.computePoolInfo;

  console.log("Adding liquidity: SOL =", args.solAmount.toString(), ", XYBER =", args.xyberAmount.toString());
  console.log("Pool mintA:", poolInfo.mintA.address, "mintB:", poolInfo.mintB.address);

  const isMintAWsol = poolInfo.mintA.address === WSOL_MINT.toString();
  console.log("Is MintA WSOL?", isMintAWsol);

  const { execute: executeOpenPosition, extInfo: positionInfo } = await raydium.clmm.openPositionFromBase({
    poolInfo,
    poolKeys,
    ownerInfo: {
      useSOLBalance: true,
    },
    tickLower,
    tickUpper,
    base: isMintAWsol ? "MintA" : "MintB",
    baseAmount: args.solAmount,
    otherAmountMax: args.xyberAmount,
    txVersion: TxVersion.V0,
  });

  const { txId: openPosTxId } = await withNoLogging(() => executeOpenPosition({ sendAndConfirm: true }));
  console.log("Position opened!");
  console.log("Explorer:", getExplorerUrl(provider, openPosTxId));

  if (computePoolInfo.tickCurrent === undefined) {
    throw new Error("Pool tickCurrent is undefined - cannot determine current tick array");
  }
  const currentPriceTick = Number(computePoolInfo.tickCurrent);
  console.log("Pool current tick:", currentPriceTick);
  const tickArrayCurrentStartIndex = TickUtils.getTickArrayStartIndexByTick(currentPriceTick, tickSpacing);
  const tickArrayLowerStartIndex = TickUtils.getTickArrayStartIndexByTick(tickLower, tickSpacing);
  const tickArrayUpperStartIndex = TickUtils.getTickArrayStartIndexByTick(tickUpper, tickSpacing);

  const tickArrayCurrentPda = getPdaTickArrayAddress(clmmProgram, poolState, tickArrayCurrentStartIndex);
  const tickArrayLowerPda = getPdaTickArrayAddress(clmmProgram, poolState, tickArrayLowerStartIndex);
  const tickArrayUpperPda = getPdaTickArrayAddress(clmmProgram, poolState, tickArrayUpperStartIndex);

  const [bitmapExtension] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("pool_tick_array_bitmap_extension"), poolState.toBuffer()],
    clmmProgram
  );

  const bitmapExtensionInfo = await provider.connection.getAccountInfo(bitmapExtension);
  if (!bitmapExtensionInfo) {
    console.log("\n--- Initializing tick array bitmap extension ---");
    const clmmWithExtension = raydium.clmm as unknown as ClmmWithBitmapExtension;
    const { execute: executeInit } = await clmmWithExtension.initTickArrayBitmapExtension({
      poolInfo,
      txVersion: TxVersion.V0,
    });
    const initResult = await withNoLogging(() => executeInit({ sendAndConfirm: true }));
    console.log("Bitmap extension initialized:", initResult.txId);
  } else {
    console.log("Bitmap extension already exists");
  }

  console.log("\n=== Pool setup complete ===");
  console.log("\nAddresses for buyback configuration:");
  console.log("  XYBER Mint:", args.xyberMint.toString());
  console.log("  Pool State:", poolState.toString());
  console.log("  Quote Vault:", quoteVault.toString());
  console.log("  XYBER Vault:", xyberVault.toString());
  console.log("  Observation State:", observationState.toString());
  console.log("  Tick Array Current:", tickArrayCurrentPda.publicKey.toString());
  console.log("  Tick Array Lower:", tickArrayLowerPda.publicKey.toString());
  console.log("  Tick Array Upper:", tickArrayUpperPda.publicKey.toString());
  console.log("  Bitmap Extension:", bitmapExtension.toString());
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
