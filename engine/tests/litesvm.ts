import { fromWorkspace, LiteSVMProvider } from "anchor-litesvm";
import { LiteSVM, FailedTransactionMetadata } from "litesvm";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import bs58 from "bs58";
import { SendTransactionError } from "@solana/web3.js";
import {
  createInitializeMintInstruction,
  TOKEN_PROGRAM_ID,
  unpackAccount
} from "@solana/spl-token";
import { assert } from "chai";

import { Engine } from "../target/types/engine";
import EngineSDK from "../ts-sdk/src/engine";

import { advanceTime, createAndFundAccount } from "./utils";
import { setupRaydiumCLMM } from "./raydium-setup";

let client: LiteSVM;
let provider: LiteSVMProvider;
let program: Program<Engine>;
let admin: anchor.Wallet;
let sdk: ReturnType<typeof EngineSDK.create>;
let adminKeypair: anchor.web3.Keypair;

describe("engine litesvm", () => {

  let saleMint: anchor.web3.Keypair;
  let launchState: anchor.web3.PublicKey;

  const HARD_CAP_LAMPORTS = new anchor.BN(100 * anchor.web3.LAMPORTS_PER_SOL);
  const MIN_RAISE_LAMPORTS = new anchor.BN(10 * anchor.web3.LAMPORTS_PER_SOL);
  const PER_WALLET_CAP = new anchor.BN(5 * anchor.web3.LAMPORTS_PER_SOL);
  const TAU_LAMPORTS = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);
  const SALE_ALLOCATION = new anchor.BN(1000000);
  const LP_ALLOCATION = new anchor.BN(500000);
  const ROSTER_SHARD_CAP = 100;

  before(async () => {
    client = fromWorkspace("./");
    provider = new LiteSVMProvider(client);
    anchor.setProvider(provider);
    program = anchor.workspace.engine as Program<Engine>;
    admin = provider.wallet;
    adminKeypair = (provider.wallet as any).payer;
    sdk = EngineSDK.create(provider as any, program as any, adminKeypair);

    // Fund the admin account with more SOL for account creation
    client.airdrop(admin.publicKey, BigInt(100 * anchor.web3.LAMPORTS_PER_SOL));
  });

  it("Initializes the launch state correctly", async () => {
    saleMint = anchor.web3.Keypair.generate();

    const result = await sdk.initLaunchTx({
      creator: admin.publicKey,
      saleMint: saleMint,
      hardCapLamports: HARD_CAP_LAMPORTS,
      minRaiseLamports: MIN_RAISE_LAMPORTS,
      perWalletCap: PER_WALLET_CAP,
      tauLamports: TAU_LAMPORTS,
      saleAllocation: SALE_ALLOCATION,
      lpAllocation: LP_ALLOCATION,
      fundingDurationSeconds: 10,
      rosterShardCap: ROSTER_SHARD_CAP,
      creatorInitialDepositLamports: new anchor.BN(0),
      creatorDailyLamportsLimit: new anchor.BN(0),
      creatorClaimLockPeriodSec: new anchor.BN(2),
      provider,
    });

    const initTx = await provider.sendAndConfirm(result.initLaunchTx, [admin.payer, ...result.signers]);
    console.log("Init launch tx signature:", initTx);

    launchState = result.launchState;
    const state = await sdk.fetchLaunch(launchState);

    assert.isTrue(state.projectId.toNumber() >= 0, "Project ID should be non-negative");
    assert.ok(state.creator.equals(admin.publicKey));
    assert.equal(state.hardCapLamports.toNumber(), HARD_CAP_LAMPORTS.toNumber());
    assert.equal(state.minRaiseLamports.toNumber(), MIN_RAISE_LAMPORTS.toNumber());
    assert.equal(state.perWalletCap.toNumber(), PER_WALLET_CAP.toNumber());
    assert.equal(state.tauLamports.toNumber(), TAU_LAMPORTS.toNumber());
    assert.equal(state.saleAllocation.toNumber(), SALE_ALLOCATION.toNumber());
    assert.equal(state.lpAllocation.toNumber(), LP_ALLOCATION.toNumber());
    assert.equal(state.totalDeposited.toNumber(), 0);
    assert.equal(state.totalTickets, 0);
    const expectedKCapacity = HARD_CAP_LAMPORTS.toNumber() / TAU_LAMPORTS.toNumber();
    assert.equal(state.kCapacity, expectedKCapacity);
    assert.isFalse(state.selectionFinalized);
    assert.equal(state.selectionProcessed, 0);
    assert.isNull(state.thresholdScore);
    assert.isNull(state.vrfSeed);
    assert.isFalse(state.claimsOpen);
    assert.isNull(state.tokensPerTicket);
    assert.ok(state.saleMint.equals(saleMint.publicKey));
  });

  it.skip("Sets the VRF seed", async () => {
    // This test is flaky due to litesvm's time simulation.
    // The functionality is fully covered in the "Complete flow" test.
    // TODO (@wotory, @xykeeper): to get this test properly alive
  });

  it("Allows deposits", async () => {
    const testSaleMint = anchor.web3.Keypair.generate();

    const { initLaunchTx, signers, launchState: testLaunchState } = await sdk.initLaunchTx({
      creator: admin.publicKey,
      saleMint: testSaleMint,
      hardCapLamports: HARD_CAP_LAMPORTS,
      minRaiseLamports: MIN_RAISE_LAMPORTS,
      perWalletCap: PER_WALLET_CAP,
      tauLamports: TAU_LAMPORTS,
      saleAllocation: SALE_ALLOCATION,
      lpAllocation: LP_ALLOCATION,
      fundingDurationSeconds: 10,
      rosterShardCap: ROSTER_SHARD_CAP,
      creatorInitialDepositLamports: new anchor.BN(0),
      creatorDailyLamportsLimit: new anchor.BN(0),
      creatorClaimLockPeriodSec: new anchor.BN(2),
      provider,
    });

    await provider.sendAndConfirm(initLaunchTx, [admin.payer, ...signers]);

    const [rosterShard] = sdk.getRosterShardPda(testLaunchState, 0);
    const initRosterShardTx = await program.methods
      .initRosterShard(0)
      .accounts({
        payer: admin.publicKey,
        launchState: testLaunchState,
        rosterShard,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .transaction();
    await provider.sendAndConfirm(initRosterShardTx, [admin.payer]);
    const depositor = await createAndFundAccount(client, 20);
    const depositAmount = new anchor.BN(2 * anchor.web3.LAMPORTS_PER_SOL);

    const depositTx = await program.methods
      .deposit(depositAmount)
      .accounts({
        user: depositor.publicKey,
        launchState: testLaunchState,
        userContribution: sdk.getUserContributionPda(
          testLaunchState,
          depositor.publicKey
        )[0],
        rosterShard,
        escrowAuthority: sdk.getEscrowAuthorityPda(testLaunchState)[0],
        launch: testLaunchState,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .signers([depositor])
      .rpc();
    console.log("Deposit tx signature:", depositTx);

    const userContrib = await sdk.fetchUserContribution(testLaunchState, depositor.publicKey);
    assert.equal(userContrib.deposited.toNumber(), depositAmount.toNumber());
    assert.equal(userContrib.ticketCount, 2);

    const state = await sdk.fetchLaunch(testLaunchState);
    assert.equal(state.totalDeposited.toNumber(), depositAmount.toNumber());
    assert.equal(state.totalTickets, 2);
  });

  it("Allows withdrawals", async () => {
    const testSaleMint = anchor.web3.Keypair.generate();

    const { initLaunchTx, signers, launchState: testLaunchState } = await sdk.initLaunchTx({
      creator: admin.publicKey,
      saleMint: testSaleMint,
      hardCapLamports: HARD_CAP_LAMPORTS,
      minRaiseLamports: MIN_RAISE_LAMPORTS,
      perWalletCap: PER_WALLET_CAP,
      tauLamports: TAU_LAMPORTS,
      saleAllocation: SALE_ALLOCATION,
      lpAllocation: LP_ALLOCATION,
      fundingDurationSeconds: 10,
      rosterShardCap: ROSTER_SHARD_CAP,
      creatorInitialDepositLamports: new anchor.BN(0),
      creatorDailyLamportsLimit: new anchor.BN(0),
      creatorClaimLockPeriodSec: new anchor.BN(2),
      provider,
    });

    await provider.sendAndConfirm(initLaunchTx, [admin.payer, ...signers]);

    await sdk.initRoster({
      launch: testLaunchState,
    });

    const [rosterShard] = sdk.getRosterShardPda(testLaunchState, 0);
    const initRosterShardTx = await program.methods
      .initRosterShard(0)
      .accounts({
        payer: admin.publicKey,
        launchState: testLaunchState,
        rosterShard,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .transaction();
    await provider.sendAndConfirm(initRosterShardTx, [admin.payer]);

    const depositor = await createAndFundAccount(client, 20);
    const depositAmount = new anchor.BN(2 * anchor.web3.LAMPORTS_PER_SOL);

    await program.methods
      .deposit(depositAmount)
      .accounts({
        user: depositor.publicKey,
        launchState: testLaunchState,
        userContribution: sdk.getUserContributionPda(
          testLaunchState,
          depositor.publicKey
        )[0],
        rosterShard,
        escrowAuthority: sdk.getEscrowAuthorityPda(testLaunchState)[0],
        launch: testLaunchState,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .signers([depositor])
      .rpc();

    const initialBalance = client.getBalance(depositor.publicKey);

    const withdrawSig = await program.methods
      .withdraw(depositAmount)
      .accounts({
        user: depositor.publicKey,
        launchState: testLaunchState,
        userContribution: sdk.getUserContributionPda(
          testLaunchState,
          depositor.publicKey
        )[0],
        rosterShard,
        escrowAuthority: sdk.getEscrowAuthorityPda(testLaunchState)[0],
        launch: testLaunchState,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .signers([depositor])
      .rpc();

    console.log("Withdraw tx signature:", withdrawSig);

    const finalBalance = client.getBalance(depositor.publicKey);

    assert.isAbove(Number(finalBalance), Number(initialBalance));

    const state = await sdk.fetchLaunch(testLaunchState);
    assert.equal(state.totalDeposited.toNumber(), 0);

    const userContrib = await sdk.fetchUserContribution(testLaunchState, depositor.publicKey);
    assert.equal(userContrib.deposited.toNumber(), 0);
  });

  it("Project ID increments correctly", async () => {
    const project1Mint = anchor.web3.Keypair.generate();
    const project2Mint = anchor.web3.Keypair.generate();
    const project3Mint = anchor.web3.Keypair.generate();

    const [project1Launch] = sdk.getLaunchPda(project1Mint.publicKey);

    await sdk.initLaunch({
      saleMint: project1Mint.publicKey,
      hardCapLamports: HARD_CAP_LAMPORTS,
      minRaiseLamports: MIN_RAISE_LAMPORTS,
      perWalletCap: PER_WALLET_CAP,
      tauLamports: TAU_LAMPORTS,
      saleAllocation: SALE_ALLOCATION,
      lpAllocation: LP_ALLOCATION,
      fundingDurationSeconds: 10,
      rosterShardCap: ROSTER_SHARD_CAP,
      creatorInitialDepositLamports: new anchor.BN(0),
      creatorDailyLamportsLimit: new anchor.BN(0),
      creatorClaimLockPeriodSec: new anchor.BN(2),
      preInstructions: [
        anchor.web3.SystemProgram.createAccount({
          fromPubkey: admin.publicKey,
          newAccountPubkey: project1Mint.publicKey,
          space: 82,
          lamports: 2039280, // Fixed rent exemption for 82 bytes
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
          project1Mint.publicKey,
          6,
          admin.publicKey,
          admin.publicKey
        ),
      ],
      signers: [admin.payer, project1Mint],
    });

    const [project2Launch] = sdk.getLaunchPda(project2Mint.publicKey);

    await sdk.initLaunch({
      saleMint: project2Mint.publicKey,
      hardCapLamports: HARD_CAP_LAMPORTS,
      minRaiseLamports: MIN_RAISE_LAMPORTS,
      perWalletCap: PER_WALLET_CAP,
      tauLamports: TAU_LAMPORTS,
      saleAllocation: SALE_ALLOCATION,
      lpAllocation: LP_ALLOCATION,
      fundingDurationSeconds: 10,
      rosterShardCap: ROSTER_SHARD_CAP,
      creatorInitialDepositLamports: new anchor.BN(0),
      creatorDailyLamportsLimit: new anchor.BN(0),
      creatorClaimLockPeriodSec: new anchor.BN(2),
      preInstructions: [
        anchor.web3.SystemProgram.createAccount({
          fromPubkey: admin.publicKey,
          newAccountPubkey: project2Mint.publicKey,
          space: 82,
          lamports: 2039280, // Fixed rent exemption for 82 bytes
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
          project2Mint.publicKey,
          6,
          admin.publicKey,
          admin.publicKey
        ),
      ],
      signers: [admin.payer, project2Mint],
    });

    const [project3Launch] = sdk.getLaunchPda(project3Mint.publicKey);

    await sdk.initLaunch({
      saleMint: project3Mint.publicKey,
      hardCapLamports: HARD_CAP_LAMPORTS,
      minRaiseLamports: MIN_RAISE_LAMPORTS,
      perWalletCap: PER_WALLET_CAP,
      tauLamports: TAU_LAMPORTS,
      saleAllocation: SALE_ALLOCATION,
      lpAllocation: LP_ALLOCATION,
      fundingDurationSeconds: 10,
      rosterShardCap: ROSTER_SHARD_CAP,
      creatorInitialDepositLamports: new anchor.BN(0),
      creatorDailyLamportsLimit: new anchor.BN(0),
      creatorClaimLockPeriodSec: new anchor.BN(2),
      preInstructions: [
        anchor.web3.SystemProgram.createAccount({
          fromPubkey: admin.publicKey,
          newAccountPubkey: project3Mint.publicKey,
          space: 82,
          lamports: 2039280, // Fixed rent exemption for 82 bytes
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
          project3Mint.publicKey,
          6,
          admin.publicKey,
          admin.publicKey
        ),
      ],
      signers: [admin.payer, project3Mint],
    });

    const project1State = await sdk.fetchLaunch(project1Launch);
    const project2State = await sdk.fetchLaunch(project2Launch);
    const project3State = await sdk.fetchLaunch(project3Launch);

    assert.equal(
      project2State.projectId.toNumber(),
      project1State.projectId.toNumber() + 1
    );
    assert.equal(
      project3State.projectId.toNumber(),
      project2State.projectId.toNumber() + 1
    );

    console.log("Project IDs increment correctly:", {
      project1: project1State.projectId.toNumber(),
      project2: project2State.projectId.toNumber(),
      project3: project3State.projectId.toNumber(),
    });
  });

  it("PDA derivation consistency", async () => {
    const testMint = anchor.web3.Keypair.generate();

    const sdkPdas = sdk.deriveAllPdas(testMint.publicKey);

    const [directLaunch] = sdk.getLaunchPda(testMint.publicKey);
    const [directEscrow] = sdk.getEscrowPda(directLaunch);
    const [directRoster] = sdk.getRosterPda(directLaunch);
    const [directRosterShard] = sdk.getRosterShardPda(directLaunch, 0);
    const [directMintAuth] = sdk.getMintAuthPda(directLaunch);
    const [directProjectCounter] = sdk.getProjectCounterPda();

    assert.ok(sdkPdas.launch.equals(directLaunch));
    assert.ok(sdkPdas.escrow.equals(directEscrow));
    assert.ok(sdkPdas.roster.equals(directRoster));
    // selection PDA deprecated; verify roster shard PDA derivation works
    assert.ok(directRosterShard.equals(sdk.getRosterShardPda(directLaunch, 0)[0]));
    assert.ok(sdkPdas.mintAuth.equals(directMintAuth));
    assert.ok(sdkPdas.projectCounter.equals(directProjectCounter));

    console.log(
      "All PDA derivations are consistent between SDK and direct program calls"
    );
  });

  it("Creates pool with blockhash verification", async () => {
    console.log("\n=== Creating Pool ===");

    const existingLaunchPda = launchState;
    const [earlyPoolState] = sdk.getPoolPda(existingLaunchPda);
    const SLOT_HASHES_SYSVAR = new anchor.web3.PublicKey("SysvarS1otHashes111111111111111111111111111");

    // Attempt to create pool at the very beginning - should fail (simulate to avoid side effects)
    try {
      const { transaction } = await sdk.createPoolTx({
        payer: admin.publicKey,
        launch: existingLaunchPda,
      });
      await provider.simulate(transaction);
      assert.fail("createPool should fail before deposits/claims/blockhash setup");
    } catch (err) {
      const msg = (err as any)?.message ?? String(err);
      console.log("Expected failure (early createPool):", msg);
    }

    // Ensure selection is finalized and claims are open (mirror flowRunner.ts)
    let launchAccount = await sdk.fetchLaunch(existingLaunchPda);
    if (!launchAccount.selectionFinalized || !launchAccount.claimsOpen) {
      // 1) Init roster and shard 0
      await sdk.initRoster({ launch: existingLaunchPda });
      await sdk.initRosterShard({ launch: existingLaunchPda, shardId: 0 });

      // 2) Deposit up to min raise using multiple users, respecting per-wallet cap
      let totalDeposited = new anchor.BN(0);
      const [rosterShard] = sdk.getRosterShardPda(existingLaunchPda, 0);
      while (totalDeposited.lt(MIN_RAISE_LAMPORTS)) {
        const depositor = await createAndFundAccount(client, 10);
        const remaining = MIN_RAISE_LAMPORTS.sub(totalDeposited);
        const amount = remaining.gt(PER_WALLET_CAP) ? PER_WALLET_CAP : remaining;
        await sdk.deposit({
          launch: existingLaunchPda,
          amountLamports: amount,
          userKeypair: depositor,
          rosterShard,
        });
        totalDeposited = totalDeposited.add(amount);
      }

      // Attempt to create pool after deposits but before finalization/claims/blockhash - should fail (simulate)
      try {
        const { transaction } = await sdk.createPoolTx({
          payer: admin.publicKey,
          launch: existingLaunchPda,
        });
        await provider.simulate(transaction);
        assert.fail("createPool should fail before claims opened/blockhash setup");
      } catch (err) {
        const msg = (err as any)?.message ?? String(err);
        console.log("Expected failure (after deposits):", msg);
      }

      // 3) Advance time beyond funding period
      await advanceTime(client, { slots: BigInt(1000), seconds: BigInt(15) });

      // 4) Set VRF seed, finalize shard
      await sdk.setSeed({ launch: existingLaunchPda });
      await sdk.finalizeRosterShard({ launch: existingLaunchPda, shardId: 0 });
      // claims are opened in createPool now

      // Refresh state
      launchAccount = await sdk.fetchLaunch(existingLaunchPda);
      console.log(
        `Launch state - Selection finalized: ${launchAccount.selectionFinalized}`
      );
      console.log(`Launch state - Selection finalized: ${launchAccount.selectionFinalized}`);
    }

    // Configure SlotHashes to include a valid blockhash for this project's range
    const currentClock = client.getClock();

    function bigIntTo32BytesBE(x: bigint): Buffer {
      const buf = Buffer.alloc(32);
      let v = x;
      for (let i = 31; i >= 0; i--) {
        buf[i] = Number(v & BigInt(255));
        v = v >> BigInt(8);
      }
      return buf;
    }

    // Compute project's personal blockhash range and pick range_start (inclusive)
    const projectId = launchAccount.projectId.toNumber();
    const numBlocks = launchAccount.numBlocks.toNumber();
    const width = ((BigInt(1) << BigInt(256)) - BigInt(1)) / BigInt(numBlocks);
    const rangeStart = width * BigInt(projectId - 1);
    const rangeEnd = rangeStart + width; // exclusive upper bound; safe to use as an invalid hash

    // Write incorrect SlotHashes and simulate createPool (should fail)
    const invalidNumHashes = 512;
    const slotHashesDataInvalid = Buffer.alloc(8 + invalidNumHashes * 40);
    slotHashesDataInvalid.writeBigUInt64LE(BigInt(invalidNumHashes), 0);
    for (let i = 0; i < invalidNumHashes; i++) {
      const offset = 8 + i * 40;
      slotHashesDataInvalid.writeBigUInt64LE(currentClock.slot + BigInt(i + 1), offset);
      bigIntTo32BytesBE(rangeEnd).copy(slotHashesDataInvalid, offset + 8);
    }

    client.setAccount(SLOT_HASHES_SYSVAR, {
      lamports: 1_000_000,
      data: slotHashesDataInvalid,
      owner: anchor.web3.SystemProgram.programId,
      executable: false,
    });

    try {
      const { transaction } = await sdk.createPoolTx({
        payer: admin.publicKey,
        launch: existingLaunchPda,
      });
      await provider.simulate(transaction);
      assert.fail("createPool should fail with incorrect slot hashes");
    } catch (err) {
      const msg = (err as any)?.message ?? String(err);
      console.log("Expected failure (invalid SlotHashes):", msg);
    }

    const numHashes = 512;
    const slotHashesData = Buffer.alloc(8 + numHashes * 40);
    slotHashesData.writeBigUInt64LE(BigInt(numHashes), 0);
    // Fill 63 invalid hashes and put the valid one at index 63 (64th element)
    for (let i = 0; i < numHashes; i++) {
      const offset = 8 + i * 40;
      slotHashesData.writeBigUInt64LE(currentClock.slot + BigInt(i + 1), offset);
      if (i === numHashes - 1) {
        bigIntTo32BytesBE(rangeStart).copy(slotHashesData, offset + 8);
      } else {
        bigIntTo32BytesBE(rangeEnd).copy(slotHashesData, offset + 8);
      }
    }

    client.setAccount(SLOT_HASHES_SYSVAR, {
      lamports: 1_000_000,
      data: slotHashesData,
      owner: anchor.web3.SystemProgram.programId,
      executable: false,
    });

    const { signature } = await sdk.createPool({
      launch: existingLaunchPda,
      useTestMode: false,
      computeUnits: 2_000_000
    });

    console.log("Pool created successfully!");
    console.log("Signature:", signature);

    const poolState = await sdk.fetchPoolState(existingLaunchPda);
    console.log("Pool ID:", poolState.poolId.toString());
    console.log("Project ID:", poolState.projectId.toString());
    console.log("Created:", poolState.created);
    console.log("Created Slot:", poolState.createdSlot.toString());
    console.log(
      "Created Blockhash:",
      Buffer.from(poolState.createdBlockhash).toString("hex")
    );

    assert.ok(poolState.created, "Pool should be marked as created");
    assert.ok(
      poolState.launch.equals(existingLaunchPda),
      "Pool should reference correct launch"
    );

  });

  it("Initializes launch with creator deposit", async () => {
    // Check admin balance and adjust creator deposit accordingly
    const adminBalance = client.getBalance(admin.publicKey);
    const availableForDeposit = adminBalance - BigInt(anchor.web3.LAMPORTS_PER_SOL) / BigInt(2); // Reserve 0.5 SOL for fees
    let creatorDepositAmount = new anchor.BN(0);
    if (availableForDeposit > BigInt(0)) {
      const remainder = new anchor.BN(Number(availableForDeposit)).mod(TAU_LAMPORTS);
      creatorDepositAmount = new anchor.BN(Number(availableForDeposit)).sub(remainder);
    }

    const testSaleMint = anchor.web3.Keypair.generate();
    const [testLaunchState] = sdk.getLaunchPda(testSaleMint.publicKey);
    const [mintAuth] = sdk.getMintAuthPda(testLaunchState);
    const [creatorGrant] = sdk.getCreatorGrantPda(testLaunchState);

    const dailyLimit = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);

    // Skip test if no funds available for creator deposit
    if (creatorDepositAmount.toNumber() === 0) {
      console.log("Skipping creator deposit test - insufficient funds");
      return;
    }

    // Create mint account first
    const createMintIx = anchor.web3.SystemProgram.createAccount({
      fromPubkey: admin.publicKey,
      newAccountPubkey: testSaleMint.publicKey,
      space: 82,
      lamports: 2039280, // Fixed rent exemption for 82 bytes
      programId: TOKEN_PROGRAM_ID,
    });

    const initMintIx = createInitializeMintInstruction(
      testSaleMint.publicKey,
      6,
      mintAuth,
      admin.publicKey
    );

    // Initialize launch
    const initLaunchIx = await (program.methods as any)
      .initLaunch({
        hardCapLamports: HARD_CAP_LAMPORTS,
        minRaiseLamports: MIN_RAISE_LAMPORTS,
        perWalletCap: PER_WALLET_CAP,
        tauLamports: TAU_LAMPORTS,
        saleAllocation: SALE_ALLOCATION,
        lpAllocation: LP_ALLOCATION,
        fundingDurationSeconds: new anchor.BN(10),
        numBlocks: new anchor.BN(1000),
        rosterShardCap: ROSTER_SHARD_CAP,
        creatorInitialDepositLamports: creatorDepositAmount,
        creatorDailyLamportsLimit: dailyLimit,
        creatorClaimLockPeriodSec: new anchor.BN(2),
      })
      .accountsStrict({
        creator: admin.publicKey,
        projectCounter: sdk.getProjectCounterPda()[0],
        launchState: testLaunchState,
        saleMint: testSaleMint.publicKey,
        escrowAuthority: sdk.getEscrowAuthorityPda(testLaunchState)[0],
        creatorGrant: creatorGrant,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    // Send transaction
    const tx = new anchor.web3.Transaction().add(createMintIx, initMintIx, initLaunchIx);
    const signature = await provider.sendAndConfirm(tx, [testSaleMint]);

    console.log("Launch with creator deposit initialized. Signature:", signature);

    // Check launch state
    const launchState = await sdk.fetchLaunch(testLaunchState);
    const expectedTickets = Math.floor(creatorDepositAmount.toNumber() / TAU_LAMPORTS.toNumber());
    assert.equal(launchState.creatorReservedTickets, 0);
    assert.equal(launchState.creatorGrantPresent, creatorDepositAmount.toNumber() > 0);

    // Check creator grant state (only if creator deposit > 0)
    if (creatorDepositAmount.toNumber() > 0) {
      const creatorGrantState = await sdk.fetchCreatorGrant(testLaunchState);
      assert.equal(creatorGrantState.lockedLamports.toNumber(), creatorDepositAmount.toNumber());
      assert.equal(creatorGrantState.reservedTickets, 0);
      assert.equal(creatorGrantState.dailyLamportsLimit.toNumber(), dailyLimit.toNumber());
      assert.equal(creatorGrantState.dailyTicketCap, dailyLimit.toNumber() / TAU_LAMPORTS.toNumber());
      assert.equal(creatorGrantState.claimedTickets, 0);
      assert.isFalse(creatorGrantState.refunded);
      assert.ok(creatorGrantState.creator.equals(admin.publicKey));
      assert.ok(creatorGrantState.launch.equals(testLaunchState));
    }

    console.log("Creator deposit test passed!");
  });


});

describe("engine litesvm - raydium clmm", () => {
  let raydiumProgramId: anchor.web3.PublicKey;
  let raydiumAmmConfig: anchor.web3.PublicKey;

  const MIN_RAISE_LAMPORTS = new anchor.BN(10 * anchor.web3.LAMPORTS_PER_SOL);
  const PER_WALLET_CAP = new anchor.BN(5 * anchor.web3.LAMPORTS_PER_SOL);
  const TAU_LAMPORTS = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);
  const ROSTER_SHARD_CAP = 100;

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

  function encodeSignatureSafe(sigRaw: any): string {
    if (!sigRaw) throw new Error("Missing signature");
    if (typeof sigRaw === "string") return sigRaw;
    if (Array.isArray(sigRaw)) return bs58.encode(Uint8Array.from(sigRaw));
    if (sigRaw instanceof Uint8Array) return bs58.encode(sigRaw);
    if (Buffer.isBuffer(sigRaw)) return bs58.encode(new Uint8Array(sigRaw));
    if (sigRaw?.buffer && typeof sigRaw.byteLength === "number") {
      return bs58.encode(new Uint8Array(sigRaw.buffer, sigRaw.byteOffset ?? 0, sigRaw.byteLength));
    }
    if (sigRaw?.data) {
      try { return bs58.encode(Uint8Array.from(sigRaw.data)); } catch {}
    }
    throw new TypeError("Unsupported signature type for encoding");
  }

  async function safeSendAndConfirm(tx: any, signers: any[]): Promise<string> {
    if ("version" in tx) {
      signers?.forEach((s) => tx.sign([s]));
    } else {
      tx.feePayer = tx.feePayer ?? provider.wallet.publicKey;
      tx.recentBlockhash = client.latestBlockhash();
      signers?.forEach((s) => tx.partialSign(s));
    }
    await provider.wallet.signTransaction(tx as any);
    const sigRaw = "version" in tx ? tx.signatures[0] : tx.signature;
    const signature = encodeSignatureSafe(sigRaw);
    const res = client.sendTransaction(tx as any);
    if (res instanceof FailedTransactionMetadata) {
      throw new SendTransactionError({
        action: "send",
        signature,
        transactionMessage: res.err().toString(),
        logs: res.meta().logs(),
      } as any);
    }
    return signature;
  }

  it("Creates CLMM pool on Raydium", async () => {
    console.log("\n=== Creating CLMM Pool ===");

    const clmmSaleMint = anchor.web3.Keypair.generate();
    const CLMM_HARD_CAP = new anchor.BN(500 * anchor.web3.LAMPORTS_PER_SOL);
    const CLMM_SALE_ALLOCATION = new anchor.BN(540_540_000);
    const CLMM_LP_ALLOCATION = new anchor.BN(459_460_000);

    const { initLaunchTx, signers, launchState: clmmLaunchState } = await sdk.initLaunchTx({
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

    console.log("Initializing launch...");
    console.log("Launch state PDA:", clmmLaunchState.toString());
    console.log("Sale mint:", clmmSaleMint.publicKey.toString());
      const initLaunchSignature = await provider.sendAndConfirm(initLaunchTx, [admin.payer, ...signers]);
    console.log("✅ Launch initialized:", initLaunchSignature);
    console.log("Fetching launch state...");
    const launchStateData = await sdk.fetchLaunch(clmmLaunchState);
    console.log("Launch state verified:", launchStateData.projectId.toString());

    await sdk.initRoster({ launch: clmmLaunchState });
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

    const stateData = await sdk.fetchLaunch(clmmLaunchState);
    const lpAllocationTokens = Number(stateData.lpAllocation) * 1_000_000_000;
    const saleAllocationTokens = Number(stateData.saleAllocation) * 1_000_000_000;
    const requiredQuoteForLiquidity = Math.ceil((lpAllocationTokens * Number(stateData.totalDeposited)) / saleAllocationTokens) + 1_000_000_000;
    const requiredSOL = requiredQuoteForLiquidity / anchor.web3.LAMPORTS_PER_SOL;
    console.log(`Funding payer with ${requiredSOL} SOL for liquidity`);

    const fundedPayer = await createAndFundAccount(client, requiredSOL + 10);

    const WSOL_MINT = new anchor.web3.PublicKey("So11111111111111111111111111111111111111112");

    console.log("Raydium CLMM setup:");
    console.log("CLMM Program:", raydiumProgramId.toString());
    console.log("Quote Mint (WSOL):", WSOL_MINT.toString());
    console.log("AMM Config:", raydiumAmmConfig.toString());

    const SYSVAR_CLOCK_PUBKEY = new anchor.web3.PublicKey("SysvarC1ock11111111111111111111111111111111");
    const currentClock = client.getClock();
    const futureTimestamp = BigInt(Math.floor(Date.now() / 1000));

    const clockData = Buffer.alloc(40);
    clockData.writeBigUInt64LE(BigInt(Number(currentClock.slot) + 100), 0 as any);
    clockData.writeBigInt64LE(BigInt(Number(futureTimestamp)), 8 as any);
    clockData.writeBigUInt64LE(BigInt(0), 16 as any);
    clockData.writeBigUInt64LE(BigInt(0), 24 as any);
    clockData.writeBigInt64LE(BigInt(Number(futureTimestamp)), 32 as any);

    client.setAccount(SYSVAR_CLOCK_PUBKEY, {
      lamports: 1000000,
      data: clockData,
      owner: anchor.web3.SystemProgram.programId,
      executable: false,
    });

    const clock = client.getClock();
    console.log("Updated clock:", {
      slot: clock.slot.toString(),
      unixTimestamp: clock.unixTimestamp.toString(),
    });

    let baseMintKeypair: anchor.web3.Keypair;
    do {
      baseMintKeypair = anchor.web3.Keypair.generate();
    } while (baseMintKeypair.publicKey.toBuffer().compare(WSOL_MINT.toBuffer()) <= 0);

    const createPoolResultTx = await sdk.createClmmPoolTx({
      payer: admin.publicKey,
      launch: clmmLaunchState,
      quoteMint: WSOL_MINT,
      baseMint: baseMintKeypair,
      ammConfig: raydiumAmmConfig,
      clmmProgram: raydiumProgramId,
      provider,
    });

    console.log("Creating CLMM pool...");
    const poolSig = await safeSendAndConfirm(
      createPoolResultTx.transaction,
      [admin.payer, ...createPoolResultTx.signers]
    );
    console.log("✅ Pool created:", poolSig);

    const [escrow] = sdk.getEscrowPda(clmmLaunchState);
    const escrowBalanceBefore = client.getBalance(escrow);
    console.log(`Escrow balance before liquidity: ${Number(escrowBalanceBefore) / anchor.web3.LAMPORTS_PER_SOL} SOL`);

    const addLiquidityResultTx = await sdk.addClmmLiquidityTx({
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
    const liquiditySig = await safeSendAndConfirm(
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


    console.log("✅ CLMM Pool and Liquidity created successfully!");
    console.log("Pool Signature:", poolSig);
    console.log("Liquidity Signature:", liquiditySig);
    console.log("Base Mint:", createPoolResultTx.baseMint.toString());
    console.log("Base Token ATA:", createPoolResultTx.baseTokenAta.toString());

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
        const nftAccount = unpackAccount(positionNftAta, { ...(nftAtaInfo as any), data: Buffer.from(nftAtaInfo.data) } as any);
        console.log("Position NFT owner:", nftAccount.owner.toString());
        assert.ok(nftAccount.owner.equals(escrowAuthority), "Position NFT owned by escrow_authority");
        console.log("✅ Position NFT owned by escrow_authority");
      }
    }

    assert.ok(createPoolResultTx.baseMint, "Should return base mint");
    assert.ok(createPoolResultTx.baseTokenAta, "Should return base token ATA");
    assert.ok(poolStateAccount, "Pool state should exist");
    assert.ok(Number(quoteVaultBalance) > 0, "Quote vault should have SOL");
    assert.ok(baseVaultAccount, "Base vault should exist");
  });
});


describe("Full flow", () => {
  let client: LiteSVM;
  let provider: LiteSVMProvider;
  let program: Program<Engine>;
  let admin: anchor.Wallet;
  let sdk: any;
  let adminKeypair: anchor.web3.Keypair;

  const MIN_RAISE_LAMPORTS = new anchor.BN(10 * anchor.web3.LAMPORTS_PER_SOL);
  const PER_WALLET_CAP = new anchor.BN(5 * anchor.web3.LAMPORTS_PER_SOL);
  const TAU_LAMPORTS = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);
  const SALE_ALLOCATION = new anchor.BN(1000000);
  const LP_ALLOCATION = new anchor.BN(500000);
  const ROSTER_SHARD_CAP = 100;

  before(async () => {
    client = fromWorkspace("./");
    provider = new LiteSVMProvider(client);
    anchor.setProvider(provider);
    program = anchor.workspace.engine as Program<Engine>;
    admin = provider.wallet;
    adminKeypair = (provider.wallet as any).payer;
    sdk = EngineSDK.create(provider as any, program as any, adminKeypair);
    sdk = EngineSDK.create(provider, program);
  });


  it("Complete flow with creator deposit: Full lifecycle including creator token claiming", async () => {
    // Check admin balance and adjust creator deposit accordingly
    const adminBalance = client.getBalance(admin.publicKey);
    const availableForDeposit = adminBalance - BigInt(anchor.web3.LAMPORTS_PER_SOL) / BigInt(2); // Reserve 0.5 SOL for fees
    let creatorDepositAmount = new anchor.BN(0);
    if (availableForDeposit > BigInt(0)) {
      const remainder = new anchor.BN(Number(availableForDeposit)).mod(TAU_LAMPORTS);
      creatorDepositAmount = new anchor.BN(Number(availableForDeposit)).sub(remainder);
    }

    const testSaleMint = anchor.web3.Keypair.generate();
    const [testLaunchState] = sdk.getLaunchPda(testSaleMint.publicKey);
    const [mintAuth] = sdk.getMintAuthPda(testLaunchState);

    const testHardCap = new anchor.BN(4 * anchor.web3.LAMPORTS_PER_SOL);
    const testMinRaise = new anchor.BN(2 * anchor.web3.LAMPORTS_PER_SOL);
    const testPerWalletCap = new anchor.BN(5 * anchor.web3.LAMPORTS_PER_SOL);
    const testTau = new anchor.BN(2 * anchor.web3.LAMPORTS_PER_SOL);
    const dailyLimit = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);

    console.log("=== Initializing Launch with Creator Deposit ===");
    // Initialize launch with creator deposit
    await sdk.initLaunch({
      saleMint: testSaleMint.publicKey,
      hardCapLamports: testHardCap,
      minRaiseLamports: testMinRaise,
      perWalletCap: testPerWalletCap,
      tauLamports: testTau,
      saleAllocation: SALE_ALLOCATION,
      lpAllocation: LP_ALLOCATION,
      fundingDurationSeconds: new anchor.BN(11),
      numBlocks: 1000,
      rosterShardCap: ROSTER_SHARD_CAP,
      creatorInitialDepositLamports: creatorDepositAmount,
      creatorDailyLamportsLimit: dailyLimit,
      creatorClaimLockPeriodSec: new anchor.BN(2),
      creator: adminKeypair,
      preInstructions: [
        anchor.web3.SystemProgram.createAccount({
          fromPubkey: admin.publicKey,
          newAccountPubkey: testSaleMint.publicKey,
          space: 82,
          lamports: 2039280, // Fixed rent exemption for 82 bytes
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
          testSaleMint.publicKey,
          6,
          mintAuth,
          admin.publicKey
        ),
      ],
      signers: [adminKeypair, testSaleMint],
    });

    // Verify creator grant was initialized
    const creatorGrantState = await sdk.fetchCreatorGrant(testLaunchState);
    assert.equal(creatorGrantState.lockedLamports.toNumber(), creatorDepositAmount.toNumber());
    assert.equal(creatorGrantState.reservedTickets, 0);
    console.log(`Creator grant initialized: ${creatorGrantState.reservedTickets} reserved tickets`);

    console.log("=== Initializing Roster ===");
    const { rosterPda } = await sdk.initRoster({
      launch: testLaunchState,
      payerKeypair: adminKeypair,
    });
    const [rosterShard] = sdk.getRosterShardPda(testLaunchState, 0);
    const initRosterShardTx = await program.methods
      .initRosterShard(0)
      .accounts({
        payer: admin.publicKey,
        launchState: testLaunchState,
        rosterShard,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .transaction();
    await provider.sendAndConfirm(initRosterShardTx, [admin.payer]);

    console.log("=== Simulating User Deposits ===");
    // Simulate multiple users depositing beyond hard cap
    const users = [];
    const depositAmount = new anchor.BN(4 * anchor.web3.LAMPORTS_PER_SOL);

    for (let i = 0; i < 1; i++) {
      const user = await createAndFundAccount(client, 20);

      await program.methods
        .deposit(depositAmount)
        .accounts({
          user: user.publicKey,
          launchState: testLaunchState,
          userContribution: sdk.getUserContributionPda(
            testLaunchState,
            user.publicKey
          )[0],
        rosterShard,
          escrowAuthority: sdk.getEscrowAuthorityPda(testLaunchState)[0],
          launch: testLaunchState,
          systemProgram: anchor.web3.SystemProgram.programId,
        } as any)
        .signers([user])
        .rpc();

      users.push({
        keypair: user,
        contribution: sdk.getUserContributionPda(
          testLaunchState,
          user.publicKey
        )[0],
      });
    }

    let state = await sdk.fetchLaunch(testLaunchState);
    assert.isAtLeast(state.totalDeposited.toNumber(), testHardCap.toNumber());
    console.log(
      `Total deposited: ${state.totalDeposited.toNumber() / anchor.web3.LAMPORTS_PER_SOL
      } SOL (Hard cap: ${testHardCap.toNumber() / anchor.web3.LAMPORTS_PER_SOL} SOL)`
    );

    const escrowAuthorityBeforeLiquidity = client.getBalance(sdk.getEscrowAuthorityPda(testLaunchState)[0]);
    console.log("=== Waiting for Funding Period to End ===");
    // Wait for funding period to end
    await advanceTime(client, { slots: BigInt(1000), seconds: BigInt(15) });

    console.log("=== Setting VRF Seed ===");
    // Set VRF seed (no SelectionState account now)
    await sdk.setSeed({ launch: testLaunchState });

    console.log("=== Finalizing Shard ===");
    await sdk.finalizeRosterShard({ launch: testLaunchState, shardId: 0 });
    console.log("=== Creating Pool (finalizes selection and opens claims) ===");
    // Inject SlotHashes sysvar with a valid blockhash for this project's range (mirrors raydium test)
    {
      const SLOT_HASHES_SYSVAR = new anchor.web3.PublicKey(
        "SysvarS1otHashes111111111111111111111111111"
      );
      // Use latest launch state to compute personal range
      state = await sdk.fetchLaunch(testLaunchState);
      const projectId = state.projectId.toNumber();
      const numBlocks = state.numBlocks.toNumber();
      const width = ((BigInt(1) << BigInt(256)) - BigInt(1)) / BigInt(numBlocks);
      const rangeStart = width * BigInt(projectId - 1);
      const rangeEnd = rangeStart + width; // exclusive upper bound

      function bigIntTo32BytesBE(x: bigint): Buffer {
        const buf = Buffer.alloc(32);
        let v = x;
        for (let i = 31; i >= 0; i--) {
          buf[i] = Number(v & BigInt(255));
          v = v >> BigInt(8);
        }
        return buf;
      }

      const currentClock = client.getClock();
      const numHashes = 512;
      const slotHashesData = Buffer.alloc(8 + numHashes * 40);
      slotHashesData.writeBigUInt64LE(BigInt(numHashes), 0);
      for (let i = 0; i < numHashes; i++) {
        const offset = 8 + i * 40;
        slotHashesData.writeBigUInt64LE(currentClock.slot + BigInt(i + 1), offset);
        if (i === numHashes - 1) {
          bigIntTo32BytesBE(rangeStart).copy(slotHashesData, offset + 8);
        } else {
          bigIntTo32BytesBE(rangeEnd).copy(slotHashesData, offset + 8);
        }
      }

      client.setAccount(SLOT_HASHES_SYSVAR, {
        lamports: 1_000_000,
        data: slotHashesData,
        owner: anchor.web3.SystemProgram.programId,
        executable: false,
      });
    }
    await sdk.createPool({ launch: testLaunchState });

    // Create Raydium CLMM pool and add liquidity to open claims and initialize escrow ATA
    const { raydiumProgramId, ammConfig: raydiumAmmConfig } = await setupRaydiumCLMM(client);
    const WSOL_MINT = new anchor.web3.PublicKey("So11111111111111111111111111111111111111112");

    const clmmCreate = await sdk.createClmmPoolTx({
      payer: admin.publicKey,
      launch: testLaunchState,
      quoteMint: WSOL_MINT,
      baseMint: testSaleMint, // unused by SDK, saleMint is taken from launch
      ammConfig: raydiumAmmConfig,
      clmmProgram: raydiumProgramId,
      provider,
    });
    await provider.sendAndConfirm(clmmCreate.transaction, [admin.payer, ...clmmCreate.signers]);

    const clmmAddLiq = await sdk.addClmmLiquidityTx({
      payer: admin.publicKey,
      launch: testLaunchState,
      quoteMint: WSOL_MINT,
      baseMint: testSaleMint.publicKey,
      baseTokenAta: clmmCreate.baseTokenAta,
      ammConfig: raydiumAmmConfig,
      clmmProgram: raydiumProgramId,
      provider,
    });
    await provider.sendAndConfirm(clmmAddLiq.transaction, [admin.payer, ...clmmAddLiq.signers]);

    // Verify tokens_per_ticket set after createPool later

    console.log("=== Testing Creator Token Claiming ===");
    // Test creator token claiming (only if creator deposit > 0)
    if (creatorDepositAmount.toNumber() > 0) {
      const creatorAta = sdk.getUserAta(testSaleMint.publicKey, admin.publicKey);

      // Create creator ATA first
      const createAtaIx = sdk.buildCreateAtaIx({
        payer: admin.publicKey,
        owner: admin.publicKey,
        mint: testSaleMint.publicKey,
      }).ix;

      await provider.sendAndConfirm(new anchor.web3.Transaction().add(createAtaIx), []);

    const claimResult = await sdk.claimCreatorTokens({
        launch: testLaunchState,
        saleMint: testSaleMint.publicKey,
        creatorAta: creatorAta,
        createAtaIfMissing: false,
      });

      console.log("Creator tokens claimed. Signature:", claimResult.signature);

      // Verify creator grant state after claiming
      const creatorGrantAfterClaim = await sdk.fetchCreatorGrant(testLaunchState);
      const expectedFirstDayTickets = Math.floor(dailyLimit.toNumber() / testTau.toNumber());
      assert.equal(creatorGrantAfterClaim.claimedTickets, expectedFirstDayTickets);

      // Verify creator token balance
      const tokenAccountInfo = client.getAccount(creatorAta);
      const tokenAccount = unpackAccount(creatorAta, { ...(tokenAccountInfo as any), data: Buffer.from(tokenAccountInfo.data) } as any);
      const expectedTokens = Math.floor((state.tokensPerTicket * expectedFirstDayTickets) / 1_000_000);
      assert.equal(Number(tokenAccount.amount), expectedTokens);

      console.log(`Creator claimed ${expectedFirstDayTickets} tickets worth ${expectedTokens} tokens`);
    } else {
      console.log("Skipping creator token claiming - no creator deposit");
    }

    console.log("=== Testing Creator Deposit Fix ===");
    const escrowAuthorityBalance = escrowAuthorityBeforeLiquidity;
    console.log(`Main launch escrow_authority balance: ${Number(escrowAuthorityBalance) / anchor.web3.LAMPORTS_PER_SOL} SOL`);
    console.log(`Creator deposit amount: ${creatorDepositAmount.toNumber() / anchor.web3.LAMPORTS_PER_SOL} SOL`);

    const userDeposits = testHardCap;
    const expectedMinBalance = creatorDepositAmount.add(userDeposits);

    assert.isTrue(Number(escrowAuthorityBalance) >= expectedMinBalance.toNumber());
    console.log(`Escrow authority balance ${Number(escrowAuthorityBalance) / anchor.web3.LAMPORTS_PER_SOL} SOL >= expected minimum ${expectedMinBalance.toNumber() / anchor.web3.LAMPORTS_PER_SOL} SOL before liquidity move`);

    if (creatorDepositAmount.toNumber() > 0) {
      console.log("Creator deposit fix verified: escrow contains creator's initial deposit");
    } else {
      console.log("Creator deposit fix verified: escrow contains user deposits only (no creator deposit)");
    }

    console.log("=== Testing User Refund and Token Claiming ===");
    // Test regular user refund and token claiming
    const testUser = users[0];
    const userInitialBalance = client.getBalance(testUser.keypair.publicKey);

    // User claims refund
    const claimRefundTx = await program.methods
      .claimRefund()
      .accounts({
        user: testUser.keypair.publicKey,
        launchState: testLaunchState,
        userContribution: testUser.contribution,
        rosterShard,
        escrowAuthority: sdk.getEscrowAuthorityPda(testLaunchState)[0],
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .signers([testUser.keypair])
      .transaction();

    // Add compute budget instruction to increase compute units
    const computeBudgetIx = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({
      units: 3_000_000,
    });
    claimRefundTx.instructions.unshift(computeBudgetIx);

    await provider.sendAndConfirm(claimRefundTx, [testUser.keypair]);

    const userFinalBalance = client.getBalance(testUser.keypair.publicKey);
    const userAccountAfter = await sdk.fetchUserContribution(
      testLaunchState,
      testUser.keypair.publicKey
    );

    assert.isTrue(userAccountAfter.claimedRefund);
    console.log(
      `User refund claimed. Balance change: ${(Number(userFinalBalance) - Number(userInitialBalance)) /
      anchor.web3.LAMPORTS_PER_SOL
      } SOL`
    );

    // User claims tokens (after pool created in this flow)
    const userAta = sdk.getUserAta(
      testSaleMint.publicKey,
      testUser.keypair.publicKey
    );
      const claimTokensTx = await (program.methods as any)
      .claimTokens()
      .preInstructions([
        sdk.buildCreateAtaIx({
          payer: admin.publicKey,
          owner: testUser.keypair.publicKey,
          mint: testSaleMint.publicKey,
        }).ix,
      ])
      .accounts({
        user: testUser.keypair.publicKey,
        launchState: testLaunchState,
        userContribution: testUser.contribution,
        rosterShard,
        saleMint: testSaleMint.publicKey,
        escrowAuthority: sdk.getEscrowAuthorityPda(testLaunchState)[0],
        baseEscrowAta: sdk.getUserAta(testSaleMint.publicKey, sdk.getEscrowAuthorityPda(testLaunchState)[0]),
        userAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .remainingAccounts([
        { pubkey: sdk.getPoolPda(testLaunchState)[0], isSigner: false, isWritable: false }
      ])
      .signers([testUser.keypair])
      .transaction();

    const computeBudgetIx2 = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({
      units: 3_000_000,
    });
    claimTokensTx.instructions.unshift(computeBudgetIx2);

    await provider.sendAndConfirm(claimTokensTx, [testUser.keypair]);

    const userTokenAccountInfo = client.getAccount(userAta);
    const userTokenAccount = unpackAccount(userAta, { ...(userTokenAccountInfo as any), data: Buffer.from(userTokenAccountInfo.data) } as any);
    const userAccountFinal = await sdk.fetchUserContribution(
      testLaunchState,
      testUser.keypair.publicKey
    );

    assert.isTrue(userAccountFinal.claimedTokens);
    console.log(
      `User tokens claimed. Token balance: ${Number(userTokenAccount.amount) / 1_000_000
      }`
    );

    console.log("=== Testing Creator Grant State ===");

    const finalCreatorGrant = await sdk.fetchCreatorGrant(testLaunchState);
    console.log(`Final creator grant state:`);
    console.log(`  - Reserved tickets: ${finalCreatorGrant.reservedTickets}`);
    console.log(`  - Claimed tickets: ${finalCreatorGrant.claimedTickets}`);
    console.log(`  - Daily ticket cap: ${finalCreatorGrant.dailyTicketCap}`);
    console.log(`  - Refunded: ${finalCreatorGrant.refunded}`);

    if (creatorDepositAmount.toNumber() > 0) {
      assert.equal(finalCreatorGrant.claimedTickets, 2);
    } else {
      assert.equal(finalCreatorGrant.claimedTickets, 0);
    }
    assert.isFalse(finalCreatorGrant.refunded);

    console.log(
      "✅ Complete flow with creator deposit test passed! All functions tested successfully."
    );
  });
});
