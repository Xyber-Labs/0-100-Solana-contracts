import * as anchor from "@coral-xyz/anchor";
import { BN } from "bn.js";
import { Command } from "commander";
import { Raydium, PoolUtils } from "@raydium-io/raydium-sdk-v2";
import { getPdaTickArrayAddress, TickUtils } from "@raydium-io/raydium-sdk-v2";

import EngineSDK from "../ts-sdk/src/engine";
import IncomeDispatcherSDK from "../ts-sdk/src/income-dispatcher";
import { getExplorerUrl, getAccountUrl, loadKeypair, toPublicKey } from "../scripts/utils";
import { getRaydiumCluster } from "../scripts/raydium-utils";

const WSOL_MINT = new anchor.web3.PublicKey("So11111111111111111111111111111111111111112");

const program = new Command();

program
  .option("--pool-state <address>", "XYBER/SOL Raydium CLMM pool state address (derived from xyberMint if not provided)")
  .requiredOption("--payer <path>", "Path to payer keypair")
  .option("--slippage-bps <bps>", "Slippage tolerance in basis points (default: 100 = 1%)", "100")
  .option("--info", "Show available SOL and expected XYBER without executing buyback", false)
  .parse(process.argv);

const opts = program.opts();

function parseArgs() {
  const slippageBps = parseInt(opts.slippageBps, 10);
  if (isNaN(slippageBps) || slippageBps < 0 || slippageBps > 10000) {
    throw new Error("Slippage must be between 0 and 10000 basis points");
  }
  return {
    poolStateOverride: opts.poolState ? new anchor.web3.PublicKey(opts.poolState) : null,
    payerPath: opts.payer as string,
    slippage: slippageBps / 10000,
    infoOnly: opts.info,
  };
}

