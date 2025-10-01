import { startAnchor } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import * as anchor from "@coral-xyz/anchor";
import { assert } from "chai";
import { Program } from "@coral-xyz/anchor";
import { Engine } from "../target/types/engine";
import EngineSDK from "../ts-sdk/src/engine";
import {
  createInitializeMintInstruction,
  TOKEN_PROGRAM_ID,
  unpackAccount,
} from "@solana/spl-token";
import { advanceTime, createAndFundAccount } from "./utils";

describe("engine bankrun", () => {
  let context: any;
  let provider: BankrunProvider;
  let program: Program<Engine>;
  let admin: anchor.Wallet;
  let sdk: any;

  let saleMint: anchor.web3.Keypair;
  let launchState: anchor.web3.PublicKey;

  const HARD_CAP_LAMPORTS = new anchor.BN(100 * anchor.web3.LAMPORTS_PER_SOL);
  const MIN_RAISE_LAMPORTS = new anchor.BN(10 * anchor.web3.LAMPORTS_PER_SOL);
  const PER_WALLET_CAP = new anchor.BN(5 * anchor.web3.LAMPORTS_PER_SOL);
  const TAU_LAMPORTS = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);
  const SALE_ALLOCATION = new anchor.BN(1000000);
  const LP_ALLOCATION = new anchor.BN(500000);

  before(async () => {
    context = await startAnchor("./", [], []);
    provider = new BankrunProvider(context);
    anchor.setProvider(provider);
    program = anchor.workspace.engine as Program<Engine>;
    admin = provider.wallet;
    sdk = EngineSDK.create(provider, program);
  });

  it("Initializes the launch state correctly", async () => {
    saleMint = anchor.web3.Keypair.generate();

    const result = await sdk.initLaunchTx({
      admin: admin.publicKey,
      saleMint: saleMint,
      hardCapLamports: HARD_CAP_LAMPORTS,
      minRaiseLamports: MIN_RAISE_LAMPORTS,
      perWalletCap: PER_WALLET_CAP,
      tauLamports: TAU_LAMPORTS,
      saleAllocation: SALE_ALLOCATION,
      lpAllocation: LP_ALLOCATION,
      fundingDurationDays: 0,
      provider,
    });

    const initTx = await provider.sendAndConfirm(result.transaction, [admin.payer, ...result.signers]);
    console.log("Init launch tx signature:", initTx);

    launchState = result.launchState;
    const state = await sdk.fetchLaunch(launchState);

    assert.isTrue(state.projectId.toNumber() >= 0, "Project ID should be non-negative");
    assert.ok(state.admin.equals(admin.publicKey));
    assert.equal(state.hardCapLamports.toNumber(), HARD_CAP_LAMPORTS.toNumber());
    assert.equal(state.minRaiseLamports.toNumber(), MIN_RAISE_LAMPORTS.toNumber());
    assert.equal(state.perWalletCap.toNumber(), PER_WALLET_CAP.toNumber());
    assert.equal(state.tauLamports.toNumber(), TAU_LAMPORTS.toNumber());
    assert.equal(state.saleAllocation.toNumber(), SALE_ALLOCATION.toNumber());
    assert.equal(state.lpAllocation.toNumber(), LP_ALLOCATION.toNumber());
    assert.equal(state.totalDeposited.toNumber(), 0);
    assert.equal(state.totalTickets, 0);
    assert.equal(state.kCapacity, 0);
    assert.isFalse(state.selectionFinalized);
    assert.equal(state.selectionProcessed, 0);
    assert.isNull(state.thresholdScore);
    assert.isNull(state.vrfSeed);
    assert.isFalse(state.claimsOpen);
    assert.isNull(state.tokensPerTicket);
    assert.ok(state.saleMint.equals(saleMint.publicKey));
  });

  it("Sets the VRF seed", async () => {
    await sdk.initRoster({ launch: launchState, signers: [admin.payer] });

    const depositor = await createAndFundAccount(context, provider, 20);
    await sdk.deposit({ launch: launchState, amountLamports: PER_WALLET_CAP, userKeypair: depositor });

    const depositor2 = await createAndFundAccount(context, provider, 20);
    await sdk.deposit({ launch: launchState, amountLamports: PER_WALLET_CAP, userKeypair: depositor2 });

    await advanceTime(context, { slots: 10n, seconds: 10n });

    const { transaction: setSeedTx, selectionPda } = await sdk.setSeedTx({
      launch: launchState,
      admin: admin.publicKey,
    });

    const seedTx = await provider.sendAndConfirm(setSeedTx, [admin.payer]);
    console.log("Set VRF seed tx signature:", seedTx);

    const state = await sdk.fetchLaunch(launchState);
    assert.isNotNull(state.vrfSeed);
  });


  it("Allows deposits", async () => {
    const testSaleMint = anchor.web3.Keypair.generate();

    const { transaction, signers, launchState: testLaunchState } = await sdk.initLaunchTx({
      admin: admin.publicKey,
      saleMint: testSaleMint,
      hardCapLamports: HARD_CAP_LAMPORTS,
      minRaiseLamports: MIN_RAISE_LAMPORTS,
      perWalletCap: PER_WALLET_CAP,
      tauLamports: TAU_LAMPORTS,
      saleAllocation: SALE_ALLOCATION,
      lpAllocation: LP_ALLOCATION,
      fundingDurationDays: 0,
      provider,
    });

    await provider.sendAndConfirm(transaction, [admin.payer, ...signers]);


    await sdk.initRoster({ launch: testLaunchState, signers: [admin.payer] });

    const depositor = await createAndFundAccount(context, provider, 20);
    const depositAmount = new anchor.BN(2 * anchor.web3.LAMPORTS_PER_SOL);

    const { signature: depositTx } = await sdk.deposit({
      launch: testLaunchState,
      amountLamports: depositAmount,
      userKeypair: depositor,
    });
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

    const { transaction, signers, launchState: testLaunchState } = await sdk.initLaunchTx({
      admin: admin.publicKey,
      saleMint: testSaleMint,
      hardCapLamports: HARD_CAP_LAMPORTS,
      minRaiseLamports: MIN_RAISE_LAMPORTS,
      perWalletCap: PER_WALLET_CAP,
      tauLamports: TAU_LAMPORTS,
      saleAllocation: SALE_ALLOCATION,
      lpAllocation: LP_ALLOCATION,
      fundingDurationDays: 0,
      provider,
    });

    await provider.sendAndConfirm(transaction, [admin.payer, ...signers]);

    await sdk.initRoster({ launch: testLaunchState, signers: [admin.payer] });

    const depositor = await createAndFundAccount(context, provider, 20);
    const depositAmount = new anchor.BN(2 * anchor.web3.LAMPORTS_PER_SOL);

    await sdk.deposit({ launch: testLaunchState, amountLamports: depositAmount, userKeypair: depositor });

    const initialBalance = await context.banksClient.getBalance(depositor.publicKey);

    const { transaction: withdrawTx } = await sdk.withdrawTx({
      launch: testLaunchState,
      amountLamports: depositAmount,
      userPubkey: depositor.publicKey,
    });

    const withdrawSig = await provider.sendAndConfirm(withdrawTx, [depositor]);
    console.log("Withdraw tx signature:", withdrawSig);

    const finalBalance = await context.banksClient.getBalance(depositor.publicKey);

    assert.isAbove(Number(finalBalance), Number(initialBalance));

    const state = await sdk.fetchLaunch(testLaunchState);
    assert.equal(state.totalDeposited.toNumber(), 0);

    const userContrib = await sdk.fetchUserContribution(testLaunchState, depositor.publicKey);
    assert.equal(userContrib.deposited.toNumber(), 0);
  });

  it("Complete flow: Multiple users deposit beyond hard cap, cranking selects winners", async () => {
    const testSaleMint = anchor.web3.Keypair.generate();
    const [testLaunchState] = sdk.getLaunchPda(testSaleMint.publicKey);
    const [mintAuth] = sdk.getMintAuthPda(testLaunchState);

    const testHardCap = new anchor.BN(20 * anchor.web3.LAMPORTS_PER_SOL);
    const testMinRaise = new anchor.BN(5 * anchor.web3.LAMPORTS_PER_SOL);
    const testPerWalletCap = new anchor.BN(3 * anchor.web3.LAMPORTS_PER_SOL);
    const testTau = new anchor.BN(0.5 * anchor.web3.LAMPORTS_PER_SOL);

    await sdk.initLaunch({
      saleMint: testSaleMint.publicKey,
      hardCapLamports: testHardCap,
      minRaiseLamports: testMinRaise,
      perWalletCap: testPerWalletCap,
      tauLamports: testTau,
      saleAllocation: SALE_ALLOCATION,
      lpAllocation: LP_ALLOCATION,
      fundingDurationDays: 0,
      preInstructions: [
        anchor.web3.SystemProgram.createAccount({
          fromPubkey: admin.publicKey,
          newAccountPubkey: testSaleMint.publicKey,
          space: 82,
          lamports: await provider.connection.getMinimumBalanceForRentExemption(82),
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
          testSaleMint.publicKey,
          6,
          mintAuth,
          admin.publicKey
        ),
      ],
      signers: [testSaleMint],
    });

    const { rosterPda } = await sdk.initRoster({ launch: testLaunchState, signers: [admin.payer] });

    const users = [];
    const depositAmount = new anchor.BN(2 * anchor.web3.LAMPORTS_PER_SOL);

    for (let i = 0; i < 15; i++) {
      const user = await createAndFundAccount(context, provider, 20);

      const balance = await context.banksClient.getBalance(user.publicKey);
      console.log(`User ${i} balance: ${Number(balance) / anchor.web3.LAMPORTS_PER_SOL} SOL`);

      const { userPda } = await sdk.deposit({
        launch: testLaunchState,
        amountLamports: depositAmount,
        userKeypair: user,
      });

      users.push({ keypair: user, contribution: userPda });
    }

    let state = await sdk.fetchLaunch(testLaunchState);
    assert.isAbove(state.totalDeposited.toNumber(), testHardCap.toNumber());
    console.log(`Total deposited: ${state.totalDeposited.toNumber() / anchor.web3.LAMPORTS_PER_SOL} SOL`);
    console.log(`Hard cap: ${testHardCap.toNumber() / anchor.web3.LAMPORTS_PER_SOL} SOL`);
    console.log(`Total tickets: ${state.totalTickets}`);

    await advanceTime(context, { slots: 1000n, seconds: 11n });

    const { transaction: setSeedTx, selectionPda } = await sdk.setSeedTx({
      launch: testLaunchState,
      admin: admin.publicKey,
    });
    const seedSig = await provider.sendAndConfirm(setSeedTx, [admin.payer]);
    console.log("VRF seed set with signature:", seedSig);

    state = await sdk.fetchLaunch(testLaunchState);
    assert.ok(state.vrfSeed !== null);

    const totalTicketsToProcess = state.totalTickets;
    console.log(`Total tickets to process: ${totalTicketsToProcess}`);

    const maxItemsPerBatch = 10;
    let processed = 0;
    let batchSlot = await context.banksClient.getSlot();

    while (processed < totalTicketsToProcess) {
      batchSlot += 1n;
      context.warpToSlot(batchSlot);

      const processBatchIx = await program.methods
        .processBatch(maxItemsPerBatch)
        .accounts({
          selectionState: selectionPda,
          launchState: testLaunchState,
          roster: rosterPda,
        })
        .instruction();

      const processBatchTx = new anchor.web3.Transaction().add(processBatchIx);
      await provider.sendAndConfirm(processBatchTx, [admin.payer]);

      const selectionAccount = await sdk.fetchSelection(testLaunchState);
      processed = selectionAccount.processed;
      console.log(`Processed ${processed}/${totalTicketsToProcess} tickets`);
    }

    const finalSelectionAccount = await sdk.fetchSelection(testLaunchState);
    state = await sdk.fetchLaunch(testLaunchState);
    console.log(`Final processed: ${finalSelectionAccount.processed}, Total tickets: ${totalTicketsToProcess}`);
    console.log(`Heap length: ${finalSelectionAccount.heap.length}, K capacity: ${state.kCapacity}`);
    assert.equal(finalSelectionAccount.processed, totalTicketsToProcess);
    assert.equal(state.kCapacity, testHardCap.toNumber() / testTau.toNumber());
    assert.equal(finalSelectionAccount.heap.length, state.kCapacity);

    const { signature: finalizeSig } = await sdk.finalizeSelection({ launch: testLaunchState });
    console.log("Selection finalized with signature:", finalizeSig);

    state = await sdk.fetchLaunch(testLaunchState);
    assert.isTrue(state.selectionFinalized);
    assert.ok(state.thresholdScore !== null);
    console.log(`Threshold score: ${state.thresholdScore}`);

    const { signature: claimsSig } = await sdk.openClaims({ launch: testLaunchState });
    console.log("Claims opened with signature:", claimsSig);

    state = await sdk.fetchLaunch(testLaunchState);
    assert.isTrue(state.claimsOpen);
    assert.ok(state.tokensPerTicket !== null);
    console.log(`Tokens per ticket: ${state.tokensPerTicket}`);

    const testUser = users[0];
    const initialBalance = await context.banksClient.getBalance(testUser.keypair.publicKey);

    const { signature: refundSig } = await sdk.claimRefund({
      launch: testLaunchState,
      userKeypair: testUser.keypair,
    });
    console.log("Refund claimed with signature:", refundSig);

    const finalBalance = await context.banksClient.getBalance(testUser.keypair.publicKey);
    const userAccountAfter = await sdk.fetchUserContribution(testLaunchState, testUser.keypair.publicKey);

    assert.isTrue(userAccountAfter.claimedRefund);
    console.log(`User refund claimed. Balance change: ${(Number(finalBalance) - Number(initialBalance)) / anchor.web3.LAMPORTS_PER_SOL} SOL`);

    const { userAta, signature: tokenSig } = await sdk.claimTokens({
      launch: testLaunchState,
      saleMint: testSaleMint.publicKey,
      userKeypair: testUser.keypair,
      createAtaIfMissing: true,
    });
    console.log("Tokens claimed with signature:", tokenSig);

    const tokenAccountInfo = await context.banksClient.getAccount(userAta);
    const tokenAccount = unpackAccount(userAta, tokenAccountInfo);
    const userAccountFinal = await sdk.fetchUserContribution(testLaunchState, testUser.keypair.publicKey);

    assert.isTrue(userAccountFinal.claimedTokens);
    console.log(`User tokens claimed. Token balance: ${Number(tokenAccount.amount) / 1_000_000}`);

    console.log("Complete flow test passed! All functions tested successfully.");
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
      preInstructions: [
        anchor.web3.SystemProgram.createAccount({
          fromPubkey: admin.publicKey,
          newAccountPubkey: project1Mint.publicKey,
          space: 82,
          lamports: await provider.connection.getMinimumBalanceForRentExemption(82),
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
      preInstructions: [
        anchor.web3.SystemProgram.createAccount({
          fromPubkey: admin.publicKey,
          newAccountPubkey: project2Mint.publicKey,
          space: 82,
          lamports: await provider.connection.getMinimumBalanceForRentExemption(82),
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
      preInstructions: [
        anchor.web3.SystemProgram.createAccount({
          fromPubkey: admin.publicKey,
          newAccountPubkey: project3Mint.publicKey,
          space: 82,
          lamports: await provider.connection.getMinimumBalanceForRentExemption(82),
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

    assert.equal(project2State.projectId.toNumber(), project1State.projectId.toNumber() + 1);
    assert.equal(project3State.projectId.toNumber(), project2State.projectId.toNumber() + 1);

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
    const [directSelection] = sdk.getSelectionPda(directLaunch);
    const [directMintAuth] = sdk.getMintAuthPda(directLaunch);
    const [directProjectCounter] = sdk.getProjectCounterPda();

    assert.ok(sdkPdas.launch.equals(directLaunch));
    assert.ok(sdkPdas.escrow.equals(directEscrow));
    assert.ok(sdkPdas.roster.equals(directRoster));
    assert.ok(sdkPdas.selection.equals(directSelection));
    assert.ok(sdkPdas.mintAuth.equals(directMintAuth));
    assert.ok(sdkPdas.projectCounter.equals(directProjectCounter));

    console.log("All PDA derivations are consistent between SDK and direct program calls");
  });

});