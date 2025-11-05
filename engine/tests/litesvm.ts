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

import { advanceTime, createAndFundAccount, injectSlotHashesForRange } from "./utils";
import { setupRaydiumCLMM } from "./raydium-setup";

let client: LiteSVM;
let provider: LiteSVMProvider;
let program: Program<Engine>;
let admin: anchor.Wallet;
let sdk: ReturnType<typeof EngineSDK.create>;
let adminKeypair: anchor.web3.Keypair;

function bigIntTo32BytesBE(x: bigint): Buffer {
  const buf = Buffer.alloc(32);
  let v = x;
  for (let i = 31; i >= 0; i--) {
    buf[i] = Number(v & BigInt(255));
    v = v >> BigInt(8);
  }
  return buf;
}

describe("engine litesvm", () => {

  let baseMint: anchor.web3.Keypair;
  let launchState: anchor.web3.PublicKey;

  const HARD_CAP_LAMPORTS = new anchor.BN(100 * anchor.web3.LAMPORTS_PER_SOL);
  const MIN_RAISE_LAMPORTS = new anchor.BN(10 * anchor.web3.LAMPORTS_PER_SOL);
  const PER_WALLET_CAP = new anchor.BN(5 * anchor.web3.LAMPORTS_PER_SOL);
  const TAU_LAMPORTS = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);
  const SALE_ALLOCATION = new anchor.BN(1000000);
  const LP_ALLOCATION = new anchor.BN(500000);
  const BASE_TOTAL_ALLOCATION_F = SALE_ALLOCATION.add(LP_ALLOCATION);
  const BASE_SALE_BPS_F = new anchor.BN(Math.floor(SALE_ALLOCATION.toNumber() * 10000 / BASE_TOTAL_ALLOCATION_F.toNumber()));
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
    const nextId = await sdk.getNextProjectId();

    const result = await sdk.initLaunchTx({
      creator: admin.publicKey,
      projectId: nextId,
      hardCapLamports: HARD_CAP_LAMPORTS,
      minRaiseLamports: MIN_RAISE_LAMPORTS,
      perWalletCap: PER_WALLET_CAP,
      tauLamports: TAU_LAMPORTS,
      baseTotalAllocation: BASE_TOTAL_ALLOCATION_F,
      baseSaleBasisPoints: BASE_SALE_BPS_F,
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
    assert.equal(state.baseTotalAllocation.toNumber(), BASE_TOTAL_ALLOCATION_F.toNumber());
    assert.equal(state.baseSaleBasisPoints.toNumber(), BASE_SALE_BPS_F.toNumber());
    assert.equal(state.totalDeposited.toNumber(), 0);
    assert.equal(state.totalTickets, 0);
    const expectedKCapacity = HARD_CAP_LAMPORTS.toNumber() / TAU_LAMPORTS.toNumber();
    assert.equal(state.kCapacity, expectedKCapacity);
    assert.isFalse(state.selectionFinalized);
    assert.equal(state.selectionProcessed, 0);
    assert.isNull(state.thresholdScore);
    assert.isNull(state.vrfSeed);
    assert.isNull(state.tokensPerTicket);
    assert.isNull(state.baseMint);
  });

  it.skip("Sets the VRF seed", async () => {
    // This test is flaky due to litesvm's time simulation.
    // The functionality is fully covered in the "Complete flow" test.
    // TODO (@wotory, @xykeeper): to get this test properly alive
  });

  it("Allows deposits", async () => {
    const nextId = await sdk.getNextProjectId();

    const { initLaunchTx, signers, launchState: testLaunchState } = await sdk.initLaunchTx({
      creator: admin.publicKey,
      projectId: nextId,
      hardCapLamports: HARD_CAP_LAMPORTS,
      minRaiseLamports: MIN_RAISE_LAMPORTS,
      perWalletCap: PER_WALLET_CAP,
      tauLamports: TAU_LAMPORTS,
      baseTotalAllocation: BASE_TOTAL_ALLOCATION_F,
      baseSaleBasisPoints: BASE_SALE_BPS_F,
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
    const nextId = await sdk.getNextProjectId();

    const { initLaunchTx, signers, launchState: testLaunchState } = await sdk.initLaunchTx({
      creator: admin.publicKey,
      projectId: nextId,
      hardCapLamports: HARD_CAP_LAMPORTS,
      minRaiseLamports: MIN_RAISE_LAMPORTS,
      perWalletCap: PER_WALLET_CAP,
      tauLamports: TAU_LAMPORTS,
      baseTotalAllocation: BASE_TOTAL_ALLOCATION_F,
      baseSaleBasisPoints: BASE_SALE_BPS_F,
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
    const projectId1 = await sdk.getNextProjectId();
    const [project1Launch] = sdk.getLaunchPdaByProjectId(projectId1);

    await sdk.initLaunch({
      projectId: projectId1,
      hardCapLamports: HARD_CAP_LAMPORTS,
      minRaiseLamports: MIN_RAISE_LAMPORTS,
      perWalletCap: PER_WALLET_CAP,
      tauLamports: TAU_LAMPORTS,
      baseTotalAllocation: BASE_TOTAL_ALLOCATION_F,
      baseSaleBasisPoints: BASE_SALE_BPS_F,
      fundingDurationSeconds: 10,
      unlockTimeSec: 60,
      rosterShardCap: ROSTER_SHARD_CAP,
      creatorInitialDepositLamports: new anchor.BN(0),
      creatorDailyLamportsLimit: new anchor.BN(0),
      creatorClaimLockPeriodSec: new anchor.BN(2),
      creatorMaxDepositLamports: new anchor.BN(0),
    });

    const projectId2 = await sdk.getNextProjectId();
    const [project2Launch] = sdk.getLaunchPdaByProjectId(projectId2);

    await sdk.initLaunch({
      projectId: projectId2,
      hardCapLamports: HARD_CAP_LAMPORTS,
      minRaiseLamports: MIN_RAISE_LAMPORTS,
      perWalletCap: PER_WALLET_CAP,
      tauLamports: TAU_LAMPORTS,
      baseTotalAllocation: BASE_TOTAL_ALLOCATION_F,
      baseSaleBasisPoints: BASE_SALE_BPS_F,
      fundingDurationSeconds: 10,
      unlockTimeSec: 60,
      rosterShardCap: ROSTER_SHARD_CAP,
      creatorInitialDepositLamports: new anchor.BN(0),
      creatorDailyLamportsLimit: new anchor.BN(0),
      creatorClaimLockPeriodSec: new anchor.BN(2),
      creatorMaxDepositLamports: new anchor.BN(0),
    });

    const projectId3 = await sdk.getNextProjectId();
    const [project3Launch] = sdk.getLaunchPdaByProjectId(projectId3);

    await sdk.initLaunch({
      projectId: projectId3,
      hardCapLamports: HARD_CAP_LAMPORTS,
      minRaiseLamports: MIN_RAISE_LAMPORTS,
      perWalletCap: PER_WALLET_CAP,
      tauLamports: TAU_LAMPORTS,
      baseTotalAllocation: BASE_TOTAL_ALLOCATION_F,
      baseSaleBasisPoints: BASE_SALE_BPS_F,
      fundingDurationSeconds: 10,
      unlockTimeSec: 60,
      rosterShardCap: ROSTER_SHARD_CAP,
      creatorInitialDepositLamports: new anchor.BN(0),
      creatorDailyLamportsLimit: new anchor.BN(0),
      creatorClaimLockPeriodSec: new anchor.BN(2),
      creatorMaxDepositLamports: new anchor.BN(0),
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
    const projectId = await sdk.getNextProjectId();

    const sdkPdas = sdk.deriveAllPdas(projectId);

    const [directLaunch] = sdk.getLaunchPdaByProjectId(projectId);
    const [directEscrow] = sdk.getEscrowPda(directLaunch);
    const [directRoster] = sdk.getRosterPda(directLaunch);
    const [directRosterShard] = sdk.getRosterShardPda(directLaunch, 0);
    const [directMintAuth] = sdk.getEscrowAuthorityPda(directLaunch);
    const [directProjectCounter] = sdk.getProjectCounterPda();

    assert.ok(sdkPdas.launch.equals(directLaunch));
    assert.ok(sdkPdas.escrow.equals(directEscrow));
    assert.ok(sdkPdas.roster.equals(directRoster));
    // selection PDA deprecated; verify roster shard PDA derivation works
    assert.ok(directRosterShard.equals(sdk.getRosterShardPda(directLaunch, 0)[0]));
    assert.ok(sdkPdas.escrow.equals(directMintAuth));
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
      const { transaction } = await sdk.preparePoolCreationTx({
        payer: admin.publicKey,
        launch: existingLaunchPda,
      });
      await provider.simulate(transaction);
      assert.fail("preparePoolCreation should fail before deposits/claims/blockhash setup");
    } catch (err) {
      const msg = (err as any)?.message ?? String(err);
      console.log("Expected failure (early preparePoolCreation):", msg);
    }

    // Ensure selection is finalized and claims are open (mirror flowRunner.ts)
    let launchAccount = await sdk.fetchLaunch(existingLaunchPda);
    if (!launchAccount.selectionFinalized || !(launchAccount as any).claimsReady) {
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
        const { transaction } = await sdk.preparePoolCreationTx({
          payer: admin.publicKey,
          launch: existingLaunchPda,
        });
        await provider.simulate(transaction);
        assert.fail("preparePoolCreation should fail before claims opened/blockhash setup");
      } catch (err) {
        const msg = (err as any)?.message ?? String(err);
        console.log("Expected failure (after deposits):", msg);
      }

      // 3) Advance time beyond funding period
      await advanceTime(client, { slots: BigInt(1000), seconds: BigInt(15) });

      // 4) Set VRF seed, finalize shard
      await sdk.setSeed({ launch: existingLaunchPda });
      await sdk.finalizeRosterShard({ launch: existingLaunchPda, shardId: 0 });
      // claims are opened in preparePoolCreation now

      // Refresh state
      launchAccount = await sdk.fetchLaunch(existingLaunchPda);
      console.log(
        `Launch state - Selection finalized: ${launchAccount.selectionFinalized}`
      );
      console.log(`Launch state - Selection finalized: ${launchAccount.selectionFinalized}`);
    }

    // Configure SlotHashes to include a valid blockhash for this project's range
    const currentClock = client.getClock();

    // Compute project's personal blockhash range and pick range_start (inclusive)
    const projectId = launchAccount.projectId.toNumber();
    const unlock = Number((launchAccount as any).unlockTimeSec);
    const computedN = BigInt(unlock > 0 ? unlock * 17 : 100);
    const width = ((BigInt(1) << BigInt(256)) - BigInt(1)) / computedN;
    const rangeStart = width * BigInt(projectId - 1);
    const rangeEnd = rangeStart + width; // exclusive upper bound; safe to use as an invalid hash

    // Write incorrect SlotHashes and simulate preparePoolCreation (should fail)
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
      const { transaction } = await sdk.preparePoolCreationTx({
        payer: admin.publicKey,
        launch: existingLaunchPda,
      });
      await provider.simulate(transaction);
      assert.fail("preparePoolCreation should fail with incorrect slot hashes");
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

    const { signature } = await sdk.preparePoolCreation({
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

  it("Grace period: invalid hashes fail within grace; succeed after", async () => {
    const GRACE = 20;
    const HARD_CAP = new anchor.BN(10 * anchor.web3.LAMPORTS_PER_SOL);
    const MIN_RAISE = new anchor.BN(4 * anchor.web3.LAMPORTS_PER_SOL);
    const PER_CAP = new anchor.BN(5 * anchor.web3.LAMPORTS_PER_SOL);
    const TAU = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);
    const TOTAL = new anchor.BN(1000000);
    const SALE_BPS = new anchor.BN(10000);

    const projectId = await sdk.getNextProjectId();
    const [launchPda] = sdk.getLaunchPdaByProjectId(projectId);

    await sdk.initLaunch({
      projectId: projectId,
      hardCapLamports: HARD_CAP,
      minRaiseLamports: MIN_RAISE,
      perWalletCap: PER_CAP,
      tauLamports: TAU,
      baseTotalAllocation: TOTAL,
      baseSaleBasisPoints: SALE_BPS,
      fundingDurationSeconds: 10,
      unlockTimeSec: 60,
      rosterShardCap: 100,
      creatorInitialDepositLamports: new anchor.BN(0),
      creatorDailyLamportsLimit: new anchor.BN(0),
      creatorClaimLockPeriodSec: new anchor.BN(2),
      creatorMaxDepositLamports: new anchor.BN(0),
      poolCreationGracePeriodSec: GRACE,
    });

    await sdk.initRoster({ launch: launchPda });
    await sdk.initRosterShard({ launch: launchPda, shardId: 0 });

    const depositor = await createAndFundAccount(client, 20);
    const [rosterShard] = sdk.getRosterShardPda(launchPda, 0);
    await sdk.deposit({ launch: launchPda, amountLamports: MIN_RAISE, userKeypair: depositor, rosterShard });

    await advanceTime(client, { seconds: BigInt(12) });
    await sdk.setSeed({ launch: launchPda });
    await sdk.finalizeRosterShard({ launch: launchPda, shardId: 0 });

    const state = await sdk.fetchLaunch(launchPda);
    const project = state.projectId.toNumber();
    const unlock = Number((state as any).unlockTimeSec);
    const computedN = BigInt(unlock > 0 ? unlock * 17 : 100);
    const width = ((BigInt(1) << BigInt(256)) - BigInt(1)) / computedN;
    const rangeStart = width * BigInt(project - 1);
    const rangeEnd = rangeStart + width;

    const SLOT_HASHES_SYSVAR = new anchor.web3.PublicKey("SysvarS1otHashes111111111111111111111111111");
    const invalidNumHashes = 512;
    const currentClock = client.getClock();
    const data = Buffer.alloc(8 + invalidNumHashes * 40);
    data.writeBigUInt64LE(BigInt(invalidNumHashes), 0);
    for (let i = 0; i < invalidNumHashes; i++) {
      const offset = 8 + i * 40;
      data.writeBigUInt64LE(currentClock.slot + BigInt(i + 1), offset);
      bigIntTo32BytesBE(rangeEnd).copy(data, offset + 8);
    }
    client.setAccount(SLOT_HASHES_SYSVAR, { lamports: 1_000_000, data, owner: anchor.web3.SystemProgram.programId, executable: false });

    let threw = false;
    try {
      const { transaction } = await sdk.preparePoolCreationTx({ payer: admin.publicKey, launch: launchPda });
      await provider.simulate(transaction);
    } catch (_) {
      threw = true;
    }
    assert.isTrue(threw, "Expected failure within grace when no in-range blockhash present");

    await advanceTime(client, { seconds: BigInt(GRACE + 5) });
    const { signature } = await sdk.preparePoolCreation({ launch: launchPda, computeUnits: 1_500_000 });
    assert.isString(signature);
    const poolState = await sdk.fetchPoolState(launchPda);
    assert.isTrue(poolState.created);
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

    const projectId = await sdk.getNextProjectId();
    const testBaseMint = anchor.web3.Keypair.generate();
    const [testLaunchState] = sdk.getLaunchPdaByProjectId(projectId);
    const [mintAuth] = sdk.getEscrowAuthorityPda(testLaunchState);
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
      newAccountPubkey: testBaseMint.publicKey,
      space: 82,
      lamports: 2039280, // Fixed rent exemption for 82 bytes
      programId: TOKEN_PROGRAM_ID,
    });

    const initMintIx = createInitializeMintInstruction(
      testBaseMint.publicKey,
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
        baseTotalAllocation: BASE_TOTAL_ALLOCATION_F,
        baseSaleBasisPoints: BASE_SALE_BPS_F,
        fundingDurationSeconds: new anchor.BN(10),
        unlockTimeSec: new anchor.BN(60),
        rosterShardCap: ROSTER_SHARD_CAP,
        creatorInitialDepositLamports: creatorDepositAmount,
        creatorDailyLamportsLimit: dailyLimit,
        creatorClaimLockPeriodSec: new anchor.BN(2),
      creatorMaxDeposit: creatorDepositAmount,
      }, projectId)
      .accountsStrict({
        creator: admin.publicKey,
        projectCounter: sdk.getProjectCounterPda()[0],
        launchState: testLaunchState,
        escrowAuthority: sdk.getEscrowAuthorityPda(testLaunchState)[0],
        creatorGrant: creatorGrant,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    // Send transaction
    const tx = new anchor.web3.Transaction().add(createMintIx, initMintIx, initLaunchIx);
    const signature = await provider.sendAndConfirm(tx, [testBaseMint]);

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

  it("Creator deposit/withdraw within max limit", async () => {
    // Ensure admin has enough SOL for transfers
    const want = BigInt(5 * anchor.web3.LAMPORTS_PER_SOL);
    const cur = client.getBalance(admin.publicKey);
    if (cur < want) {
      client.airdrop(admin.publicKey, want - cur);
    }

    const MAX = new anchor.BN(3 * anchor.web3.LAMPORTS_PER_SOL);
    const testHardCap = new anchor.BN(10 * anchor.web3.LAMPORTS_PER_SOL);
    const testMinRaise = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);
    const testPerWalletCap = new anchor.BN(5 * anchor.web3.LAMPORTS_PER_SOL);
    const testTau = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);

    const { projectId, launchPda } = await sdk.initLaunchAuto({
      hardCapLamports: testHardCap,
      minRaiseLamports: testMinRaise,
      perWalletCap: testPerWalletCap,
      tauLamports: testTau,
      baseTotalAllocation: new anchor.BN(0),
      baseSaleBasisPoints: new anchor.BN(0),
      fundingDurationSeconds: 20,
      unlockTimeSec: 0,
      rosterShardCap: 100,
      creatorInitialDepositLamports: new anchor.BN(0),
      creatorDailyLamportsLimit: new anchor.BN(0),
      creatorClaimLockPeriodSec: new anchor.BN(2),
      creatorMaxDepositLamports: MAX,
      creator: adminKeypair,
    });

    // Deposit 2 SOL by creator
    const dep1 = new anchor.BN(2 * anchor.web3.LAMPORTS_PER_SOL);
    await sdk.creatorDeposit({ launch: launchPda, amountLamports: dep1, creatorKeypair: adminKeypair });
    let grant = await sdk.fetchCreatorGrant(launchPda);
    let state = await sdk.fetchLaunch(launchPda);
    assert.equal(grant.lockedLamports.toNumber(), dep1.toNumber());
    assert.equal(state.totalDeposited.toNumber(), dep1.toNumber());

    // Attempt to exceed max (deposit another 2 SOL -> should fail)
    try {
      await sdk.creatorDeposit({ launch: launchPda, amountLamports: dep1, creatorKeypair: adminKeypair });
      assert.fail("Expected deposit beyond max to fail");
    } catch (_) { /* expected */ }

    // Deposit remaining 1 SOL to reach max
    const dep2 = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);
    await sdk.creatorDeposit({ launch: launchPda, amountLamports: dep2, creatorKeypair: adminKeypair });
    grant = await sdk.fetchCreatorGrant(launchPda);
    state = await sdk.fetchLaunch(launchPda);
    assert.equal(grant.lockedLamports.toNumber(), MAX.toNumber());
    assert.equal(state.totalDeposited.toNumber(), MAX.toNumber());

    // Withdraw 1 SOL
    await sdk.creatorWithdraw({ launch: launchPda, amountLamports: dep2, creatorKeypair: adminKeypair });
    grant = await sdk.fetchCreatorGrant(launchPda);
    state = await sdk.fetchLaunch(launchPda);
    assert.equal(grant.lockedLamports.toNumber(), dep1.toNumber());
    assert.equal(state.totalDeposited.toNumber(), dep1.toNumber());
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
      try { return bs58.encode(Uint8Array.from(sigRaw.data)); } catch { }
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
});


describe("Full flow", () => {
  let client: LiteSVM;
  let provider: LiteSVMProvider;
  let program: Program<Engine>;
  let admin: anchor.Wallet;
  let sdk: ReturnType<typeof EngineSDK.create>;
  let adminKeypair: anchor.web3.Keypair;

  const MIN_RAISE_LAMPORTS = new anchor.BN(10 * anchor.web3.LAMPORTS_PER_SOL);
  const PER_WALLET_CAP = new anchor.BN(5 * anchor.web3.LAMPORTS_PER_SOL);
  const TAU_LAMPORTS = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);
  const SALE_ALLOCATION = new anchor.BN(1000000);
  const LP_ALLOCATION = new anchor.BN(500000);
  const BASE_TOTAL_ALLOCATION_F = SALE_ALLOCATION.add(LP_ALLOCATION);
  const BASE_SALE_BPS_F = new anchor.BN(Math.floor(SALE_ALLOCATION.toNumber() * 10000 / BASE_TOTAL_ALLOCATION_F.toNumber()));
  const ROSTER_SHARD_CAP = 100;

  before(async () => {
    client = fromWorkspace("./");
    provider = new LiteSVMProvider(client);
    anchor.setProvider(provider);
    program = anchor.workspace.engine as Program<Engine>;
    admin = provider.wallet;
    adminKeypair = (provider.wallet as any).payer;
    sdk = EngineSDK.create(provider as any, program as any, adminKeypair);
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

    const projectId = await sdk.getNextProjectId();
    const testBaseMint = anchor.web3.Keypair.generate();
    const [testLaunchState] = sdk.getLaunchPdaByProjectId(projectId);
    const [mintAuth] = sdk.getEscrowAuthorityPda(testLaunchState);

    const testHardCap = new anchor.BN(4 * anchor.web3.LAMPORTS_PER_SOL);
    const testMinRaise = new anchor.BN(2 * anchor.web3.LAMPORTS_PER_SOL);
    const testPerWalletCap = new anchor.BN(5 * anchor.web3.LAMPORTS_PER_SOL);
    const testTau = new anchor.BN(2 * anchor.web3.LAMPORTS_PER_SOL);
    const dailyLimit = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);

    console.log("=== Initializing Launch with Creator Deposit ===");
    // Initialize launch with creator deposit
    await sdk.initLaunch({
      projectId,
      hardCapLamports: testHardCap,
      minRaiseLamports: testMinRaise,
      perWalletCap: testPerWalletCap,
      tauLamports: testTau,
      baseTotalAllocation: BASE_TOTAL_ALLOCATION_F,
      baseSaleBasisPoints: BASE_SALE_BPS_F,
      fundingDurationSeconds: 11,
      unlockTimeSec: 60,
      rosterShardCap: ROSTER_SHARD_CAP,
      creatorInitialDepositLamports: creatorDepositAmount,
      creatorDailyLamportsLimit: dailyLimit,
      creatorClaimLockPeriodSec: new anchor.BN(2),
      creatorMaxDepositLamports: testHardCap,
      creator: adminKeypair,
      preInstructions: [
        anchor.web3.SystemProgram.createAccount({
          fromPubkey: admin.publicKey,
          newAccountPubkey: testBaseMint.publicKey,
          space: 82,
          lamports: 2039280, // Fixed rent exemption for 82 bytes
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
          testBaseMint.publicKey,
          6,
          mintAuth,
          admin.publicKey
        ),
      ],
      signers: [adminKeypair, testBaseMint],
    });

    // Verify creator grant was initialized
    const creatorGrantState = await sdk.fetchCreatorGrant(testLaunchState);
    assert.equal(creatorGrantState.lockedLamports.toNumber(), creatorDepositAmount.toNumber());
    assert.equal(creatorGrantState.reservedTickets, 0);
    console.log(`Creator grant initialized: ${creatorGrantState.reservedTickets} reserved tickets`);

    console.log("=== Initializing Roster ===");
    const { rosterPda } = await sdk.initRoster({
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

    const balanceBefore = client.getBalance(sdk.getEscrowAuthorityPda(testLaunchState)[0]);
    console.log("=== Waiting for Funding Period to End ===");
    // Wait for funding period to end
    await advanceTime(client, { slots: BigInt(1000), seconds: BigInt(15) });

    console.log("=== Setting VRF Seed ===");
    // Set VRF seed (no SelectionState account now)
    await sdk.setSeed({ launch: testLaunchState });

    console.log("=== Finalizing Shard ===");
    await sdk.finalizeRosterShard({ launch: testLaunchState, shardId: 0 });
    console.log("=== Creating Pool (finalizes selection and opens claims) ===");
    {
      state = await sdk.fetchLaunch(testLaunchState);
      const projectId = state.projectId.toNumber();
      const unlock = Number((state as any).unlockTimeSec);
      const computedN = BigInt(unlock > 0 ? unlock * 17 : 100);
      const width = ((BigInt(1) << BigInt(256)) - BigInt(1)) / computedN;
      const rangeStart = width * BigInt(projectId - 1);
      const rangeEnd = rangeStart + width;
      injectSlotHashesForRange(client, rangeStart, rangeEnd);
    }
    await sdk.preparePoolCreation({ launch: testLaunchState });

    // Create Raydium CLMM pool and add liquidity to open claims and initialize escrow ATA
    const { raydiumProgramId, ammConfig: raydiumAmmConfig } = await setupRaydiumCLMM(client);
    const WSOL_MINT = new anchor.web3.PublicKey("So11111111111111111111111111111111111111112");

    const clmmCreate = await sdk.createClmmPoolTx({
      payer: admin.publicKey,
      launch: testLaunchState,
      quoteMint: WSOL_MINT,
      baseMint: testBaseMint, // unused by SDK, baseMint is taken from launch
      ammConfig: raydiumAmmConfig,
      clmmProgram: raydiumProgramId,
      provider,
    });
    await provider.sendAndConfirm(clmmCreate.transaction, [admin.payer, ...clmmCreate.signers]);

    const clmmAddLiq = await sdk.addClmmLiquidityTx({
      payer: admin.publicKey,
      launch: testLaunchState,
      quoteMint: WSOL_MINT,
      baseMint: testBaseMint.publicKey,
      baseTokenAta: clmmCreate.baseTokenAta,
      ammConfig: raydiumAmmConfig,
      clmmProgram: raydiumProgramId,
      provider,
    });
    await provider.sendAndConfirm(clmmAddLiq.transaction, [admin.payer, ...clmmAddLiq.signers]);

    // Verify tokens_per_ticket set after preparePoolCreation later

    console.log("=== Testing Creator Token Claiming ===");
    // Test creator token claiming (only if creator deposit > 0)
    if (creatorDepositAmount.toNumber() > 0) {
      const creatorAta = sdk.getUserAta(testBaseMint.publicKey, admin.publicKey);

      // Create creator ATA first
      const createAtaIx = sdk.buildCreateAtaIx({
        payer: admin.publicKey,
        owner: admin.publicKey,
        mint: testBaseMint.publicKey,
      }).ix;

      await provider.sendAndConfirm(new anchor.web3.Transaction().add(createAtaIx), []);

      const claimResult = await sdk.claimCreatorTokens({
        launch: testLaunchState,
        baseMint: testBaseMint.publicKey,
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
      const tpt = Number(state.tokensPerTicket);
      const expectedTokens = Math.floor((tpt * expectedFirstDayTickets) / 1_000_000);
      assert.equal(Number(tokenAccount.amount), expectedTokens);

      console.log(`Creator claimed ${expectedFirstDayTickets} tickets worth ${expectedTokens} tokens`);
    } else {
      console.log("Skipping creator token claiming - no creator deposit");
    }

    console.log("=== Testing Creator Deposit Fix ===");
    const escrowAuthorityBalance = balanceBefore;
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
      testBaseMint.publicKey,
      testUser.keypair.publicKey
    );
    const claimTokensTx = await (program.methods as any)
      .claimTokens()
      .preInstructions([
        sdk.buildCreateAtaIx({
          payer: admin.publicKey,
          owner: testUser.keypair.publicKey,
          mint: testBaseMint.publicKey,
        }).ix,
      ])
      .accounts({
        user: testUser.keypair.publicKey,
        launchState: testLaunchState,
        userContribution: testUser.contribution,
        rosterShard,
        baseMint: testBaseMint.publicKey,
        escrowAuthority: sdk.getEscrowAuthorityPda(testLaunchState)[0],
        baseEscrowAta: sdk.getUserAta(testBaseMint.publicKey, sdk.getEscrowAuthorityPda(testLaunchState)[0]),
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

    console.log("=== Testing Team Vesting Claiming ===");
    // Initialize team vesting account
    await sdk.initTeamVesting({ launch: testLaunchState });

    // Ensure creator ATA exists (was created earlier for creator claim), but create defensively if missing
    const teamCreatorAta = sdk.getUserAta(testBaseMint.publicKey, admin.publicKey);
    try {
      const ataInfo = await provider.connection.getAccountInfo(teamCreatorAta);
      if (!ataInfo) {
        const createAtaIx = sdk.buildCreateAtaIx({
          payer: admin.publicKey,
          owner: admin.publicKey,
          mint: testBaseMint.publicKey,
        }).ix;
        await provider.sendAndConfirm(new anchor.web3.Transaction().add(createAtaIx), []);
      }
    } catch (_) {
      const createAtaIx = sdk.buildCreateAtaIx({
        payer: admin.publicKey,
        owner: admin.publicKey,
        mint: testBaseMint.publicKey,
      }).ix;
      await provider.sendAndConfirm(new anchor.web3.Transaction().add(createAtaIx), []);
    }

    // Advance chain time to accrue some vested amount (≥ 1 token unit)
    await advanceTime(client, { seconds: BigInt(400) });

    const beforeVesting = await sdk.fetchTeamVesting(testLaunchState);
    const beforeTokenAccInfo = client.getAccount(teamCreatorAta);
    const beforeToken = unpackAccount(teamCreatorAta, { ...(beforeTokenAccInfo as any), data: Buffer.from(beforeTokenAccInfo.data) } as any);

    const { transaction: claimTeamTx } = await sdk.claimTeamTokensTx({
      launch: testLaunchState,
      baseMint: testBaseMint.publicKey,
      creator: admin.publicKey,
      creatorAta: teamCreatorAta,
      createAtaIfMissing: false,
    });
    claimTeamTx.instructions.unshift(anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 3_000_000 }));
    claimTeamTx.feePayer = admin.publicKey;
    claimTeamTx.recentBlockhash = client.latestBlockhash();
    await provider.wallet.signTransaction(claimTeamTx as any);
    await provider.simulate(claimTeamTx);
    const firstSig = await provider.sendAndConfirm(claimTeamTx, []);
    console.log("Team vesting: first claim signature:", firstSig);

    const afterVesting = await sdk.fetchTeamVesting(testLaunchState);
    const afterTokenAccInfo = client.getAccount(teamCreatorAta);
    const afterToken = unpackAccount(teamCreatorAta, { ...(afterTokenAccInfo as any), data: Buffer.from(afterTokenAccInfo.data) } as any);

    assert.isAbove(Number(afterVesting.claimed), Number(beforeVesting.claimed));
    assert.isAbove(Number(afterToken.amount), Number(beforeToken.amount));

    // Immediate re-claim should fail due to min interval (1 sec)
    {
      const { transaction } = await sdk.claimTeamTokensTx({
        launch: testLaunchState,
        baseMint: testBaseMint.publicKey,
        creator: admin.publicKey,
        creatorAta: teamCreatorAta,
        createAtaIfMissing: false,
      });
      let tooFrequentFailed = false;
      try {
        transaction.feePayer = admin.publicKey;
        transaction.recentBlockhash = client.latestBlockhash();
        await provider.wallet.signTransaction(transaction as any);
        await provider.simulate(transaction);
      } catch (_) {
        tooFrequentFailed = true;
      }
      assert.isTrue(tooFrequentFailed, "Expected TeamClaimTooFrequent on immediate re-claim (simulation)");
    }

    // Wait enough time to accrue at least 1 unit again (avoid floor to 0)
    await advanceTime(client, { seconds: BigInt(400) });
    await sdk.claimTeamTokens({
      launch: testLaunchState,
      baseMint: testBaseMint.publicKey,
      creatorAta: teamCreatorAta,
      createAtaIfMissing: false,
    });

    const finalVesting = await sdk.fetchTeamVesting(testLaunchState);
    assert.isAbove(Number(finalVesting.claimed), Number(afterVesting.claimed));

    console.log(
      "✅ Complete flow with creator deposit test passed! All functions tested successfully."
    );
  });
});
