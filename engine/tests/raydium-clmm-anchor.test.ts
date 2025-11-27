import * as anchor from "@coral-xyz/anchor";
const { BN } = anchor;
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
  let projectId = PROJECT_ID;

  const BUYER1_AMOUNT = parseInt(process.env.BUYER1_AMOUNT || "150");
  const BUYER2_AMOUNT = parseInt(process.env.BUYER2_AMOUNT || "150");
  const BUYER3_AMOUNT = parseInt(process.env.BUYER3_AMOUNT || "150");

  async function getClusterUnixTime(connection: anchor.web3.Connection): Promise<number> {
    const accountInfo = await connection.getAccountInfo(anchor.web3.SYSVAR_CLOCK_PUBKEY);
    if (!accountInfo) {
      throw new Error("Clock sysvar unavailable");
    }
    return Number(accountInfo.data.readBigInt64LE(32));
  }

  async function waitForClusterTimestamp(connection: anchor.web3.Connection, targetTimestamp: number): Promise<void> {
    while (true) {
      const currentTimestamp = await getClusterUnixTime(connection);
      if (currentTimestamp >= targetTimestamp) {
        return;
      }
      const secondsToWait = Math.min(targetTimestamp - currentTimestamp + 1, 5);
      console.log(`Waiting ${secondsToWait} seconds for cluster time to reach funding end`);
      await new Promise((resolve) => setTimeout(resolve, secondsToWait * 1000));
    }
  }


  it("Step 0: Verify Raydium CLMM and AmmConfig are loaded", async () => {
    console.log("=== Step 0: Verify Raydium Setup ===");

    const raydiumClmmProgramId = new anchor.web3.PublicKey("DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH");
    const ammConfigAddress = new anchor.web3.PublicKey("FZdkW5jiYsjTnCVqFqPrxrQisQkCYrohd7ArZhoKnM8q");

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

    if (!configInfo) {
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

  it("Step 2: Initialize launch from preset", async () => {
    console.log("=== Step 2: Initialize Launch from Preset ===");

    const nextProjectId = (await sdk.getNextProjectId()).toNumber();
    projectId = nextProjectId > 0 ? nextProjectId : PROJECT_ID;

    const { launchPda: launch, signature } = await sdk.initLaunchFromPreset({
      presetId: PRESET_ID,
      projectId,
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
    const [rosterShard] = sdk.getRosterShardPda(launchPda, 1);
    const rosterShardInfo = await provider.connection.getAccountInfo(rosterShard);
    assert.ok(rosterShardInfo, "Roster shard 1 should exist after initRoster");
    console.log("Roster shard 1 already initialized via initRoster");
  });

  it(`Step 3: Make deposits (${BUYER1_AMOUNT + BUYER2_AMOUNT + BUYER3_AMOUNT} SOL total)`, async () => {
    console.log(`=== Step 3: Make Deposits (${BUYER1_AMOUNT} + ${BUYER2_AMOUNT} + ${BUYER3_AMOUNT} = ${BUYER1_AMOUNT + BUYER2_AMOUNT + BUYER3_AMOUNT} SOL) ===`);

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

  it("Step 4: Wait for funding period and finalize shard", async () => {
    console.log("=== Step 4: Wait for Funding Period ===");

    const launchData = await sdk.fetchLaunch(launchPda);
    await waitForClusterTimestamp(provider.connection, launchData.fundingPeriodEnd.toNumber());

    console.log("=== Step 5: Finalize Roster Shard ===");

    const { signature } = await sdk.finalizeRosterShard({
      launch: launchPda,
      shardId: 1,
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

  it("Step 11: Verify getRaydiumPoolByProjectId and fetch pool price", async () => {
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