async function main() {
  const args = parseArgs();

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const engineProgram = anchor.workspace.Engine;
  const incomeDispatcherProgram = anchor.workspace.IncomeDispatcher;

  const sdk = EngineSDK.create(provider, engineProgram);
  const dispatcherSdk = IncomeDispatcherSDK.create(provider, incomeDispatcherProgram);
  const { Role } = dispatcherSdk;

  const payerKeypair = loadKeypair(args.payerPath);

  console.log(args.infoOnly ? "=== BuyBack Info ===" : "=== BuyBack Execution ===");
  console.log("Payer:", payerKeypair.publicKey.toString());

  const engineConfig = await sdk.fetchEngineConfig();
  const xyberMint = engineConfig.xyberMint as anchor.web3.PublicKey;
  console.log("XYBER Mint:", xyberMint.toString());

  const poolState = args.poolStateOverride ?? sdk.getRaydiumPoolPda(WSOL_MINT, xyberMint)[0];
  console.log("Pool State:", poolState.toString(), args.poolStateOverride ? "(override)" : "(derived)");

  const [buybackWsolTotalsPda] = dispatcherSdk.getTotalsPda(Role.BuyBack, WSOL_MINT);
  const [treasureXyberTotalsPda] = dispatcherSdk.getTotalsPda(Role.Treasure, xyberMint);

  console.log("BuyBack WSOL Totals:", getAccountUrl(provider, buybackWsolTotalsPda));
  console.log("Treasure XYBER Totals:", getAccountUrl(provider, treasureXyberTotalsPda));

  const buybackTotals = await dispatcherSdk.fetchTotals(Role.BuyBack, WSOL_MINT);
  const availableWsol = new BN(buybackTotals.harvested).sub(new BN(buybackTotals.spent));
  console.log("BuyBack WSOL harvested:", buybackTotals.harvested.toString());
  console.log("BuyBack WSOL spent:", buybackTotals.spent.toString());
  console.log("Available for buyback:", availableWsol.toString(), "lamports");

  if (availableWsol.lte(new BN(0))) {
    console.log("⏭️  No WSOL available for buyback, exiting");
    return;
  }

  console.log("Loading Raydium SDK...");
  const raydium = await Raydium.load({
    owner: payerKeypair,
    connection: provider.connection,
    cluster: getRaydiumCluster(provider),
    disableFeatureCheck: true,
    disableLoadToken: true,
    blockhashCommitment: "finalized",
  });

  console.log("Fetching pool info...");
  const poolData = await raydium.clmm.getPoolInfoFromRpc(poolState.toString());
  const poolInfo = poolData.poolInfo;
  const clmmPoolInfo = poolData.computePoolInfo;
  const tickCache = poolData.tickData;

  console.log("Pool current tick:", clmmPoolInfo.tickCurrent);
  console.log("Pool mintA:", poolInfo.mintA.address);
  console.log("Pool mintB:", poolInfo.mintB.address);

  const swapResult = await PoolUtils.computeAmountOutFormat({
    poolInfo: clmmPoolInfo,
    tickArrayCache: tickCache[poolState.toString()],
    amountIn: availableWsol,
    tokenOut: poolInfo.mintB,
    slippage: args.slippage,
    epochInfo: await raydium.fetchEpochInfo(),
  });

  const { remainingAccounts } = swapResult;
  const minXyberOut = new BN(swapResult.minAmountOut.amount.raw.toString());

  console.log("Expected XYBER out:", swapResult.amountOut.amount.raw.toString());
  console.log("Min XYBER out (with slippage):", minXyberOut.toString());
  console.log("Slippage:", (args.slippage * 100).toFixed(2) + "%");

  if (args.infoOnly) {
    return;
  }

  console.log("Computed remaining accounts:", remainingAccounts.length);

  const currentTickArrayStartIndex = TickUtils.getTickArrayStartIndexByTick(
    clmmPoolInfo.tickCurrent,
    poolInfo.config.tickSpacing
  );
  const currentTickArrayPda = getPdaTickArrayAddress(
    sdk.getRaydiumClmmProgramId(),
    poolState,
    currentTickArrayStartIndex
  );

  const swapRemainingAccounts = remainingAccounts.map((acc) => ({
    pubkey: toPublicKey(acc),
    isWritable: true,
    isSigner: false as const,
  }));

  if (swapRemainingAccounts.length === 0) {
    console.log("No tick arrays from SDK, using current tick array");
    swapRemainingAccounts.push({ pubkey: currentTickArrayPda.publicKey, isWritable: true, isSigner: false });
  }

  const [bitmapExtension] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("pool_tick_array_bitmap_extension"), poolState.toBuffer()],
    sdk.getRaydiumClmmProgramId()
  );
  swapRemainingAccounts.push({ pubkey: bitmapExtension, isWritable: false, isSigner: false });

  console.log("Swap remaining accounts:");
  swapRemainingAccounts.forEach((acc, i) => {
    console.log(`  [${i}] ${acc.pubkey.toString()} (writable: ${acc.isWritable})`);
  });

  const [ammConfigAddress] = sdk.getRaydiumAmmConfigPda();
  const [quoteVault] = sdk.getRaydiumPoolVaultPda(poolState, WSOL_MINT);
  const [xyberVault] = sdk.getRaydiumPoolVaultPda(poolState, xyberMint);
  const [observationState] = sdk.getRaydiumObservationStatePda(poolState);

  console.log("Pool accounts:");
  console.log("  AMM Config:", ammConfigAddress.toString());
  console.log("  Quote Vault:", quoteVault.toString());
  console.log("  XYBER Vault:", xyberVault.toString());
  console.log("  Observation State:", observationState.toString());

  console.log("Executing buyback...");
  const result = await dispatcherSdk.buyback({
    minXyberOut,
    xyberMint,
    raydiumPoolState: poolState,
    raydiumAmmConfig: ammConfigAddress,
    raydiumQuoteVault: quoteVault,
    raydiumXyberVault: xyberVault,
    raydiumObservationState: observationState,
    remainingAccounts: swapRemainingAccounts,
    engineProgramId: engineProgram.programId,
    raydiumProgramId: sdk.getRaydiumClmmProgramId(),
    signers: [payerKeypair],
  });

  console.log("✅ BuyBack executed!");
  console.log("Transaction:", result.signature);
  console.log("Explorer:", getExplorerUrl(provider, result.signature));

  const treasureXyberTotals = await dispatcherSdk.fetchTotals(Role.Treasure, xyberMint);
  console.log("Treasure XYBER harvested:", treasureXyberTotals.harvested.toString());
}

main().catch((error) => {
  console.error("❌ BuyBack failed:");
  console.error(error);
  if (error.logs) {
    console.error("Program logs:");
    error.logs.forEach((log: string) => console.error(log));
  }
  process.exit(1);
});
