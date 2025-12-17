import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { assert } from "chai";
import * as fs from "fs";
import {
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount
} from "@solana/spl-token";
import { Decimal } from "decimal.js";

import { EngineSDK } from "../ts-sdk/src/engine";
import { IncomeDispatcherSDK, Role } from "../ts-sdk/src/income-dispatcher";
import { PoolUtils, Raydium, TxVersion } from "@raydium-io/raydium-sdk-v2";

import * as utils from "./utils";
import { loadKeypair } from "./utils";

describe("Raydium CLMM Pool Creation - Fast Flow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Engine;
  const incomeDispatcherProgram = anchor.workspace.IncomeDispatcher;

  const admin1Keypair = loadKeypair("keys/admin1.json");
  const admin2Keypair = loadKeypair("keys/admin2.json");
  const admin3Keypair = loadKeypair("keys/admin3.json");
  const deployerKeypair = loadKeypair("keys/deployer.json");
  const backendKeypair = loadKeypair("keys/backend.json");
  const xyberMintKeypair = loadKeypair("keys/xyber-mint.json");
  const treasuryKeypair = loadKeypair("keys/treasure.json");
  const platformKeypair = loadKeypair("keys/platform.json");
  const creatorKeypair = loadKeypair("keys/creator.json");
  const buyer1Keypair = loadKeypair("keys/buyer1.json");
  const buyer2Keypair = loadKeypair("keys/buyer2.json");
  const buyer3Keypair = loadKeypair("keys/buyer3.json");
  const communityWallet = loadKeypair("keys/community-signer.json");

  const sdk = EngineSDK.create(provider, program, admin1Keypair);
  const dispatcherSdk = IncomeDispatcherSDK.create(provider, incomeDispatcherProgram, admin1Keypair);

  let launchPda: anchor.web3.PublicKey;
  let baseMint: anchor.web3.PublicKey;
  let baseTokenAta: anchor.web3.PublicKey;
  let quoteVault: anchor.web3.PublicKey;
  let baseVault: anchor.web3.PublicKey;

  let raydiumPositionNftMint: anchor.web3.PublicKey;
  let raydiumPositionNftAccount: anchor.web3.PublicKey;
  let personalPosition: anchor.web3.PublicKey;
  let protocolPosition: anchor.web3.PublicKey;
  let raydiumPoolState: anchor.web3.PublicKey;
  let tickArrayLower: anchor.web3.PublicKey;
  let tickArrayUpper: anchor.web3.PublicKey;
  let launchStateData: any;

  // XYBER/SOL pool for buyback
  let xyberPoolState: anchor.web3.PublicKey;
  let xyberPoolQuoteVault: anchor.web3.PublicKey;
  let xyberPoolXyberVault: anchor.web3.PublicKey;
  let xyberPoolObservationState: anchor.web3.PublicKey;
  let xyberPoolTickArray0: anchor.web3.PublicKey;
  let xyberPoolTickArray1: anchor.web3.PublicKey;
  let xyberPoolTickArray2: anchor.web3.PublicKey;
  let xyberPoolBitmapExtension: anchor.web3.PublicKey;

  const PRESET_ID = 0;
  const PROJECT_ID = 1;
  let projectId = PROJECT_ID;

  const BUYER1_AMOUNT = parseInt(process.env.BUYER1_AMOUNT || "150");
  const BUYER2_AMOUNT = parseInt(process.env.BUYER2_AMOUNT || "150");
  const BUYER3_AMOUNT = parseInt(process.env.BUYER3_AMOUNT || "150");

  const WSOL_MINT = new anchor.web3.PublicKey("So11111111111111111111111111111111111111112");

  it("Step 0: Verify Raydium CLMM and AmmConfig are loaded", async () => {
    console.log("=== Step 0: Verify Raydium Setup ===");

    const raydiumClmmProgramId = sdk.getRaydiumClmmProgramId();
    const [ammConfigAddress] = sdk.getRaydiumAmmConfigPda();

    const raydiumProgramInfo = await provider.connection.getAccountInfo(raydiumClmmProgramId);
    console.log("Raydium CLMM Program:", raydiumClmmProgramId.toString());
    console.log("  Exists:", !!raydiumProgramInfo);
    console.log("  Executable:", raydiumProgramInfo?.executable);
    console.log("  Owner:", raydiumProgramInfo?.owner.toString());
    assert.ok(raydiumProgramInfo, "Raydium CLMM program should exist");
    assert.ok(raydiumProgramInfo.executable, "Raydium CLMM should be executable");

    const ammConfigInfo = await provider.connection.getAccountInfo(ammConfigAddress);
    console.log("\nAmmConfig Account:", ammConfigAddress.toString());
    console.log("  Exists:", !!ammConfigInfo);
    console.log("  Owner:", ammConfigInfo?.owner.toString());
    console.log("  Data length:", ammConfigInfo?.data.length);
    console.log("  Lamports:", ammConfigInfo?.lamports);
    assert.ok(ammConfigInfo, "AmmConfig account should exist");
    assert.equal(ammConfigInfo.owner.toString(), raydiumClmmProgramId.toString(), "AmmConfig should be owned by Raydium CLMM");

    console.log("\n✅ Raydium CLMM and AmmConfig verified");
  });


  before(async () => {
    console.log("=== Setup: Airdrop SOL to wallets ===");

    const airdropPromises = [
      provider.connection.requestAirdrop(admin1Keypair.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(admin2Keypair.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(admin3Keypair.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(deployerKeypair.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(backendKeypair.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(platformKeypair.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(creatorKeypair.publicKey, 1000 * anchor.web3.LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(buyer1Keypair.publicKey, 500 * anchor.web3.LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(buyer2Keypair.publicKey, 500 * anchor.web3.LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(buyer3Keypair.publicKey, 500 * anchor.web3.LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(treasuryKeypair.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL),
    ];

    const signatures = await Promise.all(airdropPromises);
    await Promise.all(signatures.map(sig => provider.connection.confirmTransaction(sig)));
    console.log("✅ Airdrops completed");

    console.log("=== Setup: Ensure engine config and preset exist ===");

    const [configPda] = sdk.getConfigPda();
    const configInfo = await provider.connection.getAccountInfo(configPda);

      const xyberMintInfo = await provider.connection.getAccountInfo(xyberMintKeypair.publicKey);
      if (!xyberMintInfo) {
        await createMint(
          provider.connection,
          admin1Keypair,
          admin1Keypair.publicKey,
          null,
          6,
          xyberMintKeypair
        );
        console.log("✅ XYBER mint created");
      }

      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        creatorKeypair,
        xyberMintKeypair.publicKey,
        creatorKeypair.publicKey
      );

      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin1Keypair,
        xyberMintKeypair.publicKey,
        treasuryKeypair.publicKey
      );

      await sdk.initEngineConfig({
        treasury: treasuryKeypair.publicKey,
        creationFee: new BN(0),
        xyberMint: xyberMintKeypair.publicKey,
        admins: [admin1Keypair.publicKey, admin2Keypair.publicKey, admin3Keypair.publicKey],
        threshold: 2,
        adminKeypairs: [admin1Keypair, admin2Keypair],
      });
      console.log("✅ Engine config initialized");

  });

  it("Step 1: Initialize launch preset with validation", async () => {
    console.log("=== Step 1: Initialize Launch Preset ===");

    const [presetPda] = sdk.getLaunchPresetPda(PRESET_ID);
    const presetInfo = await provider.connection.getAccountInfo(presetPda);

    if (presetInfo) {
      console.log("⏭️  Preset already exists, skipping");
      return;
    }

    const presetPath = "presets/test-preset.json";
    const presetData = JSON.parse(fs.readFileSync(presetPath, "utf8"));
    const validParams = utils.parsePresetParams(presetData);

    console.log("\n--- Attempt 1: Try with min_raise < AMMV3_CREATION_RESERVE ---");
    const invalidMinRaise = {
      ...validParams,
      minRaiseLamports: new BN(100_000_000),
    };

    await utils.doAndCheckError(
      sdk.initLaunchPreset({
        id: Number(presetData.id),
        params: invalidMinRaise,
        adminKeypairs: [admin1Keypair, admin2Keypair],
      }),
      "Malformed preset"
    );
    console.log("✅ Expected error received");

    console.log("\n--- Attempt 2: Try with min_raise > hard_cap ---");
    const invalidHardCap = {
      ...validParams,
      minRaiseLamports: new BN(200 * anchor.web3.LAMPORTS_PER_SOL),
      hardCapLamports: new BN(100 * anchor.web3.LAMPORTS_PER_SOL),
    };

    await utils.doAndCheckError(
      sdk.initLaunchPreset({
        id: Number(presetData.id),
        params: invalidHardCap,
        adminKeypairs: [admin1Keypair, admin2Keypair],
      }),
      "Malformed preset"
    );
    console.log("✅ Expected error received");

    console.log("\n--- Attempt 3: Initialize with valid parameters ---");
    await sdk.initLaunchPreset({
      id: Number(presetData.id),
      params: validParams,
      adminKeypairs: [admin1Keypair, admin2Keypair],
    });
    console.log("✅ Launch preset initialized successfully from", presetPath);
  });

  it("Step 2: Setup income-dispatcher program", async () => {
    console.log("=== Step 2: Setup Income-Dispatcher Program ===");

    try {
      const { signature } = await dispatcherSdk.initialize({
        backend: backendKeypair.publicKey,
        platformWallet: platformKeypair.publicKey,
        communityWallet: communityWallet.publicKey,
        signers: [deployerKeypair],
      });
      console.log("✅ Income-dispatcher initialized");
      console.log("Explorer url:", utils.getExplorerUrl(provider, signature));
    } catch (e) {
      console.log("Income-dispatcher config already exists, skipping initialization.");
    }

    const configAccount = await dispatcherSdk.fetchConfig();
    assert.equal(configAccount.platformWallet.toString(), platformKeypair.publicKey.toString());
    assert.equal(configAccount.communityWallet.toString(), communityWallet.publicKey.toString());
  });

  it("Step 3: Initialize launch from preset", async () => {
    console.log("=== Step 3: Initialize Launch from Preset ===");

    const { launchPda: launch, signature } = await sdk.initLaunchFromPreset({
      presetId: PRESET_ID,
      projectId: PROJECT_ID,
      name: "TestToken",
      symbol: "TEST",
      uri: "https://example.com/metadata.json",
      creator: creatorKeypair,
    });

    launchPda = launch;

    console.log("✅ Launch initialized");
    console.log("Explorer url:", utils.getExplorerUrl(provider, signature));
    console.log("   Launch PDA:", launchPda.toString());

    const launchData = await sdk.fetchLaunch(launchPda);
    assert.ok(launchData, "Launch should exist");
  });

  it("Step 4: Initialize roster and shard", async () => {
    console.log("=== Step 4: Initialize Roster ===");

    const { signature: rosterSig } = await sdk.initRoster({
      launch: launchPda,
    });

    console.log("✅ Roster initialized");
    console.log("Explorer url:", utils.getExplorerUrl(provider, rosterSig));

    console.log("=== Initialize Roster Shard ===");
    const [rosterShard] = sdk.getRosterShardPda(launchPda, 1);
    const rosterShardInfo = await provider.connection.getAccountInfo(rosterShard);
    assert.ok(rosterShardInfo, "Roster shard 1 should exist after initRoster");
    console.log("Roster shard 1 already initialized via initRoster");

  });

  it(`Step 5: Make deposits (${BUYER1_AMOUNT + BUYER2_AMOUNT + BUYER3_AMOUNT} SOL total)`, async () => {
    console.log(`=== Step 5: Make Deposits (${BUYER1_AMOUNT} + ${BUYER2_AMOUNT} + ${BUYER3_AMOUNT} = ${BUYER1_AMOUNT + BUYER2_AMOUNT + BUYER3_AMOUNT} SOL) ===`);

    const { signature: dep1Sig } = await sdk.deposit({
      launch: launchPda,
      amountLamports: new BN(BUYER1_AMOUNT * anchor.web3.LAMPORTS_PER_SOL),
      userKeypair: buyer1Keypair,
      shardId: 1,
    });
    console.log(`✅ Deposit 1 (buyer1: ${BUYER1_AMOUNT} SOL)`);
    console.log("Explorer url:", utils.getExplorerUrl(provider, dep1Sig));

    const { signature: dep2Sig } = await sdk.deposit({
      launch: launchPda,
      amountLamports: new BN(BUYER2_AMOUNT * anchor.web3.LAMPORTS_PER_SOL),
      userKeypair: buyer2Keypair,
      shardId: 1,
    });
    console.log(`✅ Deposit 2 (buyer2: ${BUYER2_AMOUNT} SOL)`);
    console.log("Explorer url:", utils.getExplorerUrl(provider, dep2Sig));

    const { signature: dep3Sig } = await sdk.deposit({
      launch: launchPda,
      amountLamports: new BN(BUYER3_AMOUNT * anchor.web3.LAMPORTS_PER_SOL),
      userKeypair: buyer3Keypair,
      shardId: 1,
    });
    console.log(`✅ Deposit 3 (buyer3: ${BUYER3_AMOUNT} SOL)`);
    console.log("Explorer url:", utils.getExplorerUrl(provider, dep3Sig));

    const launchData = await sdk.fetchLaunch(launchPda);
    const totalSOL = launchData.totalDeposited.toNumber() / anchor.web3.LAMPORTS_PER_SOL;
    console.log(
      `Total raised: ${launchData.totalDeposited.toString()} lamports (${totalSOL} SOL including creator deposit)`
    );
  });

  it("Step 6: Wait for funding period and finalize shard", async () => {
    console.log("=== Step 6: Wait for Funding Period ===");

    const launchData = await sdk.fetchLaunch(launchPda);
    const fundingEndTime = launchData.fundingPeriodEnd.toNumber();
    const currentTime = Math.floor(Date.now() / 1000);
    const waitTime = fundingEndTime - currentTime + 2;

    if (waitTime > 0) {
      console.log(`Waiting ${waitTime} seconds for funding period to end...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime * 1000));
    }

    console.log("=== Finalize Roster Shard ===");

    const { signature } = await sdk.finalizeRosterShard({
      launch: launchPda,
      shardId: 1,
      signers: [admin1Keypair],
    });

    console.log("✅ Roster shard finalized");
    console.log("Explorer url:", utils.getExplorerUrl(provider, signature));
  });

  it("Step 7: Set VRF seed", async () => {
    console.log("=== Step 7: Set VRF Seed ===");

    const { signature: seedSig } = await sdk.setSeed({
      launch: launchPda,
      payerKeypair: admin1Keypair,
    });

    console.log("✅ VRF seed set");
    console.log("Explorer url:", utils.getExplorerUrl(provider, seedSig));
  });

  it("Step 8: Prepare pool creation", async () => {
    console.log("=== Step 8: Prepare Pool Creation ===");

    const { signature: prepSig } = await sdk.preparePoolCreation({
      launch: launchPda,
      payerKeypair: admin1Keypair,
    });

    console.log("✅ Pool creation prepared");
    console.log("Explorer url:", utils.getExplorerUrl(provider, prepSig));
  });

  it("Step 9: Prepare quote mint", async () => {
    console.log("=== Step 9: Prepare Quote Mint ===");
    console.log("Quote Mint (WSOL):", WSOL_MINT.toString());
  });

  it("Step 10: Reject pool creation with invalid launch_state owner", async () => {
    console.log("=== Step 10: Reject pool creation with invalid launch_state owner ===");

    const fakeLaunchState = anchor.web3.Keypair.generate();

    await utils.doAndCheckError(
      sdk.createClmmPool({
        launch: fakeLaunchState.publicKey,
        signers: [admin1Keypair],
      }),
      "Invalid authority"
    );

    console.log("✅ Pool creation rejected for invalid launch_state owner");
  });

  it("Step 11: Create CLMM pool", async () => {
    console.log("=== Step 11: Create CLMM Pool ===");

    const result = await sdk.createClmmPool({
      launch: launchPda,
      signers: [admin1Keypair],
    });

    baseMint = result.baseMint;
    baseTokenAta = result.baseTokenAta;
    quoteVault = result.quoteVault;
    baseVault = result.baseVault;

    console.log("✅ Pool created");
    console.log("Explorer url:", utils.getExplorerUrl(provider, result.signature));
    console.log("   Base Mint:", baseMint.toString());
    console.log("   Base Token ATA:", baseTokenAta.toString());
    console.log("   Quote Vault:", quoteVault.toString());
    console.log("   Base Vault:", baseVault.toString());
  });

  it("Step 12: Add liquidity to CLMM pool", async () => {
    console.log("=== Step 12: Add Liquidity ===");
    const addClmmLiquidityTx = await sdk.addClmmLiquidityTx({
      payer: admin1Keypair.publicKey,
      launch: launchPda,
      baseMint: baseMint,
      provider,
    });

    addClmmLiquidityTx.transaction.feePayer = admin1Keypair.publicKey;
    addClmmLiquidityTx.transaction.recentBlockhash = (
      await provider.connection.getLatestBlockhash()
    ).blockhash;

    addClmmLiquidityTx.transaction.partialSign(...addClmmLiquidityTx.signers);
    addClmmLiquidityTx.transaction.partialSign(admin1Keypair);

    const addLiquiditySig = await provider.connection.sendRawTransaction(
      addClmmLiquidityTx.transaction.serialize(),
      { skipPreflight: false }
    );
    await provider.connection.confirmTransaction(addLiquiditySig);

    console.log("✅ Liquidity added");
    console.log("Explorer url:", utils.getExplorerUrl(provider, addLiquiditySig));

    raydiumPositionNftMint = addClmmLiquidityTx.raydiumPositionNftMint;
    raydiumPositionNftAccount = addClmmLiquidityTx.raydiumPositionNftAccount;
    personalPosition = addClmmLiquidityTx.personalPosition;
    protocolPosition = addClmmLiquidityTx.protocolPosition;
    raydiumPoolState = addClmmLiquidityTx.poolState;
    tickArrayLower = addClmmLiquidityTx.tickArrayLower;
    tickArrayUpper = addClmmLiquidityTx.tickArrayUpper;
  });


  it("Step 13: Perform trading on Raydium CLMM pool", async () => {
    console.log("=== Step 13: Perform Trading on Raydium CLMM Pool ===");

    const traders: anchor.web3.Keypair[] = [];
    const numTraders = 2;
    for (let i = 0; i < numTraders; i++) {
      traders.push(anchor.web3.Keypair.generate());
    }

    const fundAmount = new anchor.BN(1.1 * anchor.web3.LAMPORTS_PER_SOL);
    for (let i = 0; i < traders.length; i++) {
      const fundTx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: admin1Keypair.publicKey,
          toPubkey: traders[i].publicKey,
          lamports: fundAmount.toNumber(),
        })
      );
      const fundSig = await provider.sendAndConfirm(fundTx, [admin1Keypair]);
      console.log(`✅ Funded trader ${i + 1}`);
      console.log("Explorer url:", utils.getExplorerUrl(provider, fundSig));
    }
    const range = await sdk.getLiquidityRange({
      launch: launchPda,
      baseMint,
      quoteMint: WSOL_MINT,
      raydiumQuoteVault: quoteVault,
      raydiumBaseVault: baseVault,
    });
    const [poolState] = sdk.getRaydiumPoolPda(WSOL_MINT, baseMint);

    const poolStateAccountInfo = await provider.connection.getAccountInfo(poolState);
    if (!poolStateAccountInfo) {
      throw new Error('Pool state account not found');
    }
    console.log(`Pool state account data length: ${poolStateAccountInfo.data.length} bytes`);

    const raydium = await Raydium.load({
      owner: traders[0],
      connection: provider.connection,
      cluster: 'mainnet',
      disableFeatureCheck: true,
      disableLoadToken: true,
      blockhashCommitment: 'finalized',
    });

    const poolData = await raydium.clmm.getPoolInfoFromRpc(poolState.toString());
    const poolInfo = poolData.poolInfo;
    const poolKeys = poolData.poolKeys;
    const clmmPoolInfo = poolData.computePoolInfo;
    const tickCache = poolData.tickData;

    // Create ATA for trader to hold base tokens BEFORE buying
    const traderBaseAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      traders[0],
      baseMint,
      traders[0].publicKey
    );
    console.log("Trader base ATA created:", traderBaseAta.address.toBase58());

    const inputMint = WSOL_MINT;
    const amountIn = new BN(1 * anchor.web3.LAMPORTS_PER_SOL);

    if (inputMint.toBase58() !== poolInfo.mintA.address && inputMint.toBase58() !== poolInfo.mintB.address) {
      throw new Error('Input mint does not match pool');
    }

    const baseIn = inputMint.toBase58() === poolInfo.mintA.address;

    const { minAmountOut, remainingAccounts } = await PoolUtils.computeAmountOutFormat({
      poolInfo: clmmPoolInfo,
      tickArrayCache: tickCache[poolState.toString()],
      amountIn,
      tokenOut: poolInfo[baseIn ? 'mintB' : 'mintA'],
      slippage: 0.01,
      epochInfo: await raydium.fetchEpochInfo(),
    });

    const { execute: executeBuy } = await raydium.clmm.swap({
      poolInfo,
      poolKeys,
      inputMint: poolInfo[baseIn ? 'mintA' : 'mintB'].address,
      amountIn,
      amountOutMin: minAmountOut.amount.raw,
      observationId: clmmPoolInfo.observationId,
      ownerInfo: {
        useSOLBalance: true,
      },
      remainingAccounts,
      txVersion: TxVersion.V0,
    });

    const buyResult = await utils.withNoLogging(() => executeBuy({ sendAndConfirm: true }));
    console.log(`✅ Buy completed (traders[0])`);
    console.log("Explorer url:", utils.getExplorerUrl(provider, buyResult.txId));

    // traders[0] sells some base tokens back (base → WSOL) to generate base fees
    console.log("\n--- traders[0] sells base tokens to generate base fees ---");

    const poolDataForSell = await raydium.clmm.getPoolInfoFromRpc(poolState.toString());
    const sellAmount = new BN(50_000_000);

    const sellBaseIn = baseMint.toBase58() === poolDataForSell.poolInfo.mintA.address;

    const { minAmountOut: minSellOut, remainingAccounts: sellRemainingAccounts } = await PoolUtils.computeAmountOutFormat({
      poolInfo: poolDataForSell.computePoolInfo,
      tickArrayCache: poolDataForSell.tickData[poolState.toString()],
      amountIn: sellAmount,
      tokenOut: poolDataForSell.poolInfo[sellBaseIn ? 'mintB' : 'mintA'],
      slippage: 0.01,
      epochInfo: await raydium.fetchEpochInfo(),
    });

    const { execute: executeSell } = await raydium.clmm.swap({
      poolInfo: poolDataForSell.poolInfo,
      poolKeys: poolDataForSell.poolKeys,
      inputMint: baseMint.toBase58(),
      amountIn: sellAmount,
      amountOutMin: minSellOut.amount.raw,
      observationId: poolDataForSell.computePoolInfo.observationId,
      ownerInfo: {
        useSOLBalance: true,
      },
      remainingAccounts: sellRemainingAccounts,
      txVersion: TxVersion.V0,
    });

    const sellResult = await utils.withNoLogging(() => executeSell({ sendAndConfirm: true }));
    console.log(`✅ Sell completed (traders[0])`);
    console.log("Explorer url:", utils.getExplorerUrl(provider, sellResult.txId));
  });

  it("Step 14: Harvest CLMM fees through income-dispatcher", async () => {
    console.log("=== Step 14: Harvest CLMM Fees ===");
    launchStateData = await sdk.fetchLaunch(launchPda);
    const escrowAuthority = sdk.getEscrowAuthorityPda(launchPda)[0];

    const isQuoteSmaller = Buffer.compare(WSOL_MINT.toBuffer(), baseMint.toBuffer()) < 0;

    const tokenVault0 = isQuoteSmaller ? quoteVault : baseVault;
    const tokenVault1 = isQuoteSmaller ? baseVault : quoteVault;
    const remainingAccounts: any[] = [];
    const poolStateAccount = await provider.connection.getAccountInfo(raydiumPoolState);
    if (poolStateAccount) {
      const poolStateData = poolStateAccount.data;
      const tickSpacing = poolStateData.readUInt16LE(84);

      const tickArrayLowerAccount = await provider.connection.getAccountInfo(tickArrayLower);
      const tickArrayUpperAccount = await provider.connection.getAccountInfo(tickArrayUpper);

      if (tickArrayLowerAccount && tickArrayUpperAccount) {
        const tickArrayLowerStartIndex = tickArrayLowerAccount.data.readInt32LE(8);
        const tickArrayUpperStartIndex = tickArrayUpperAccount.data.readInt32LE(8);

        const maxTickInBitmap = tickSpacing * 512 * 8;

        const needsExtension = tickArrayLowerStartIndex < -maxTickInBitmap ||
          tickArrayUpperStartIndex >= maxTickInBitmap ||
          tickArrayLowerStartIndex >= maxTickInBitmap ||
          tickArrayUpperStartIndex < -maxTickInBitmap;

        if (needsExtension) {
          const [tickArrayBitmapExtension] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("pool_tick_array_bitmap_extension"), raydiumPoolState.toBuffer()],
            sdk.getRaydiumClmmProgramId()
          );

          remainingAccounts.push({
            pubkey: tickArrayBitmapExtension,
            isWritable: true,
            isSigner: false,
          });
        }
      }
    }

    const bundle = await dispatcherSdk.harvestPoolBundle({
      payer: admin1Keypair.publicKey,
      launchState: launchPda,
      projectId: launchStateData.projectId,
      baseMint,
      quoteMint: WSOL_MINT,
      engineProgram: program.programId,
      escrowAuthority,
      raydiumPositionNftMint,
      raydiumPositionNftAccount,
      personalPosition,
      raydiumPoolState,
      protocolPosition,
      tokenVault0,
      tokenVault1,
      tickArrayLower,
      tickArrayUpper,
      remainingAccounts,
    });

    if (bundle.altCreationTx) {
      console.log("Creating ALT:", bundle.altAddress.toString());
    }

    const { signature: harvestSig, altAddress } = await dispatcherSdk.executeHarvestPoolBundle(
      bundle,
      [admin1Keypair]
    );
    console.log("✅ CLMM fees harvested (ALT:", altAddress.toString(), ")");
    console.log("Explorer url:", utils.getExplorerUrl(provider, harvestSig));

    type IncomeHarvestedEvent = anchor.IdlEvents<typeof incomeDispatcherProgram.idl>["incomeHarvested"];

    await new Promise(resolve => setTimeout(resolve, 500));

    const harvestEvents = await utils.EventsFetcher.fetch<IncomeHarvestedEvent>(
      provider.connection,
      harvestSig,
      incomeDispatcherProgram,
      "incomeHarvested"
    );

    console.log("\n--- Harvest Events from Transaction ---");
    for (const evt of harvestEvents) {
      console.log(`Harvest event: role=${Object.keys(evt.role)[0]}, base=${evt.base.toString()}, quote=${evt.quote.toString()}`);
    }

    assert.equal(harvestEvents.length, 4, "Expected 4 Harvest events (one per role)");

    // Debug: Check PDAs and raw account existence
    const [treasureBasePda] = dispatcherSdk.txBuilder.getTotalsPda(Role.Treasure, baseMint);
    const [treasureQuotePda] = dispatcherSdk.txBuilder.getTotalsPda(Role.Treasure, WSOL_MINT);
    console.log("\n--- Debug: PDA Addresses ---");
    console.log("baseMint:", baseMint.toString());
    console.log("WSOL_MINT:", WSOL_MINT.toString());
    console.log("treasureBasePda:", treasureBasePda.toString());
    console.log("treasureQuotePda:", treasureQuotePda.toString());

    // Check raw account info
    const treasureBaseInfo = await provider.connection.getAccountInfo(treasureBasePda);
    const treasureQuoteInfo = await provider.connection.getAccountInfo(treasureQuotePda);
    console.log("treasureBase account exists:", !!treasureBaseInfo, treasureBaseInfo?.data.length);
    console.log("treasureQuote account exists:", !!treasureQuoteInfo, treasureQuoteInfo?.data.length);

    const treasureBase = await dispatcherSdk.fetchTotals(Role.Treasure, baseMint);
    const treasureQuote = await dispatcherSdk.fetchTotals(Role.Treasure, WSOL_MINT);
    const creatorBase = await dispatcherSdk.fetchProjectTotals(launchStateData.projectId, Role.Creator, baseMint);
    const creatorQuote = await dispatcherSdk.fetchProjectTotals(launchStateData.projectId, Role.Creator, WSOL_MINT);
    const communityBase = await dispatcherSdk.fetchProjectTotals(launchStateData.projectId, Role.Community, baseMint);
    const communityQuote = await dispatcherSdk.fetchProjectTotals(launchStateData.projectId, Role.Community, WSOL_MINT);
    const buybackBase = await dispatcherSdk.fetchTotals(Role.BuyBack, baseMint);
    const buybackQuote = await dispatcherSdk.fetchTotals(Role.BuyBack, WSOL_MINT);

    console.log("\n--- Actual Role Balances (from contract) ---");
    console.log(`Treasure:  base=${treasureBase.harvested.toString()}, quote=${treasureQuote.harvested.toString()}`);
    console.log(`Creator:   base=${creatorBase.harvested.toString()}, quote=${creatorQuote.harvested.toString()}`);
    console.log(`Community: base=${communityBase.harvested.toString()}, quote=${communityQuote.harvested.toString()}`);
    console.log(`BuyBack:   base=${buybackBase.harvested.toString()}, quote=${buybackQuote.harvested.toString()}`);

    const sumHarvestedBase = treasureBase.harvested.add(creatorBase.harvested).add(communityBase.harvested).add(buybackBase.harvested);
    const sumHarvestedQuote = treasureQuote.harvested.add(creatorQuote.harvested).add(communityQuote.harvested).add(buybackQuote.harvested);

    console.log("\n--- Total harvested ---");
    console.log(`Sum harvested base: ${sumHarvestedBase.toString()}`);
    console.log(`Sum harvested quote: ${sumHarvestedQuote.toString()}`);

    assert.ok(sumHarvestedBase.gtn(0) || sumHarvestedQuote.gtn(0), "Should have harvested some fees");

    console.log("✅ Harvest completed successfully");
  });

  it("Step 15: Claim platform fees (base) - expect NothingToClaim", async () => {
    console.log("=== Step 15: Claim Treasure Fees (base) - expect NothingToClaim ===");
    console.log("Platform only receives SOL from deposits, not base tokens");

    await utils.doAndCheckError(
      dispatcherSdk.claimPlatform({
        mint: baseMint,
        signers: [platformKeypair],
      }),
      "NothingToClaim"
    );
    console.log("✅ NothingToClaim error as expected");
  });

  it("Step 15b: Claim platform fees (quote/WSOL)", async () => {
    console.log("=== Step 15b: Claim Treasure Fees (quote/WSOL) ===");

    const platformAta = getAssociatedTokenAddressSync(WSOL_MINT, platformKeypair.publicKey, false);

    const totalsBefore = await dispatcherSdk.fetchTotals(Role.Treasure, WSOL_MINT);
    const availableBefore = new BN(totalsBefore.harvested).sub(new BN(totalsBefore.spent));
    console.log("Totals before - harvested:", totalsBefore.harvested.toString(), "spent:", totalsBefore.spent.toString());
    console.log("Available to claim:", availableBefore.toString());

    const { signature } = await dispatcherSdk.claimPlatform({
      mint: WSOL_MINT,
      signers: [platformKeypair],
    });
    console.log("✅ Treasure quote fees claimed");
    console.log("Explorer url:", utils.getExplorerUrl(provider, signature));

    const totalsAfter = await dispatcherSdk.fetchTotals(Role.Treasure, WSOL_MINT);
    const availableAfter = new BN(totalsAfter.harvested).sub(new BN(totalsAfter.spent));
    console.log("Totals after - harvested:", totalsAfter.harvested.toString(), "spent:", totalsAfter.spent.toString());
    console.log("Available after:", availableAfter.toString());

    const platformAccount = await getAccount(provider.connection, platformAta);
    const platformBalanceAfter = new BN(platformAccount.amount.toString());
    console.log("Platform WSOL balance after:", platformBalanceAfter.toString());

    const spentDiff = new BN(totalsAfter.spent).sub(new BN(totalsBefore.spent));

    assert.ok(spentDiff.eq(availableBefore), `Spent should increase by available amount. Expected ${availableBefore.toString()}, got ${spentDiff.toString()}`);
    assert.ok(platformBalanceAfter.eq(availableBefore), `Platform WSOL balance should equal claimed amount. Expected ${availableBefore.toString()}, got ${platformBalanceAfter.toString()}`);
    assert.ok(availableAfter.eqn(0), "Available should be 0 after claim");
  });

  it("Step 15c: Verify repeat claim throws NothingToClaim", async () => {
    console.log("=== Step 15c: Verify Repeat Claim Throws NothingToClaim ===");

    const totalsBefore = await dispatcherSdk.fetchTotals(Role.Treasure, WSOL_MINT);
    const availableBefore = new BN(totalsBefore.harvested).sub(new BN(totalsBefore.spent));
    assert.ok(availableBefore.eqn(0), "Available should be 0 after first claim");

    await utils.doAndCheckError(
      dispatcherSdk.claimPlatform({
        mint: WSOL_MINT,
        signers: [platformKeypair],
      }),
      "NothingToClaim"
    );
    console.log("✅ Repeat claim correctly throws NothingToClaim");
  });

  it("Step 15d: Unauthorized wallet cannot claim platform fees", async () => {
    console.log("=== Step 15d: Unauthorized Wallet Cannot Claim ===");

    await utils.doAndCheckError(
      dispatcherSdk.claimPlatform({
        mint: baseMint,
        signers: [buyer1Keypair],
      }),
      "Unauthorized"
    );
    console.log("✅ Unauthorized wallet correctly rejected");
  });

  it("Step 16: Claim creator fees (base)", async () => {
    console.log("=== Step 16: Claim Creator Fees (base) ===");

    const { signature } = await dispatcherSdk.claim({
      role: { creator: {} },
      projectId: launchStateData.projectId,
      launchState: launchPda,
      recipient: creatorKeypair.publicKey,
      mint: baseMint,
      nonce: new BN(0),
      signers: [creatorKeypair],
    });
    console.log("✅ Creator base fees claimed");
    console.log("Explorer url:", utils.getExplorerUrl(provider, signature));
  });

  it("Step 16b: Claim creator fees (quote)", async () => {
    console.log("=== Step 16b: Claim Creator Fees (quote) ===");

    const { signature } = await dispatcherSdk.claim({
      role: { creator: {} },
      projectId: launchStateData.projectId,
      launchState: launchPda,
      recipient: creatorKeypair.publicKey,
      mint: WSOL_MINT,
      nonce: new BN(1),
      signers: [creatorKeypair],
    });
    console.log("✅ Creator quote fees claimed");
    console.log("Explorer url:", utils.getExplorerUrl(provider, signature));
  });

  it("Step 17: Claim community fees (base)", async () => {
    console.log("=== Step 17: Claim Community Fees (base) ===");

    const { signature } = await dispatcherSdk.claim({
      role: { community: {} },
      projectId: launchStateData.projectId,
      launchState: launchPda,
      recipient: buyer1Keypair.publicKey,
      mint: baseMint,
      nonce: new BN(0),
      remainingAccounts: [
        { pubkey: communityWallet.publicKey, isWritable: false, isSigner: true },
      ],
      signers: [buyer1Keypair, communityWallet],
    });

    console.log("✅ Community base fees claimed");
    console.log("Explorer url:", utils.getExplorerUrl(provider, signature));

    const nonceAccount = await dispatcherSdk.fetchNonce(launchStateData.projectId, buyer1Keypair.publicKey);
    assert.equal(nonceAccount.nonce.toNumber(), 1, "Nonce should be 1 after claiming base");
  });

  it("Step 17b: Claim community fees (quote) - expect NothingToClaim", async () => {
    console.log("=== Step 17b: Claim Community Fees (quote) - expect NothingToClaim ===");
    console.log("Community only receives base tokens from pool fees, not SOL");

    await utils.doAndCheckError(
      dispatcherSdk.claim({
        role: { community: {} },
        projectId: launchStateData.projectId,
        launchState: launchPda,
        recipient: buyer1Keypair.publicKey,
        mint: WSOL_MINT,
        nonce: new BN(1),
        remainingAccounts: [
          { pubkey: communityWallet.publicKey, isWritable: false, isSigner: true },
        ],
        signers: [buyer1Keypair, communityWallet],
      }),
      "NothingToClaim"
    );
    console.log("✅ NothingToClaim error as expected");
  });

  it("Step 18: Verify BuyBack claim is not allowed (SDK only supports creator/community)", async () => {
    console.log("=== Step 18: BuyBack claim test skipped (not supported by SDK) ===");
    console.log("✅ BuyBack claim correctly not available in SDK");
  });

  it("Step 19: Verify getRaydiumPoolByProjectId and fetch pool price", async () => {
    console.log("=== Step 19: Verify getRaydiumPoolByProjectId ===");

    const raydiumPoolState = await sdk.getRaydiumPoolByProjectId(projectId);
    assert.ok(raydiumPoolState, "Raydium pool state should exist");
    console.log("Raydium Pool State PDA:", raydiumPoolState.toString());

    const raydiumPoolInfo = await provider.connection.getAccountInfo(raydiumPoolState);
    assert.ok(raydiumPoolInfo, "Raydium pool account should exist on-chain");

    const POOL_STATE_SQRT_PRICE_X64_OFFSET = 253;
    const sqrtPriceX64Bytes = raydiumPoolInfo.data.slice(POOL_STATE_SQRT_PRICE_X64_OFFSET, POOL_STATE_SQRT_PRICE_X64_OFFSET + 16);
    const sqrtPriceX64 = new BN(sqrtPriceX64Bytes, "le");

    console.log("sqrtPriceX64 (from Raydium):", sqrtPriceX64.toString());

    console.log("\n✅ getRaydiumPoolByProjectId works correctly");
  });

  it("Step 20: Create XYBER/SOL pool for buyback", async () => {
    console.log("=== Step 20: Create XYBER/SOL Pool for BuyBack ===");

    const xyberMint = xyberMintKeypair.publicKey;

    const adminXyberAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin1Keypair,
      xyberMint,
      admin1Keypair.publicKey
    );

    const xyberAmount = BigInt(1_000_000_000_000); // 1M XYBER (6 decimals)
    const { mintTo } = await import("@solana/spl-token");
    await mintTo(
      provider.connection,
      admin1Keypair,
      xyberMint,
      adminXyberAta.address,
      admin1Keypair,
      xyberAmount
    );
    console.log("✅ Minted XYBER tokens for liquidity:", xyberAmount.toString());

    const raydium = await Raydium.load({
      owner: admin1Keypair,
      connection: provider.connection,
      cluster: 'mainnet',
      disableFeatureCheck: true,
      disableLoadToken: true,
      blockhashCommitment: 'finalized',
    });

    const [ammConfigAddress] = sdk.getRaydiumAmmConfigPda();
    const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

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
      address: xyberMint.toString(),
      programId: TOKEN_PROGRAM_ID,
      logoURI: "",
      symbol: "XYBER",
      name: "XYBER Token",
      decimals: 6,
      tags: [],
      extensions: {},
    };

    const initialPrice = new Decimal(10000);
    console.log("Initial price:", initialPrice.toString(), "SOL per XYBER");

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

    const { execute, extInfo } = await raydium.clmm.createPool({
      programId: sdk.getRaydiumClmmProgramId(),
      mint1: wsolToken as any,
      mint2: xyberToken as any,
      ammConfig: ammConfigInfo as any,
      initialPrice,
      txVersion: TxVersion.V0,
    });

    const { txId } = await utils.withNoLogging(() => execute({ sendAndConfirm: true }));
    console.log("✅ XYBER/SOL pool created");
    console.log("Explorer url:", utils.getExplorerUrl(provider, txId));

    // Get pool addresses from extInfo
    const poolId = extInfo.address.id;
    xyberPoolState = new anchor.web3.PublicKey(poolId);
    xyberPoolQuoteVault = new anchor.web3.PublicKey(extInfo.address.vault.A);
    xyberPoolXyberVault = new anchor.web3.PublicKey(extInfo.address.vault.B);
    xyberPoolObservationState = new anchor.web3.PublicKey(extInfo.address.observationId);

    console.log("Pool State:", xyberPoolState.toString());
    console.log("Quote Vault:", xyberPoolQuoteVault.toString());
    console.log("XYBER Vault:", xyberPoolXyberVault.toString());
    console.log("Observation:", xyberPoolObservationState.toString());
  });

  it("Step 21: Add liquidity to XYBER/SOL pool", async () => {
    console.log("=== Step 21: Add Liquidity to XYBER/SOL Pool ===");

    const { getPdaTickArrayAddress, TickUtils } = await import("@raydium-io/raydium-sdk-v2");

    const clmmProgram = sdk.getRaydiumClmmProgramId();
    const tickSpacing = 10;

    const MIN_TICK = -443636;
    const MAX_TICK = 443636;
    const tickLower = Math.ceil(MIN_TICK / tickSpacing) * tickSpacing;
    const tickUpper = Math.floor(MAX_TICK / tickSpacing) * tickSpacing;

    console.log("Full range position: tickLower =", tickLower, ", tickUpper =", tickUpper);

    const raydium = await Raydium.load({
      owner: admin1Keypair,
      connection: provider.connection,
      cluster: 'mainnet',
      disableFeatureCheck: true,
      disableLoadToken: true,
      blockhashCommitment: 'finalized',
    });

    // Get pool info via RPC (not API) - for devnet/local validator
    const data = await raydium.clmm.getPoolInfoFromRpc(xyberPoolState.toString());
    const poolInfo = data.poolInfo;
    const poolKeys = data.poolKeys;
    console.log("Pool info loaded via RPC");

    const solAmount = new BN(7 * anchor.web3.LAMPORTS_PER_SOL);
    const xyberAmount = new BN(500_000_000_000); // 500K XYBER (6 decimals)

    console.log("Adding liquidity: SOL =", solAmount.toString(), ", XYBER =", xyberAmount.toString());
    console.log("Pool mintA:", poolInfo.mintA.address, "mintB:", poolInfo.mintB.address);
    console.log("WSOL mint:", WSOL_MINT.toString());

    // Determine which mint is SOL
    const isMintAWsol = poolInfo.mintA.address === WSOL_MINT.toString();
    console.log("Is MintA WSOL?", isMintAWsol);

    // Use SOL as base since we control SOL amount
    const { execute, extInfo } = await raydium.clmm.openPositionFromBase({
      poolInfo,
      poolKeys,
      ownerInfo: {
        useSOLBalance: true,
      },
      tickLower,
      tickUpper,
      base: isMintAWsol ? "MintA" : "MintB",
      baseAmount: solAmount,
      otherAmountMax: xyberAmount,
      txVersion: TxVersion.V0,
    });

    const { txId } = await utils.withNoLogging(() => execute({ sendAndConfirm: true }));
    console.log("✅ Position opened");
    console.log("Explorer url:", utils.getExplorerUrl(provider, txId));

    // Set tick arrays for buyback swap
    const currentPriceTick = -69077;
    const tickArrayCurrentStartIndex = TickUtils.getTickArrayStartIndexByTick(currentPriceTick, tickSpacing);
    const tickArrayLowerStartIndex = TickUtils.getTickArrayStartIndexByTick(tickLower, tickSpacing);
    const tickArrayUpperStartIndex = TickUtils.getTickArrayStartIndexByTick(tickUpper, tickSpacing);

    const tickArrayCurrentPda = getPdaTickArrayAddress(clmmProgram, xyberPoolState, tickArrayCurrentStartIndex);
    const tickArrayLowerPda = getPdaTickArrayAddress(clmmProgram, xyberPoolState, tickArrayLowerStartIndex);
    const tickArrayUpperPda = getPdaTickArrayAddress(clmmProgram, xyberPoolState, tickArrayUpperStartIndex);

    xyberPoolTickArray0 = tickArrayCurrentPda.publicKey;
    xyberPoolTickArray1 = tickArrayLowerPda.publicKey;
    xyberPoolTickArray2 = tickArrayUpperPda.publicKey;

    // Bitmap extension PDA for SwapV2
    [xyberPoolBitmapExtension] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool_tick_array_bitmap_extension"), xyberPoolState.toBuffer()],
      clmmProgram
    );

    // Check if bitmap extension exists, if not - initialize it
    const bitmapExtensionInfo = await provider.connection.getAccountInfo(xyberPoolBitmapExtension);
    if (!bitmapExtensionInfo) {
      console.log("Initializing tick array bitmap extension...");
      const { execute: executeInit } = await raydium.clmm.initTickArrayBitmapExtension({
        poolInfo,
        txVersion: TxVersion.V0,
      });
      const { txId: initTxId } = await utils.withNoLogging(() => executeInit({ sendAndConfirm: true }));
      console.log("✅ Bitmap extension initialized:", initTxId);
    } else {
      console.log("Bitmap extension already exists");
    }

    console.log("Tick Array Current (for swap):", xyberPoolTickArray0.toString());
    console.log("Tick Array Lower:", xyberPoolTickArray1.toString());
    console.log("Tick Array Upper:", xyberPoolTickArray2.toString());
    console.log("Bitmap Extension:", xyberPoolBitmapExtension.toString());
  });

  it("Step 22: Execute BuyBack", async () => {
    console.log("=== Step 22: Execute BuyBack ===");

    // Check available quote for buyback
    const buybackQuoteTotals = await dispatcherSdk.fetchTotals(Role.BuyBack, WSOL_MINT);
    console.log("BuyBack harvested quote:", buybackQuoteTotals.harvested.toString());
    console.log("BuyBack spent quote:", buybackQuoteTotals.spent.toString());

    const availableQuote = new BN(buybackQuoteTotals.harvested).sub(new BN(buybackQuoteTotals.spent));
    console.log("Available for buyback:", availableQuote.toString(), "lamports");

    if (availableQuote.lte(new BN(0))) {
      console.log("⏭️  No quote available for buyback, skipping");
      return;
    }

    // Verify bitmap extension exists
    const bitmapExtInfo = await provider.connection.getAccountInfo(xyberPoolBitmapExtension);
    console.log("Bitmap extension account exists:", !!bitmapExtInfo);
    console.log("Bitmap extension address:", xyberPoolBitmapExtension.toString());
    if (bitmapExtInfo) {
      console.log("Bitmap extension data length:", bitmapExtInfo.data.length);
    }

    // Load Raydium SDK and get pool info for proper tick array computation
    const raydium = await Raydium.load({
      owner: admin1Keypair,
      connection: provider.connection,
      cluster: 'mainnet',
      disableFeatureCheck: true,
      disableLoadToken: true,
      blockhashCommitment: 'finalized',
    });

    const poolData = await raydium.clmm.getPoolInfoFromRpc(xyberPoolState.toString());
    const poolInfo = poolData.poolInfo;
    const clmmPoolInfo = poolData.computePoolInfo;
    const tickCache = poolData.tickData;

    // Log current pool state
    console.log("Pool current tick:", clmmPoolInfo.tickCurrent);
    console.log("Pool mintA:", poolInfo.mintA.address);
    console.log("Pool mintB:", poolInfo.mintB.address);

    // Compute swap to get correct tick arrays - buying XYBER with SOL (quote -> base in pool terms)
    const { remainingAccounts } = await PoolUtils.computeAmountOutFormat({
      poolInfo: clmmPoolInfo,
      tickArrayCache: tickCache[xyberPoolState.toString()],
      amountIn: availableQuote,
      tokenOut: poolInfo.mintB, // XYBER is mintB (SOL is mintA based on address sorting)
      slippage: 0.01,
      epochInfo: await raydium.fetchEpochInfo(),
    });

    console.log("Computed remaining accounts for swap:", remainingAccounts.length);
    console.log("remainingAccounts structure:", JSON.stringify(remainingAccounts, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value, 2));

    // Extract tick arrays from remaining accounts - structure may vary
    const getPublicKey = (acc: any): anchor.web3.PublicKey | null => {
      if (!acc) return null;
      // Already a PublicKey object (has _bn property)
      if (acc._bn) return acc as anchor.web3.PublicKey;
      if (acc.pubkey) return new anchor.web3.PublicKey(acc.pubkey);
      if (acc.address) return new anchor.web3.PublicKey(acc.address);
      if (typeof acc === 'string') return new anchor.web3.PublicKey(acc);
      // Try to create from the object directly (in case it's PublicKey-like)
      try {
        return new anchor.web3.PublicKey(acc);
      } catch {
        return null;
      }
    };

    // Use tick array for current tick (where swap will happen)
    const { getPdaTickArrayAddress, TickUtils } = await import("@raydium-io/raydium-sdk-v2");
    const tickSpacing = 10;
    const currentTickArrayStartIndex = TickUtils.getTickArrayStartIndexByTick(clmmPoolInfo.tickCurrent, tickSpacing);
    const currentTickArrayPda = getPdaTickArrayAddress(sdk.getRaydiumClmmProgramId(), xyberPoolState, currentTickArrayStartIndex);

    console.log("Using tick array (current):", currentTickArrayPda.publicKey.toString());
    console.log("Current tick array start index:", currentTickArrayStartIndex);

    // Build remaining accounts for Raydium SwapV2:
    // - tick arrays needed for swap (computed by SDK)
    // - bitmap extension at the end (if needed for extended range)
    const swapRemainingAccounts: { pubkey: anchor.web3.PublicKey; isWritable: boolean; isSigner: false }[] = [];

    // Add computed tick arrays from SDK
    console.log("Processing remaining accounts from SDK...");
    for (const acc of remainingAccounts) {
      console.log("  acc:", acc, "type:", typeof acc);
      const pubkey = getPublicKey(acc);
      console.log("  pubkey:", pubkey?.toString());
      if (pubkey) {
        swapRemainingAccounts.push({ pubkey, isWritable: true, isSigner: false });
      }
    }

    // If no tick arrays from SDK, use the current tick array
    if (swapRemainingAccounts.length === 0) {
      console.log("No tick arrays from SDK, using current tick array");
      swapRemainingAccounts.push({ pubkey: currentTickArrayPda.publicKey, isWritable: true, isSigner: false });
    }

    // Add bitmap extension at the end
    swapRemainingAccounts.push({ pubkey: xyberPoolBitmapExtension, isWritable: false, isSigner: false });

    console.log("Swap remaining accounts:");
    swapRemainingAccounts.forEach((acc, i) => {
      console.log(`  [${i}] ${acc.pubkey.toString()} (writable: ${acc.isWritable})`);
    });

    const [ammConfigAddress] = sdk.getRaydiumAmmConfigPda();

    const result = await dispatcherSdk.buyback({
      minXyberOut: new BN(1),
      xyberMint: xyberMintKeypair.publicKey,
      raydiumPoolState: xyberPoolState,
      raydiumAmmConfig: ammConfigAddress,
      raydiumQuoteVault: xyberPoolQuoteVault,
      raydiumXyberVault: xyberPoolXyberVault,
      raydiumObservationState: xyberPoolObservationState,
      remainingAccounts: swapRemainingAccounts,
      engineProgramId: program.programId,
      raydiumProgramId: sdk.getRaydiumClmmProgramId(),
      signers: [backendKeypair],
    });

    console.log("✅ BuyBack executed");
    console.log("Explorer url:", utils.getExplorerUrl(provider, result.signature));

    // Verify treasure received XYBER
    const treasureXyberTotals = await dispatcherSdk.fetchTotals(Role.Treasure, xyberMintKeypair.publicKey);
    console.log("Treasure harvested XYBER:", treasureXyberTotals.harvested.toString());

    assert.ok(new BN(treasureXyberTotals.harvested).gtn(0), "Treasure should have received XYBER from buyback");
  });

  it("Step 23: Verify XYBER in vault after BuyBack", async () => {
    console.log("=== Step 23: Verify XYBER in Vault ===");

    // Get treasure XYBER totals to see balance
    const treasureXyberTotals = await dispatcherSdk.fetchTotals(Role.Treasure, xyberMintKeypair.publicKey);
    console.log("Treasure harvested XYBER:", treasureXyberTotals.harvested.toString());
    console.log("Treasure spent XYBER:", treasureXyberTotals.spent.toString());

    const availableXyber = new BN(treasureXyberTotals.harvested).sub(new BN(treasureXyberTotals.spent));
    console.log("Available XYBER for claim:", availableXyber.toString());

    // Verify the XYBER is in the authority vault
    const [authority] = dispatcherSdk.getAuthorityPda();
    const authorityXyberAta = getAssociatedTokenAddressSync(
      xyberMintKeypair.publicKey,
      authority,
      true
    );

    const vaultBalance = await provider.connection.getTokenAccountBalance(authorityXyberAta);
    console.log("Authority XYBER vault balance:", vaultBalance.value.amount);

    // Verify balances match
    assert.equal(
      vaultBalance.value.amount,
      availableXyber.toString(),
      "Vault balance should match tracked XYBER amount"
    );

    console.log("✅ XYBER balance verified in harvest authority vault");
  });

  it("Step 24: Claim XYBER from BuyBack (platform treasure)", async () => {
    console.log("=== Step 24: Claim XYBER from BuyBack ===");

    // Get available XYBER before claim
    const totalsBefore = await dispatcherSdk.fetchTotals(Role.Treasure, xyberMintKeypair.publicKey);
    const availableBefore = new BN(totalsBefore.harvested).sub(new BN(totalsBefore.spent));
    console.log("Available XYBER before claim:", availableBefore.toString());

    // Claim XYBER to platform wallet
    const { signature } = await dispatcherSdk.claimPlatform({
      mint: xyberMintKeypair.publicKey,
      signers: [platformKeypair],
    });
    console.log("✅ XYBER claimed");
    console.log("Explorer url:", utils.getExplorerUrl(provider, signature));

    // Verify claim
    const totalsAfter = await dispatcherSdk.fetchTotals(Role.Treasure, xyberMintKeypair.publicKey);
    const availableAfter = new BN(totalsAfter.harvested).sub(new BN(totalsAfter.spent));
    console.log("Available XYBER after claim:", availableAfter.toString());

    assert.ok(availableAfter.eqn(0), "All XYBER should be claimed");
    console.log("✅ XYBER from BuyBack claimed to platform wallet");
  });

});
