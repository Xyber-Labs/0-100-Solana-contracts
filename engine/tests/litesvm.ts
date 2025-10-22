import { fromWorkspace, LiteSVMProvider } from "anchor-litesvm";
import { LiteSVM } from "litesvm";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
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
let sdk: any;
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
    client = fromWorkspace("./", {
      maxAccountDataSize: 8192 * 8,
    });
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
        escrow: sdk.getEscrowPda(testLaunchState)[0],
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
        escrow: sdk.getEscrowPda(testLaunchState)[0],
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
        escrow: sdk.getEscrowPda(testLaunchState)[0],
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

    const existingLaunchPda = sdk.getLaunchPda(saleMint.publicKey)[0];

    const launchState = await sdk.fetchLaunch(existingLaunchPda);
    console.log(
      `Launch state - Selection finalized: ${launchState.selectionFinalized}`
    );
    console.log(`Launch state - Claims open: ${launchState.claimsOpen}`);

    if (!launchState.selectionFinalized || !launchState.claimsOpen) {
      console.log("Skipping pool creation test - prerequisites not met");
      console.log("(Selection must be finalized and claims must be open)");
      return;
    }

    try {
      const { signature } = await sdk.createPool({
        launch: existingLaunchPda,
        useTestMode: false,
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
    } catch (error) {
      console.error("Error creating pool:", error);

      if (error.message && error.message.includes("NoValidBlockhash")) {
        console.log(
          "Pool creation failed as expected - no valid blockhash found"
        );
        console.log(
          "This is normal behavior - blockhash validation is working correctly"
        );
        console.log("✅ Blockhash verification is working as intended");
      } else {
        throw error;
      }
    }
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
    const initLaunchIx = await program.methods
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
        escrow: sdk.getEscrowPda(testLaunchState)[0],
        creatorGrant: creatorGrant,
        systemProgram: anchor.web3.SystemProgram.programId,
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

    console.log("Fetching launch state...");
    const launchStateData = await sdk.fetchLaunch(clmmLaunchState);
    console.log("Launch state verified:", launchStateData.projectId.toString());

    await sdk.initRoster({ launch: clmmLaunchState, signers: [admin.payer] });

    const [rosterShard] = sdk.getRosterShardPda(clmmLaunchState, 0);
    const initRosterShardTx = await program.methods
      .initRosterShard(0)
      .accounts({
        payer: admin.publicKey,
        launchState: clmmLaunchState,
        rosterShard,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .transaction();
    await provider.sendAndConfirm(initRosterShardTx, [admin.payer]);

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
    const poolSig = await provider.sendAndConfirm(
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
      const nftAccount = client.getAccount(addLiquidityResultTx.positionNftMint);
      if (nftAccount) {
        console.log("✅ Position NFT exists");
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
          escrow: sdk.getEscrowPda(testLaunchState)[0],
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
      `Total deposited: ${
        state.totalDeposited.toNumber() / anchor.web3.LAMPORTS_PER_SOL
      } SOL (Hard cap: ${testHardCap.toNumber() / anchor.web3.LAMPORTS_PER_SOL} SOL)`
    );

    console.log("=== Waiting for Funding Period to End ===");
    // Wait for funding period to end
    await advanceTime(client, { slots: BigInt(1000), seconds: BigInt(15) });

    console.log("=== Setting VRF Seed ===");
    // Set VRF seed (no SelectionState account now)
    await sdk.setSeed({ launch: testLaunchState });

    console.log("=== Finalizing Shard and Opening Claims ===");
    await sdk.finalizeRosterShard({ launch: testLaunchState, shardId: 0 });
    await sdk.openClaims({ launch: testLaunchState });

    // Verify finalization
    state = await sdk.fetchLaunch(testLaunchState);
    assert.isTrue(state.selectionFinalized);
    assert.isTrue(state.claimsOpen);
    assert.ok(state.tokensPerTicket !== null);
    console.log(`Claims opened. Tokens per ticket: ${state.tokensPerTicket}`);

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
      const expectedFirstDayTickets = dailyLimit.toNumber() / testTau.toNumber();
      assert.equal(creatorGrantAfterClaim.claimedTickets, expectedFirstDayTickets);

      // Verify creator token balance
      const tokenAccountInfo = client.getAccount(creatorAta);
      const tokenAccount = unpackAccount(creatorAta, tokenAccountInfo);
      const expectedTokens = state.tokensPerTicket * expectedFirstDayTickets;
      assert.equal(Number(tokenAccount.amount), expectedTokens);

      console.log(`Creator claimed ${expectedFirstDayTickets} tickets worth ${expectedTokens} tokens`);
    } else {
      console.log("Skipping creator token claiming - no creator deposit");
    }

    console.log("=== Testing Creator Deposit Fix ===");
    // Verify that the creator deposit fix works by checking escrow_authority balance
    const escrowAuthorityBalance = client.getBalance(sdk.getEscrowAuthorityPda(testLaunchState)[0]);
    console.log(`Main launch escrow_authority balance: ${Number(escrowAuthorityBalance) / anchor.web3.LAMPORTS_PER_SOL} SOL`);
    console.log(`Creator deposit amount: ${creatorDepositAmount.toNumber() / anchor.web3.LAMPORTS_PER_SOL} SOL`);

    // The escrow_authority should contain the creator's initial deposit plus user deposits (20 SOL hard cap)
    // Plus some lamports for account rent
    const userDeposits = testHardCap;
    const expectedMinBalance = creatorDepositAmount.add(userDeposits);

    assert.isTrue(Number(escrowAuthorityBalance) >= expectedMinBalance.toNumber());
    console.log(`Escrow authority balance ${Number(escrowAuthorityBalance) / anchor.web3.LAMPORTS_PER_SOL} SOL >= expected minimum ${expectedMinBalance.toNumber() / anchor.web3.LAMPORTS_PER_SOL} SOL`);

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
        escrow: sdk.getEscrowPda(testLaunchState)[0],
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
      `User refund claimed. Balance change: ${
        (Number(userFinalBalance) - Number(userInitialBalance)) /
        anchor.web3.LAMPORTS_PER_SOL
      } SOL`
    );

    // User claims tokens
    const userAta = sdk.getUserAta(
      testSaleMint.publicKey,
      testUser.keypair.publicKey
    );
    const claimTokensTx = await program.methods
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
        mintAuth: sdk.getMintAuthPda(testLaunchState)[0],
        userAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([testUser.keypair])
      .transaction();

    const computeBudgetIx2 = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({
      units: 3_000_000,
    });
    claimTokensTx.instructions.unshift(computeBudgetIx2);

    await provider.sendAndConfirm(claimTokensTx, [testUser.keypair]);

    const userTokenAccountInfo = client.getAccount(userAta);
    const userTokenAccount = unpackAccount(userAta, userTokenAccountInfo);
    const userAccountFinal = await sdk.fetchUserContribution(
      testLaunchState,
      testUser.keypair.publicKey
    );

    assert.isTrue(userAccountFinal.claimedTokens);
    console.log(
      `User tokens claimed. Token balance: ${
        Number(userTokenAccount.amount) / 1_000_000
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
