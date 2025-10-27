import { fromWorkspace, LiteSVMProvider } from "anchor-litesvm";
import { LiteSVM } from "litesvm";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, unpackAccount } from "@solana/spl-token";
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

      // Check if account was created
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

    const targetRaise = 100 + Math.floor(Math.random() * 350);
    console.log(`Target raise: ${targetRaise} SOL`);

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

    addLiquidityResultTx = await sdk.addClmmLiquidityTx({
      payer: admin.publicKey,
      launch: clmmLaunchState,
      quoteMint: WSOL_MINT,
      baseMint: baseMintKeypair.publicKey,
      baseTokenAta: createPoolResultTx.baseTokenAta,
      ammConfig: raydiumAmmConfig,
      clmmProgram: raydiumProgramId,
      provider,
    });

    console.log("Adding liquidity...");
    const liquiditySig = await provider.sendAndConfirm(
      addLiquidityResultTx.transaction,
      [admin.payer, ...addLiquidityResultTx.signers]
    );
    console.log("✅ Liquidity added:", liquiditySig);

    const quoteTokenAta = addLiquidityResultTx.quoteTokenAta;
    const quoteTokenAtaInfo = client.getAccount(quoteTokenAta);
    console.log(`\n=== Quote Token ATA (WSOL) ===`);
    console.log("Quote token ATA:", quoteTokenAta.toString());
    if (quoteTokenAtaInfo && quoteTokenAtaInfo.data.length >= 72) {
      const dataBuffer = Buffer.from(quoteTokenAtaInfo.data);
      const amount = dataBuffer.readBigUInt64LE(64);
      console.log("WSOL token amount:", Number(amount) / anchor.web3.LAMPORTS_PER_SOL, "SOL");
    } else {
      console.log("Quote token ATA data:", quoteTokenAtaInfo ? `${quoteTokenAtaInfo.data.length} bytes` : "not found");
    }

    const payerBalanceAfter = client.getBalance(admin.publicKey);
    console.log(`\nPayer balance after liquidity: ${Number(payerBalanceAfter) / anchor.web3.LAMPORTS_PER_SOL} SOL`);

    console.log("\n=== Pool State Details ===");
    console.log("Pool State PDA:", createPoolResultTx.poolState.toString());
    const poolStateAccount = client.getAccount(createPoolResultTx.poolState);
    if (poolStateAccount) {
      console.log("✅ Pool account exists");
      console.log("Pool data size:", poolStateAccount.data.length, "bytes");
      console.log("Pool owner:", new anchor.web3.PublicKey(poolStateAccount.owner).toString());
    }

    console.log("\n=== Quote Vault (WSOL) ===");
    console.log("Quote vault PDA:", addLiquidityResultTx.quoteVault.toString());
    const quoteVaultBalance = client.getBalance(addLiquidityResultTx.quoteVault);
    console.log("Quote vault balance:", Number(quoteVaultBalance) / anchor.web3.LAMPORTS_PER_SOL, "SOL");

    console.log("\n=== Base Vault (Token) ===");
    console.log("Base vault PDA:", addLiquidityResultTx.baseVault.toString());
    const baseVaultAccount = client.getAccount(addLiquidityResultTx.baseVault);
    if (baseVaultAccount && baseVaultAccount.data.length >= 72) {
      const dataBuffer = Buffer.from(baseVaultAccount.data);
      const amount = dataBuffer.readBigUInt64LE(64);
      console.log("Base vault token amount:", Number(amount) / 1_000_000, "tokens");
    }

    console.log("\n=== Position NFT ===");
    if (addLiquidityResultTx.positionNftMint) {
      console.log("Position NFT mint:", addLiquidityResultTx.positionNftMint.toString());
      const nftMintAccount = client.getAccount(addLiquidityResultTx.positionNftMint);
      if (nftMintAccount) {
        console.log("✅ Position NFT mint exists");
      }

      const escrowAuthority = sdk.getEscrowAuthorityPda(clmmLaunchState)[0];
      const positionNftAta = anchor.utils.token.associatedAddress({
        mint: addLiquidityResultTx.positionNftMint,
        owner: escrowAuthority,
      });
      const nftAtaInfo = client.getAccount(positionNftAta);
      if (nftAtaInfo) {
        const nftAccount = unpackAccount(positionNftAta, nftAtaInfo);
        console.log("Position NFT owner:", nftAccount.owner.toString());
        assert.ok(nftAccount.owner.equals(escrowAuthority), "Position NFT owned by escrow_authority");
        console.log("✅ Position NFT owned by escrow_authority");
      }
    }
  });

  it.skip("Executes trader swaps to accumulate fees", async () => {
    console.log("=== Executing Trader Swaps ===");
    console.log("⚠️  TODO: Implement swap functionality with proper tick array setup");
  });
});
