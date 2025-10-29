import { fromWorkspace, LiteSVMProvider } from "anchor-litesvm";
import { LiteSVM } from "litesvm";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { assert } from "chai";

import { Engine } from "../target/types/engine";
import EngineSDK from "../ts-sdk/src/engine";

import { createAndFundAccount } from "./utils";
import { setupRaydiumCLMM } from "./raydium-setup";
import { executeTraderSwaps } from "./raydium-swap";

let client: LiteSVM;
let provider: LiteSVMProvider;
let program: Program<Engine>;
let admin: anchor.Wallet;
let sdk: ReturnType<typeof EngineSDK.create>;
let adminKeypair: anchor.web3.Keypair;

describe("engine litesvm - raydium clmm", () => {
  let raydiumProgramId: anchor.web3.PublicKey;
  let raydiumAmmConfig: anchor.web3.PublicKey;
  let clmmSaleMint: anchor.web3.Keypair;
  let clmmLaunchState: anchor.web3.PublicKey;
  let baseMintKeypair: anchor.web3.Keypair;
  let createPoolResultTx: any;
  let addLiquidityResultTx: any;

  const WSOL_MINT = new anchor.web3.PublicKey("So11111111111111111111111111111111111111112");
  const MIN_RAISE_LAMPORTS = new anchor.BN(10 * anchor.web3.LAMPORTS_PER_SOL);
  const PER_WALLET_CAP = new anchor.BN(5 * anchor.web3.LAMPORTS_PER_SOL);
  const TAU_LAMPORTS = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);
  const ROSTER_SHARD_CAP = 100;
  const CLMM_HARD_CAP = new anchor.BN(500 * anchor.web3.LAMPORTS_PER_SOL);
  const CLMM_SALE_ALLOCATION = new anchor.BN(540_540_000);
  const CLMM_LP_ALLOCATION = new anchor.BN(459_460_000);

  before(async () => {
    client = fromWorkspace("./");
    provider = new LiteSVMProvider(client);
    anchor.setProvider(provider);
    program = anchor.workspace.engine as Program<Engine>;
    admin = provider.wallet;
    adminKeypair = (provider.wallet as any).payer;
    sdk = EngineSDK.create(provider as any, program as any, adminKeypair);
    client.airdrop(admin.publicKey, BigInt(500 * anchor.web3.LAMPORTS_PER_SOL));

    const raydiumSetup = await setupRaydiumCLMM(client);
    raydiumProgramId = raydiumSetup.raydiumProgramId;
    raydiumAmmConfig = raydiumSetup.ammConfig;
  });

  it("Initializes launch and collects deposits", async () => {
    console.log("=== Initializing Launch ===");

    clmmSaleMint = anchor.web3.Keypair.generate();

    const { initLaunchTx, signers, launchState } = await sdk.initLaunchTx({
      creator: admin.publicKey,
      saleMint: clmmSaleMint,
      hardCapLamports: CLMM_HARD_CAP,
      minRaiseLamports: MIN_RAISE_LAMPORTS,
      perWalletCap: PER_WALLET_CAP,
      tauLamports: TAU_LAMPORTS,
      saleAllocation: CLMM_SALE_ALLOCATION,
      lpAllocation: CLMM_LP_ALLOCATION,
      fundingDurationSeconds: 3600,
      rosterShardCap: ROSTER_SHARD_CAP,
      creatorInitialDepositLamports: new anchor.BN(0),
      creatorDailyLamportsLimit: new anchor.BN(0),
      creatorClaimLockPeriodSec: new anchor.BN(2),
      provider,
    });

    clmmLaunchState = launchState;

    console.log("Launch state PDA:", clmmLaunchState.toString());
    console.log("Sale mint:", clmmSaleMint.publicKey.toString());
    try {
      const initLaunchSignature = await provider.sendAndConfirm(initLaunchTx, [admin.payer, ...signers]);
      console.log("✅ Launch initialized:", initLaunchSignature);

      const accountInfo = client.getAccount(clmmLaunchState);
      if (accountInfo) {
        console.log("✅ Launch state account exists, size:", accountInfo.data.length);
      } else {
        console.error("❌ Launch state account NOT created!");
      }
    } catch (error) {
      console.error("Failed to initialize launch:", error);
      throw error;
    }
    console.log("Fetching launch state...");
    const launchStateAccountRaw = client.getAccount(clmmLaunchState);
    console.log("Direct client check - account exists:", !!launchStateAccountRaw);

    const providerClient = (provider.connection as any).client;
    const providerAccount = providerClient?.getAccount(clmmLaunchState);
    console.log("Provider client check - account exists:", !!providerAccount);
    console.log("Same client?", client === providerClient);

    console.log("About to call sdk.fetchLaunch with:", clmmLaunchState.toString());
    const launchStateData = await sdk.fetchLaunch(clmmLaunchState);
    console.log("Launch state verified:", launchStateData.projectId.toString());

    await sdk.initRoster({ launch: clmmLaunchState, signers: [admin.payer] });
    await sdk.initRosterShard({ launch: clmmLaunchState, shardId: 0 });

    const targetRaise = 300;
    console.log(`Target raise: ${targetRaise} SOL (fixed for testing)`);

    let totalRaised = 0;
    while (totalRaised < targetRaise) {
      const depositAmount = Math.min(PER_WALLET_CAP.toNumber() / anchor.web3.LAMPORTS_PER_SOL, targetRaise - totalRaised);
      const depositor = await createAndFundAccount(client, Math.ceil(depositAmount) + 1);
      await sdk.deposit({
        launch: clmmLaunchState,
        amountLamports: new anchor.BN(depositAmount * anchor.web3.LAMPORTS_PER_SOL),
        userKeypair: depositor
      });
      totalRaised += depositAmount;
    }

    console.log(`Total raised: ${totalRaised} SOL`);
  });

  it("Creates CLMM pool on Raydium", async () => {
    console.log("=== Creating CLMM Pool ===");

    console.log("Raydium CLMM setup:");
    console.log("CLMM Program:", raydiumProgramId.toString());
    console.log("Quote Mint (WSOL):", WSOL_MINT.toString());
    console.log("AMM Config:", raydiumAmmConfig.toString());

    const SYSVAR_CLOCK_PUBKEY = new anchor.web3.PublicKey("SysvarC1ock11111111111111111111111111111111");
    const currentClock = client.getClock();
    const futureTimestamp = BigInt(Math.floor(Date.now() / 1000));

    const clockData = Buffer.alloc(40);
    clockData.writeBigUInt64LE(currentClock.slot + 100n, 0);
    clockData.writeBigInt64LE(BigInt(futureTimestamp), 8);
    clockData.writeBigUInt64LE(0n, 16);
    clockData.writeBigUInt64LE(0n, 24);
    clockData.writeBigInt64LE(BigInt(futureTimestamp), 32);

    client.setAccount(SYSVAR_CLOCK_PUBKEY, {
      lamports: 1_000_000n,
      data: clockData,
      owner: anchor.web3.SystemProgram.programId,
      executable: false,
    });

    const clock = client.getClock();
    console.log("Updated clock:", {
      slot: clock.slot.toString(),
      unixTimestamp: clock.unixTimestamp.toString(),
    });

    do {
      baseMintKeypair = anchor.web3.Keypair.generate();
    } while (baseMintKeypair.publicKey.toBuffer().compare(WSOL_MINT.toBuffer()) <= 0);

    createPoolResultTx = await sdk.createClmmPoolTx({
      payer: admin.publicKey,
      launch: clmmLaunchState,
      quoteMint: WSOL_MINT,
      baseMint: baseMintKeypair,
      ammConfig: raydiumAmmConfig,
      clmmProgram: raydiumProgramId,
      provider,
    });

    console.log("Creating CLMM pool...");
    const poolSig = await provider.sendAndConfirm(
      createPoolResultTx.transaction,
      [admin.payer, ...createPoolResultTx.signers]
    );
    console.log("✅ Pool created:", poolSig);

    const poolStateAccount = client.getAccount(createPoolResultTx.poolState);
    assert.ok(poolStateAccount, "Pool state should exist");
    console.log("✅ Pool account exists");
    console.log("Pool data size:", poolStateAccount.data.length, "bytes");
    console.log("Pool owner:", new anchor.web3.PublicKey(poolStateAccount.owner).toString());

    assert.ok(createPoolResultTx.baseMint, "Should return base mint");
    assert.ok(createPoolResultTx.baseTokenAta, "Should return base token ATA");
  });

  it("Adds liquidity to CLMM pool", async () => {
    console.log("=== Adding Liquidity ===");

    const [escrow] = sdk.getEscrowPda(clmmLaunchState);
    const escrowBalanceBefore = client.getBalance(escrow);
    console.log(`Escrow balance before liquidity: ${Number(escrowBalanceBefore) / anchor.web3.LAMPORTS_PER_SOL} SOL`);

    const launchData = await program.account.launchState.fetch(clmmLaunchState);

    const LP_POOL_ALLOCATION = 440_000_000;
    const baseAmount = new anchor.BN(LP_POOL_ALLOCATION);

    const quoteAmountLamports = launchData.totalDeposited instanceof anchor.BN
      ? launchData.totalDeposited
      : new anchor.BN(launchData.totalDeposited);

    const quoteAmountWhole = quoteAmountLamports.div(new anchor.BN(anchor.web3.LAMPORTS_PER_SOL));

    console.log(`Base amount: ${baseAmount.toString()} (${Number(baseAmount) / 1e9} tokens)`);
    console.log(`Quote amount: ${quoteAmountWhole.toString()} SOL (${quoteAmountLamports.toString()} lamports)`);

    const rangeParams = await sdk.calculateLiquidityRange({
      launch: clmmLaunchState,
      baseAmount: new anchor.BN(440000000),
      quoteAmount: new anchor.BN(300),
    });

    console.log("Calculated range params:");
    console.log(`  Current tick: ${rangeParams.currentTick}`);
    console.log(`  Tick lower: ${rangeParams.tickLower}`);
    console.log(`  Tick upper: ${rangeParams.tickUpper}`);
    console.log(`  Tick array lower start: ${rangeParams.tickArrayLowerStartIndex}`);
    console.log(`  Tick array upper start: ${rangeParams.tickArrayUpperStartIndex}`);

    let addLiquidityResultTx = await sdk.addClmmLiquidityTx({
      payer: admin.publicKey,
      launch: clmmLaunchState,
      quoteMint: WSOL_MINT,
      baseMint: baseMintKeypair.publicKey,
      baseTokenAta: createPoolResultTx.baseTokenAta,
      ammConfig: raydiumAmmConfig,
      clmmProgram: raydiumProgramId,
      provider,
      tickLowerIndex: rangeParams.tickLower,
      tickUpperIndex: rangeParams.tickUpper,
      tickArrayLowerStartIndex: rangeParams.tickArrayLowerStartIndex,
      tickArrayUpperStartIndex: rangeParams.tickArrayUpperStartIndex,
    });

    console.log("Adding liquidity...");
    addLiquidityResultTx.transaction.feePayer = adminKeypair.publicKey;
    addLiquidityResultTx.transaction.recentBlockhash = client.latestBlockhash();
    addLiquidityResultTx.transaction.sign(adminKeypair, ...addLiquidityResultTx.signers);

    const txResult = client.sendTransaction(addLiquidityResultTx.transaction);

    console.log("\n=== Transaction Result ===");
    console.log("Error:", txResult.err ? txResult.err() : "none");

    // const logs = txResult.logs();
    // console.log("\n=== Transaction Logs ===");
    // logs.forEach((log: string) => console.log(log));

    if (txResult.err) {
      console.log("\nTransaction failed!");
      throw new Error(`Transaction failed: ${txResult.err()}`);
    }

    console.log("\n✅ Liquidity transaction sent");

    
  });

  it.skip("Executes trader swaps to accumulate fees", async () => {
    console.log("=== Executing Trader Swaps ===");

    console.log("=== Checking Available Tick Arrays ===");
    const tickSpacing = 60;
    const TICK_ARRAY_SIZE = 60;
    const tickArrayInterval = tickSpacing * TICK_ARRAY_SIZE;

    const existingTickArrays = [];
    for (let i = -442800; i <= 442800; i += tickArrayInterval) {
      const buffer = Buffer.alloc(4);
      buffer.writeInt32BE(i, 0);
      const [tickArray] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("tick_array"), createPoolResultTx.poolState.toBuffer(), buffer],
        raydiumProgramId
      );
      const account = client.getAccount(tickArray);
      if (account && new anchor.web3.PublicKey(account.owner).equals(raydiumProgramId)) {
        existingTickArrays.push(i);
        console.log(`✅ Tick array at ${i} exists`);
      }
    }
    console.log(`Found ${existingTickArrays.length} existing tick arrays:`, existingTickArrays);

    const poolStateAccount = client.getAccount(createPoolResultTx.poolState);
    let currentTick = 0;
    let currentTickArrayIndex = 0;
    if (poolStateAccount) {
      const poolData = Buffer.from(poolStateAccount.data);
      currentTick = poolData.readInt32LE(269);
      console.log(`Pool current tick: ${currentTick}`);

      let tickArrayStart = Math.trunc(currentTick / tickArrayInterval);
      if (currentTick < 0 && currentTick % tickArrayInterval !== 0) {
        tickArrayStart = tickArrayStart - 1;
      }
      currentTickArrayIndex = tickArrayStart * tickArrayInterval;
      console.log(`Current tick should be in tick array: ${currentTickArrayIndex}`);

      if (!existingTickArrays.includes(currentTickArrayIndex)) {
        console.log(`⚠️ Missing tick array for current price at ${currentTickArrayIndex}`);
        console.log(`Pool cannot execute swaps until this tick array is created.`);
        console.log(`In production, the first trader will create this tick array.`);
      }
    }

    const quoteVaultBalanceBefore = client.getBalance(addLiquidityResultTx.quoteVault);
    const baseVaultAccountBefore = client.getAccount(addLiquidityResultTx.baseVault);
    assert.ok(baseVaultAccountBefore, "Base vault should exist");

    const baseVaultDataBefore = Buffer.from(baseVaultAccountBefore.data);
    const baseVaultAmountBefore = baseVaultDataBefore.readBigUInt64LE(64);

    console.log("Quote vault balance before swaps:", Number(quoteVaultBalanceBefore) / anchor.web3.LAMPORTS_PER_SOL, "SOL");
    console.log("Base vault amount before swaps:", Number(baseVaultAmountBefore) / 1_000_000, "tokens");

    const numTraders = 5;
    const traders: anchor.web3.Keypair[] = [];
    for (let i = 0; i < numTraders; i++) {
      const trader = await createAndFundAccount(client, 10);
      traders.push(trader);
    }

    await executeTraderSwaps(
      traders,
      WSOL_MINT,
      baseMintKeypair.publicKey,
      createPoolResultTx.poolState,
      raydiumAmmConfig,
      raydiumProgramId,
      provider
    );

    console.log("=== Verifying Fee Accumulation ===");
    const quoteVaultBalanceAfter = client.getBalance(addLiquidityResultTx.quoteVault);
    const baseVaultAccountAfter = client.getAccount(addLiquidityResultTx.baseVault);
    assert.ok(baseVaultAccountAfter, "Base vault should exist after swaps");

    const baseVaultDataAfter = Buffer.from(baseVaultAccountAfter.data);
    const baseVaultAmountAfter = baseVaultDataAfter.readBigUInt64LE(64);

    console.log("Quote vault balance after swaps:", Number(quoteVaultBalanceAfter) / anchor.web3.LAMPORTS_PER_SOL, "SOL");
    console.log("Base vault amount after swaps:", Number(baseVaultAmountAfter) / 1_000_000, "tokens");

    const quoteVaultBalanceChange = Number(quoteVaultBalanceAfter) - Number(quoteVaultBalanceBefore);
    const baseVaultAmountChange = Number(baseVaultAmountAfter) - Number(baseVaultAmountBefore);

    console.log("Quote vault balance change:", quoteVaultBalanceChange / anchor.web3.LAMPORTS_PER_SOL, "SOL");
    console.log("Base vault token amount change:", baseVaultAmountChange / 1_000_000, "tokens");

    assert.ok(
      Math.abs(quoteVaultBalanceChange) > 0 || Math.abs(baseVaultAmountChange) > 0,
      "Vaults should have balance changes after swaps"
    );

    console.log("✅ Trader swaps executed and fees accumulated successfully");
  });
});
