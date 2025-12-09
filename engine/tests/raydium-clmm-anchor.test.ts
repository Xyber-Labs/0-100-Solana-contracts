import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { assert } from "chai";
import * as fs from "fs";
import { createMint, getOrCreateAssociatedTokenAccount, } from "@solana/spl-token";

import { EngineSDK } from "../ts-sdk/src/engine";
import { IncomeDispatcherSDK } from "../ts-sdk/src/income-dispatcher";
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
        platformWallet: platformKeypair.publicKey,
        communityWallet: communityWallet.publicKey,
        signers: [deployerKeypair],
      });
      console.log("✅ Income-dispatcher initialized:", signature);
      console.log("Explorer:", utils.getExplorerUrl(provider, signature));
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

    console.log("✅ Launch initialized:", signature);
    console.log("Explorer:", utils.getExplorerUrl(provider, signature));
    console.log("Launch PDA:", launchPda.toString());

    const launchData = await sdk.fetchLaunch(launchPda);
    assert.ok(launchData, "Launch should exist");
  });

  it("Step 4: Initialize roster and shard", async () => {
    console.log("=== Step 4: Initialize Roster ===");

    const { signature: rosterSig } = await sdk.initRoster({
      launch: launchPda,
    });

    console.log("✅ Roster initialized:", rosterSig);
    console.log("Explorer:", utils.getExplorerUrl(provider, rosterSig));

    console.log("=== Initialize Roster Shard ===");
    const [rosterShard] = sdk.getRosterShardPda(launchPda, 1);
    const rosterShardInfo = await provider.connection.getAccountInfo(rosterShard);
    assert.ok(rosterShardInfo, "Roster shard 1 should exist after initRoster");
    console.log("Roster shard 1 already initialized via initRoster");

  });

  it(`Step 5: Make deposits (${BUYER1_AMOUNT + BUYER2_AMOUNT + BUYER3_AMOUNT} SOL total)`, async () => {
    console.log(`=== Step 5: Make Deposits (${BUYER1_AMOUNT} + ${BUYER2_AMOUNT} + ${BUYER3_AMOUNT} = ${BUYER1_AMOUNT + BUYER2_AMOUNT + BUYER3_AMOUNT} SOL) ===`);

    await sdk.deposit({
      launch: launchPda,
      amountLamports: new BN(BUYER1_AMOUNT * anchor.web3.LAMPORTS_PER_SOL),
      userKeypair: buyer1Keypair,
      shardId: 1,
    });
    console.log(`✅ Deposit 1 (buyer1: ${BUYER1_AMOUNT} SOL)`);

    await sdk.deposit({
      launch: launchPda,
      amountLamports: new BN(BUYER2_AMOUNT * anchor.web3.LAMPORTS_PER_SOL),
      userKeypair: buyer2Keypair,
      shardId: 1,
    });
    console.log(`✅ Deposit 2 (buyer2: ${BUYER2_AMOUNT} SOL)`);

    await sdk.deposit({
      launch: launchPda,
      amountLamports: new BN(BUYER3_AMOUNT * anchor.web3.LAMPORTS_PER_SOL),
      userKeypair: buyer3Keypair,
      shardId: 1,
    });
    console.log(`✅ Deposit 3 (buyer3: ${BUYER3_AMOUNT} SOL)`);

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

    console.log("✅ Roster shard finalized:", signature);
    console.log("Explorer:", utils.getExplorerUrl(provider, signature));
  });

  it("Step 7: Set VRF seed", async () => {
    console.log("=== Step 7: Set VRF Seed ===");

    const { signature } = await sdk.setSeed({
      launch: launchPda,
      payerKeypair: admin1Keypair,
    });

    console.log("✅ VRF seed set:", signature);
    console.log("Explorer:", utils.getExplorerUrl(provider, signature));
  });

  it("Step 8: Prepare pool creation", async () => {
    console.log("=== Step 8: Prepare Pool Creation ===");

    const { signature } = await sdk.preparePoolCreation({
      launch: launchPda,
      payerKeypair: admin1Keypair,
    });

    console.log("✅ Pool creation prepared:", signature);
    console.log("Explorer:", utils.getExplorerUrl(provider, signature));
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

    console.log("✅ Pool created:", result.signature);
    console.log("Explorer:", utils.getExplorerUrl(provider, result.signature));
    console.log("Base Mint:", baseMint.toString());
    console.log("Base Token ATA:", baseTokenAta.toString());
    console.log("Quote Vault:", quoteVault.toString());
    console.log("Base Vault:", baseVault.toString());
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

    console.log("✅ Liquidity added:", addLiquiditySig);
    console.log("Explorer:", utils.getExplorerUrl(provider, addLiquiditySig));

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
      console.log(`✅ Funded trader ${i + 1}: ${fundSig}`);
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

    const originalConsoleLog = console.log;
    console.log = () => {};

    const buyResult = await executeBuy({ sendAndConfirm: true });

    console.log = originalConsoleLog;

    console.log(`✅ Buy completed (traders[0]): ${buyResult.txId}`);

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

    console.log = () => {};
    const sellResult = await executeSell({ sendAndConfirm: true });
    console.log = originalConsoleLog;

    console.log(`✅ Sell completed (traders[0]): ${sellResult.txId}`);
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

    const { signature: harvestSig } = await dispatcherSdk.harvestPool({
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
      signers: [admin1Keypair],
    });
    console.log("✅ CLMM fees harvested:", harvestSig);
    console.log("Explorer:", utils.getExplorerUrl(provider, harvestSig));

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

    const projectIncome = await dispatcherSdk.fetchProjectIncome(launchStateData.projectId);

    // Role balances: [Treasure, Creator, Community, BuyBack]
    const treasureBalance = projectIncome.balances[0];
    const creatorBalance = projectIncome.balances[1];
    const communityBalance = projectIncome.balances[2];
    const buyBackBalance = projectIncome.balances[3];

    console.log("\n--- Actual Role Balances (from contract) ---");
    console.log(`Treasure (6%):   base=${treasureBalance.earnedBase.toString()}, quote=${treasureBalance.earnedQuote.toString()}`);
    console.log(`Creator (56%):   base=${creatorBalance.earnedBase.toString()}, quote=${creatorBalance.earnedQuote.toString()}`);
    console.log(`Community (14%): base=${communityBalance.earnedBase.toString()}, quote=${communityBalance.earnedQuote.toString()}`);
    console.log(`BuyBack (24%):   base=${buyBackBalance.earnedBase.toString()}, quote=${buyBackBalance.earnedQuote.toString()}`);

    // Calculate sum of earned from all roles
    const sumEarnedBase = treasureBalance.earnedBase.add(creatorBalance.earnedBase).add(communityBalance.earnedBase).add(buyBackBalance.earnedBase);
    const sumEarnedQuote = treasureBalance.earnedQuote.add(creatorBalance.earnedQuote).add(communityBalance.earnedQuote).add(buyBackBalance.earnedQuote);

    console.log("\n--- Total earned ---");
    console.log(`Sum earned base: ${sumEarnedBase.toString()}`);
    console.log(`Sum earned quote: ${sumEarnedQuote.toString()}`);

    assert.ok(sumEarnedBase.gtn(0) || sumEarnedQuote.gtn(0), "Should have harvested some fees");

    console.log("✅ Harvest completed successfully");
  });

  it("Step 15: Claim platform fees", async () => {
    console.log("=== Step 15: Claim Treasure Fees ===");

    await dispatcherSdk.claim({
      role: { treasure: {} },
      projectId: launchStateData.projectId,
      launchState: launchPda,
      recipient: platformKeypair.publicKey,
      baseMint,
      quoteMint: WSOL_MINT,
      nonce: new BN(0),
      signers: [platformKeypair],
    });
    console.log("✅ Treasure fees claimed");
  });

  it("Step 16: Claim creator fees", async () => {
    console.log("=== Step 16: Claim Creator Fees ===");

    await dispatcherSdk.claim({
      role: { creator: {} },
      projectId: launchStateData.projectId,
      launchState: launchPda,
      recipient: creatorKeypair.publicKey,
      baseMint,
      quoteMint: WSOL_MINT,
      nonce: new BN(0),
      signers: [creatorKeypair],
    });
    console.log("✅ Creator fees claimed");
  });

  it("Step 17: Claim community fees", async () => {
    console.log("=== Step 17: Claim Community Fees ===");

    await dispatcherSdk.claim({
      role: { community: {} },
      projectId: launchStateData.projectId,
      launchState: launchPda,
      recipient: buyer1Keypair.publicKey,
      baseMint,
      quoteMint: WSOL_MINT,
      nonce: new BN(0),
      remainingAccounts: [
        { pubkey: communityWallet.publicKey, isWritable: false, isSigner: true },
      ],
      signers: [buyer1Keypair, communityWallet],
    });

    const nonceAccount = await dispatcherSdk.fetchNonce(launchStateData.projectId, buyer1Keypair.publicKey);
    assert.equal(nonceAccount.nonce.toNumber(), 1, "Nonce should be 1 after first claim");
    console.log("✅ Community fees claimed, nonce verified: 1");
  });

  it("Step 18: Verify BuyBack claim is not allowed", async () => {
    console.log("=== Step 18: Verify BuyBack Claim Not Allowed ===");

    await utils.doAndCheckError(
      dispatcherSdk.claim({
        role: { buyBack: {} },
        projectId: launchStateData.projectId,
        launchState: launchPda,
        recipient: admin1Keypair.publicKey,
        baseMint,
        quoteMint: WSOL_MINT,
        nonce: new BN(0),
        signers: [admin1Keypair],
      }),
      "Not allowed"
    );
    console.log("✅ BuyBack claim rejected as expected");
  });

  it("Step 19: Verify getRaydiumPoolByProjectId and fetch pool price", async () => {
    console.log("=== Step 11: Verify getRaydiumPoolByProjectId ===");

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

});
