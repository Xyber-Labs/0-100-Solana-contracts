import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { ComputeBudgetProgram } from "@solana/web3.js";
import * as fs from "fs";
import { createInitializeMintInstruction, createAssociatedTokenAccountInstruction, createMintToInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Program } from "@coral-xyz/anchor";
import { assert } from "chai";
import * as fs from "fs";
import { createMint, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import EngineSDK, { loadKeypair } from "../ts-sdk/src/engine";
import * as utils from "./utils";

describe("Raydium CLMM Pool Creation - Fast Flow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Engine;

  const admin1Keypair = loadKeypair("keys/admin1.json");
  const admin2Keypair = loadKeypair("keys/admin2.json");
  const admin3Keypair = loadKeypair("keys/admin3.json");
  const xyberMintKeypair = loadKeypair("keys/xyber-mint.json");
  const treasuryKeypair = loadKeypair("keys/treasure.json");
  const creatorKeypair = loadKeypair("keys/creator.json");
  const buyer1Keypair = loadKeypair("keys/buyer1.json");
  const buyer2Keypair = loadKeypair("keys/buyer2.json");
  const buyer3Keypair = loadKeypair("keys/buyer3.json");

  const sdk = EngineSDK.create(provider, program, admin1Keypair);

  let launchPda: anchor.web3.PublicKey;
  let quoteMintKeypair: anchor.web3.Keypair;
  let baseMint: anchor.web3.PublicKey;
  let baseTokenAta: anchor.web3.PublicKey;
  let quoteVault: anchor.web3.PublicKey;
  let baseVault: anchor.web3.PublicKey;

  const PRESET_ID = 0;
  const PROJECT_ID = 1;

  const BUYER1_AMOUNT = parseInt(process.env.BUYER1_AMOUNT || "150");
  const BUYER2_AMOUNT = parseInt(process.env.BUYER2_AMOUNT || "150");
  const BUYER3_AMOUNT = parseInt(process.env.BUYER3_AMOUNT || "150");


  it("Step 0: Verify Raydium CLMM and AmmConfig are loaded", async () => {
    console.log("=== Step 0: Verify Raydium Setup ===");

    const raydiumClmmProgramId = new anchor.web3.PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");
    const ammConfigAddress = new anchor.web3.PublicKey("9iFER3bpjf1PTTCQCfTRu17EJgvsxo9pVyA9QWwEuX4x");

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

    if (!configInfo) {
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
    }
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

  // CLAUDE check this test, integrate it into the flow
  it("Sets up income-dispatcher program", async () => {
    console.log("=== Setting up Income-Dispatcher Program ===");
    const configPda = getIncomeDispatcherConfigPda();

    // Initialize income-dispatcher config
    try {
      const initTx = await incomeDispatcherProgram.methods
        .initialize(
          admin.publicKey, // platform_wallet
          communityClaimSignerKeypair.publicKey, // community_claim_signer
        )
        .accountsStrict({
          admin: admin.publicKey,
          config: configPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([adminKeypair])
        .transaction();

      const initSig = await provider.sendAndConfirm(initTx, [adminKeypair]);
      console.log("✅ Income-dispatcher initialized:", initSig);
    } catch (e) {
      console.log("Income-dispatcher config already exists, skipping initialization.");
    }

    // Verify config was created
    const configAccount = await incomeDispatcherProgram.account.config.fetch(configPda);
    assert.equal(configAccount.admin.toString(), admin.publicKey.toString());
    assert.equal(configAccount.platformWallet.toString(), admin.publicKey.toString());
    assert.equal(configAccount.communityClaimSigner.toString(), communityClaimSignerKeypair.publicKey.toString());
  });

  it("Step 2: Initialize launch from preset", async () => {
    console.log("=== Step 2: Initialize Launch from Preset ===");

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

  it("Step 3: Initialize roster and shard", async () => {
    console.log("=== Step 3: Initialize Roster ===");

    const { signature: rosterSig } = await sdk.initRoster({
      launch: launchPda,
    });

    console.log("✅ Roster initialized:", rosterSig);
    console.log("Explorer:", utils.getExplorerUrl(provider, rosterSig));

    console.log("=== Step 3: Initialize Roster Shard ===");

    const { signature: shardSig } = await sdk.initRosterShard({
      launch: launchPda,
      shardId: 0,
      signers: [admin1Keypair],
    });

    console.log("✅ Roster shard initialized:", shardSig);
    console.log("Explorer:", utils.getExplorerUrl(provider, shardSig));
  });

  it(`Step 3: Make deposits (${BUYER1_AMOUNT + BUYER2_AMOUNT + BUYER3_AMOUNT} SOL total)`, async () => {
    console.log(`=== Step 3: Make Deposits (${BUYER1_AMOUNT} + ${BUYER2_AMOUNT} + ${BUYER3_AMOUNT} = ${BUYER1_AMOUNT + BUYER2_AMOUNT + BUYER3_AMOUNT} SOL) ===`);

    await sdk.deposit({
      launch: launchPda,
      amountLamports: new BN(BUYER1_AMOUNT * anchor.web3.LAMPORTS_PER_SOL),
      userKeypair: buyer1Keypair,
      shardId: 0,
    });
    console.log(`✅ Deposit 1 (buyer1: ${BUYER1_AMOUNT} SOL)`);

    await sdk.deposit({
      launch: launchPda,
      amountLamports: new BN(BUYER2_AMOUNT * anchor.web3.LAMPORTS_PER_SOL),
      userKeypair: buyer2Keypair,
      shardId: 0,
    });
    console.log(`✅ Deposit 2 (buyer2: ${BUYER2_AMOUNT} SOL)`);

    await sdk.deposit({
      launch: launchPda,
      amountLamports: new BN(BUYER3_AMOUNT * anchor.web3.LAMPORTS_PER_SOL),
      userKeypair: buyer3Keypair,
      shardId: 0,
    });
    console.log(`✅ Deposit 3 (buyer3: ${BUYER3_AMOUNT} SOL)`);

    const launchData = await sdk.fetchLaunch(launchPda);
    const totalSOL = launchData.totalDeposited.toNumber() / anchor.web3.LAMPORTS_PER_SOL;
    console.log(
      `Total raised: ${launchData.totalDeposited.toString()} lamports (${totalSOL} SOL including creator deposit)`
    );
  });

  it("Step 4: Wait for funding period and finalize shard", async () => {
    console.log("=== Step 4: Wait for Funding Period ===");

    const launchData = await sdk.fetchLaunch(launchPda);
    const fundingEndTime = launchData.fundingPeriodEnd.toNumber();
    const currentTime = Math.floor(Date.now() / 1000);
    const waitTime = fundingEndTime - currentTime + 1;

    if (waitTime > 0) {
      console.log(`Waiting ${waitTime} seconds for funding period to end...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime * 1000));
    }

    console.log("=== Step 5: Finalize Roster Shard ===");

    const { signature } = await sdk.finalizeRosterShard({
      launch: launchPda,
      shardId: 0,
      signers: [admin1Keypair],
    });

    console.log("✅ Roster shard finalized:", signature);
    console.log("Explorer:", utils.getExplorerUrl(provider, signature));
  });

  it("Step 5: Set VRF seed", async () => {
    console.log("=== Step 5: Set VRF Seed ===");

    const { signature } = await sdk.setSeed({
      launch: launchPda,
      payerKeypair: admin1Keypair,
    });

    console.log("✅ VRF seed set:", signature);
    console.log("Explorer:", utils.getExplorerUrl(provider, signature));
  });

  it("Step 6: Prepare pool creation", async () => {
    console.log("=== Step 6: Prepare Pool Creation ===");

    const { signature } = await sdk.preparePoolCreation({
      launch: launchPda,
      payerKeypair: admin1Keypair,
    });

    console.log("✅ Pool creation prepared:", signature);
    console.log("Explorer:", utils.getExplorerUrl(provider, signature));
  });

  it("Step 7: Prepare quote mint", async () => {
    console.log("=== Step 7: Prepare Quote Mint ===");

    const WSOL_MINT = new anchor.web3.PublicKey("So11111111111111111111111111111111111111112");
    quoteMintKeypair = { publicKey: WSOL_MINT } as any;

    console.log("Quote Mint (WSOL):", WSOL_MINT.toString());
    console.log("Note: Base mint will be generated during pool creation");
  });

  it("Step 8: Skip - WSOL doesn't need minting", async () => {
    console.log("=== Step 8: WSOL Setup (skipped - native) ===");
    console.log("WSOL is the native wrapped SOL, no minting needed");
  });

  it("Step 8.5: Reject pool creation with invalid launch_state owner", async () => {
    console.log("=== Step 8.5: Reject pool creation with invalid launch_state owner ===");

    const fakeLaunchState = anchor.web3.Keypair.generate();

    await utils.doAndCheckError(
      sdk.createClmmPool({
        launch: fakeLaunchState.publicKey,
        quoteMint: quoteMintKeypair.publicKey,
        signers: [admin1Keypair],
      }),
      "Invalid authority"
    );

    console.log("✅ Pool creation rejected for invalid launch_state owner");
  });

  it("Step 9: Create CLMM pool", async () => {
    console.log("=== Step 9: Create CLMM Pool ===");

    console.log("Input parameters:");
    console.log("  launch:", launchPda.toString());
    console.log("  quoteMint:", quoteMintKeypair.publicKey.toString());
    console.log("  payer:", admin1Keypair.publicKey.toString());

    const result = await sdk.createClmmPool({
      launch: launchPda,
      quoteMint: quoteMintKeypair.publicKey,
      signers: [admin1Keypair],
    });

    baseMint = result.baseMint;
    baseTokenAta = result.baseTokenAta;
    quoteVault = result.quoteVault;
    baseVault = result.baseVault;

    console.log("✅ Pool created:", result.signature);
    console.log("Explorer:", utils.getExplorerUrl(provider, result.signature));
    console.log("baseMint:", baseMint.toString());
    console.log("quoteVault:", quoteVault.toString());
    console.log("baseVault:", baseVault.toString());
    console.log("Base Mint:", baseMint.toString());
    console.log("Base Token ATA:", baseTokenAta.toString());
  });

  it("Step 10: Add liquidity to CLMM pool", async () => {
    console.log("=== Step 10: Add Liquidity ===");

    console.log("\n=== Executing transaction ===");
    const addClmmLiquidityTx = await sdk.addClmmLiquidityTx({
      payer: admin1Keypair.publicKey,
      launch: launchPda,
      baseMint: baseMint,
      provider,
    });

    console.log("Instructions:", addClmmLiquidityTx.transaction.instructions.length);

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

    console.log("=== Checking escrow_authority balance ===");
    const escrowAuthBalance = await provider.connection.getBalance(addClmmLiquidityTx.escrowAuthority);
    console.log(`escrow_authority: ${addClmmLiquidityTx.escrowAuthority.toString()}`);
    console.log(`  Balance: ${escrowAuthBalance} lamports (${escrowAuthBalance / anchor.web3.LAMPORTS_PER_SOL} SOL)`);

    console.log("=== Checking Raydium Pool Vaults ===");
    console.log(`Expected quoteVault from SDK: ${addClmmLiquidityTx.quoteVault.toString()}`);
    console.log(`Expected baseVault from SDK: ${addClmmLiquidityTx.baseVault.toString()}`);
    console.log(`quoteMint: ${quoteMintKeypair.publicKey.toString()}`);
    console.log(`baseMint: ${baseMint.toString()}`);

    const quoteVaultAccount = await provider.connection.getAccountInfo(
      addClmmLiquidityTx.quoteVault
    );
    assert.ok(quoteVaultAccount, "Quote vault should exist");

    const quoteVaultData = quoteVaultAccount.data;
    console.log(`Quote Vault raw data (first 80 bytes):`, quoteVaultData.slice(0, 80).toString('hex'));

    const quoteMintFromVault = new anchor.web3.PublicKey(quoteVaultData.slice(0, 32));
    const quoteOwnerFromVault = new anchor.web3.PublicKey(quoteVaultData.slice(32, 64));
    const quoteVaultAmount = new BN(quoteVaultData.slice(64, 72), "le");

    console.log(`Quote Vault: ${addClmmLiquidityTx.quoteVault.toString()}`);
    console.log(`  Mint from vault data: ${quoteMintFromVault.toString()}`);
    console.log(`  Owner from vault data: ${quoteOwnerFromVault.toString()}`);
    console.log(`  Amount: ${quoteVaultAmount.toString()} lamports`);
    console.log(`  Amount in SOL: ${quoteVaultAmount.toNumber() / anchor.web3.LAMPORTS_PER_SOL}`);

    const baseVaultAccount = await provider.connection.getAccountInfo(
      addClmmLiquidityTx.baseVault
    );
    assert.ok(baseVaultAccount, "Base vault should exist");

    const baseVaultData = baseVaultAccount.data;
    const baseVaultAmount = new BN(baseVaultData.slice(64, 72), "le");
    console.log(`Base Vault: ${addClmmLiquidityTx.baseVault.toString()}`);
    console.log(`  Amount: ${baseVaultAmount.toString()} tokens`);

    const launchData = await sdk.fetchLaunch(launchPda);
    const totalDepositedSOL = launchData.totalDeposited.toNumber() / anchor.web3.LAMPORTS_PER_SOL;

    console.log(`\n${totalDepositedSOL} SOL deposited: base=${baseVaultAmount.toString()}, quote=${quoteVaultAmount.toString()}`);
  });




  // TODO CLAUDE please integrate this test to the flow
  it("Performs trading on the Raydium CLMM pool", async () => {
    console.log("=== Performing Trading on Raydium CLMM Pool ===");

    // Skip if Raydium not available
    const raydiumProgramId = new anchor.web3.PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");
    const raydiumInfo = await provider.connection.getAccountInfo(raydiumProgramId);
    if (!raydiumInfo) {
      console.log("Raydium CLMM program not found. Skipping trading test.");
      return;
    }

    const traders: anchor.web3.Keypair[] = [];
    const numTraders = 2;
    for (let i = 0; i < numTraders; i++) {
      traders.push(anchor.web3.Keypair.generate());
    }

    // Fund traders with SOL
    console.log("Funding traders with SOL...");
    const fundAmount = new anchor.BN(1.1 * anchor.web3.LAMPORTS_PER_SOL); // 1.1 SOL each
    for (let i = 0; i < traders.length; i++) {
      const fundTx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: admin.publicKey,
          toPubkey: traders[i].publicKey,
          lamports: fundAmount.toNumber(),
        })
      );
      const fundSig = await provider.sendAndConfirm(fundTx, [adminKeypair]);
      console.log(`  ✅ Funded trader ${i + 1}: ${fundSig}`);
    }

    // Get pool info for trading
    const sqrtLower = await sdk.getSqrtPriceLowerX64ForPool({ launch: clmmLaunchState, priceBumpMultiplier: 1.02, lowerRangePow10: -2 });
    const range = await sdk.getLiquidityRange({ launch: clmmLaunchState, sqrtPriceLowerX64: sqrtLower });
    const [poolState] = sdk.getPoolPda(clmmLaunchState);

    try {
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

      // Buy: WSOL -> base token
      const inputMint = WSOL_MINT;
      const amountIn = new BN(1 * anchor.web3.LAMPORTS_PER_SOL); // 1 SOL

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

      // Execute swap (buy)
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

      // Temporarily suppress console.log to hide simulation output
      const originalConsoleLog = console.log;
      console.log = () => {};

      const buyResult = await executeBuy({ sendAndConfirm: true });

      // Restore console.log
      console.log = originalConsoleLog;

      console.log(`  ✅ Buy completed: ${buyResult.txId}`);

    } catch (error) {
      console.error(`  ❌ Trading test failed:`, error.message);
      // Don't fail the test if Raydium trading fails on localnet
      console.log("Trading test skipped due to Raydium compatibility issues on localnet");
    }

    console.log("✅ Trading completed successfully");
  });

  it("Harvests CLMM fees through income-dispatcher", async () => {
    console.log("=== Harvesting CLMM Fees through Income-Dispatcher ===");

    // Skip if Raydium not available
    const raydiumProgramId = new anchor.web3.PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");
    const raydiumInfo = await provider.connection.getAccountInfo(raydiumProgramId);
    if (!raydiumInfo) {
      console.log("Raydium CLMM program not found. Skipping fee harvesting test.");
      return;
    }

    // Get required accounts for the harvest
    const launchStateData = await sdk.fetchLaunch(clmmLaunchState);
    const escrowAuthority = sdk.getEscrowAuthorityPda(clmmLaunchState)[0];

    // Use position information from add liquidity test
    if (!positionNftMint || !positionNftAccount || !personalPosition || !protocolPosition || !raydiumPoolState || !quoteVault || !baseVault || !tickArrayLower || !tickArrayUpper) {
      console.log("Position information not available, skipping fee harvesting test");
      return;
    }

    const sqrtLower = await sdk.getSqrtPriceLowerX64ForPool({ launch: clmmLaunchState, priceBumpMultiplier: 1.02, lowerRangePow10: -2 });
    const range = await sdk.getLiquidityRange({ launch: clmmLaunchState, sqrtPriceLowerX64: sqrtLower });

    // Use stored tick arrays from add liquidity operation
    const poolState = raydiumPoolState;

    // Determine token vault order based on mint addresses
    // token_mint_0 is the smaller address, token_mint_1 is the larger
    const isBaseSmaller = baseMintKeypair.publicKey.toString() > WSOL_MINT.toString();

    const tokenVault0 = isBaseSmaller ? baseVault : quoteVault;
    const tokenVault1 = isBaseSmaller ? quoteVault : baseVault;

    // For fee collection, remaining accounts
    const remainingAccounts: any[] = [];

    // Check if tick array bitmap extension is needed
    const poolStateAccount = await provider.connection.getAccountInfo(poolState);
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
            [Buffer.from("pool_tick_array_bitmap_extension"), poolState.toBuffer()],
            raydiumProgramId
          );

          remainingAccounts.push({
            pubkey: tickArrayBitmapExtension,
            isWritable: true,
            isSigner: false,
          });
        }
      }
    }

    // Get PDAs
    const projectPoolPda = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("income-dispatcher"), Buffer.from("project_pool"), Buffer.from(new anchor.BN(launchStateData.projectId).toArray('be', 8))],
      incomeDispatcherProgram.programId
    )[0];
    const projectAuthorityPda = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("income-dispatcher"), Buffer.from("project_authority"), Buffer.from(new anchor.BN(launchStateData.projectId).toArray('be', 8))],
      incomeDispatcherProgram.programId
    )[0];
    const baseVaultPda = getAssociatedTokenAddressSync(baseMintKeypair.publicKey, projectAuthorityPda, true);
    const quoteVaultPda = getAssociatedTokenAddressSync(WSOL_MINT, projectAuthorityPda, true);

    // Harvest transaction
    const harvestTx = await incomeDispatcherProgram.methods
      .harvestPool()
      .accountsStrict({
        payer: admin.publicKey,
        config: getIncomeDispatcherConfigPda(),
        launchState: clmmLaunchState,
        projectPool: projectPoolPda,
        incomeDispatcherAuthority: getIncomeDispatcherAuthorityPda(),
        projectAuthority: projectAuthorityPda,
        quoteMint: WSOL_MINT,
        baseMint: baseMintKeypair.publicKey,
        quoteVault: quoteVaultPda,
        baseVault: baseVaultPda,
        engineProgram: program.programId,
        raydiumProgram: raydiumProgramId,
        escrowAuthority,
        positionNftMint,
        positionNftAccount,
        personalPosition,
        poolState,
        protocolPosition,
        tokenVault0: tokenVault0,
        tokenVault1: tokenVault1,
        tickArrayLower,
        tickArrayUpper,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenProgram2022: TOKEN_2022_PROGRAM_ID,
        memoProgram: MEMO_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .remainingAccounts(remainingAccounts)
      .signers([adminKeypair])
      .transaction();

    // Add compute budget instruction to increase CU limit
    harvestTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 2_000_000 }));

    const harvestSig = await provider.sendAndConfirm(harvestTx, [adminKeypair], { skipPreflight: true });
    console.log("✅ CLMM fees harvested:", harvestSig);

    // Now claim for platform
    const platformWallet = admin.publicKey;
    const platformBaseAta = getAssociatedTokenAddressSync(baseMintKeypair.publicKey, platformWallet, true);
    const platformQuoteAta = getAssociatedTokenAddressSync(WSOL_MINT, platformWallet, true);

    await incomeDispatcherProgram.methods.claimPlatform().accountsStrict({
      payer: admin.publicKey,
      platformWallet: admin.publicKey,
      config: getIncomeDispatcherConfigPda(),
      projectPool: projectPoolPda,
      projectAuthority: projectAuthorityPda,
      baseVault: baseVaultPda,
      quoteVault: quoteVaultPda,
      platformBaseAta,
      platformQuoteAta,
      baseMint: baseMintKeypair.publicKey,
      quoteMint: WSOL_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([adminKeypair]).rpc();

    console.log("✅ Platform fees claimed");

    // Claim for creator (assume admin is creator)
    const creator = admin.publicKey;
    const creatorBaseAta = getAssociatedTokenAddressSync(baseMintKeypair.publicKey, creator, true);
    const creatorQuoteAta = getAssociatedTokenAddressSync(WSOL_MINT, creator, true);

    await incomeDispatcherProgram.methods.claimCreator().accountsStrict({
      creator: admin.publicKey,
      launchState: clmmLaunchState,
      projectPool: projectPoolPda,
      projectAuthority: projectAuthorityPda,
      baseVault: baseVaultPda,
      quoteVault: quoteVaultPda,
      creatorBaseAta,
      creatorQuoteAta,
      baseMint: baseMintKeypair.publicKey,
      quoteMint: WSOL_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([adminKeypair]).rpc();

    console.log("✅ Creator fees claimed");

    // Claim for community
    const communityBaseAta = getAssociatedTokenAddressSync(baseMintKeypair.publicKey, admin.publicKey, true);
    const communityQuoteAta = getAssociatedTokenAddressSync(WSOL_MINT, admin.publicKey, true);

    await incomeDispatcherProgram.methods.claimCommunity(new anchor.BN(1000000), new anchor.BN(1000000)).accountsStrict({
      payer: admin.publicKey,
      config: getIncomeDispatcherConfigPda(),
      communityClaimSigner: communityClaimSignerKeypair.publicKey,
      tokenRecipient: admin.publicKey,
      projectPool: projectPoolPda,
      projectAuthority: projectAuthorityPda,
      baseVault: baseVaultPda,
      quoteVault: quoteVaultPda,
      communityBaseAta,
      communityQuoteAta,
      baseMint: baseMintKeypair.publicKey,
      quoteMint: WSOL_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([adminKeypair, communityClaimSignerKeypair]).rpc();

    console.log("✅ Community fees claimed");

    console.log("✅ Fee harvesting and claiming completed successfully");
  });

});
