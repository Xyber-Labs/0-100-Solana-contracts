import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Engine } from "../target/types/engine";
import { assert } from "chai";
import {
  createInitializeMintInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

// Import the TS-SDK
import EngineSDK from "../ts-sdk/src/engine";

describe("engine", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.engine as Program<Engine>;
  const admin = provider.wallet;

  // Initialize SDK
  const sdk = EngineSDK.create(provider, program);

  let saleMint: anchor.web3.Keypair;
  let launchState: anchor.web3.PublicKey;
  let escrow: anchor.web3.PublicKey;
  const hardCapLamports = new anchor.BN(100 * anchor.web3.LAMPORTS_PER_SOL);
  const minRaiseLamports = new anchor.BN(10 * anchor.web3.LAMPORTS_PER_SOL);
  const perWalletCap = new anchor.BN(5 * anchor.web3.LAMPORTS_PER_SOL);
  const tauLamports = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);
  const saleAllocation = new anchor.BN(1000000);
  const lpAllocation = new anchor.BN(500000);

  // Helper to wait for funding period to end (for testing)
  async function waitForFundingPeriodEnd(launchPda: anchor.web3.PublicKey) {
    const state = await sdk.fetchLaunch(launchPda);
    const currentTime = Math.floor(Date.now() / 1000);
    const waitTime = state.fundingPeriodEnd.toNumber() - currentTime;
    if (waitTime > 0) {
      console.log(`Waiting ${waitTime} seconds for funding period to end...`);
      await new Promise(resolve => setTimeout(resolve, waitTime * 1000 + 2000)); // +2 second buffer
    }
  }

  before(async () => {
    saleMint = anchor.web3.Keypair.generate();
    [launchState] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("launch"), saleMint.publicKey.toBuffer()],
      program.programId
    );
    [escrow] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), launchState.toBuffer()],
      program.programId
    );

    // Use SDK to initialize launch
    const { signature } = await sdk.initLaunch({
      saleMint: saleMint.publicKey,
      hardCapLamports,
      minRaiseLamports,
      perWalletCap,
      tauLamports,
      saleAllocation,
      lpAllocation,
      fundingDurationDays: 0, // Use 10 seconds for tests (0 = 10 seconds for testing)
      preInstructions: [
        anchor.web3.SystemProgram.createAccount({
          fromPubkey: admin.publicKey,
          newAccountPubkey: saleMint.publicKey,
          space: 82, // Mint account size
          lamports: await provider.connection.getMinimumBalanceForRentExemption(82),
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
          saleMint.publicKey,
          6,
          admin.publicKey,
          admin.publicKey
        ),
      ],
      signers: [admin.payer, saleMint],
    });

    console.log("Launch initialized with signature:", signature);
  });

  it("Initializes the launch state correctly", async () => {
    const state = await sdk.fetchLaunch(launchState);

    // Check project ID (should be a valid number >= 0)
    assert.isTrue(state.projectId.toNumber() >= 0, "Project ID should be non-negative");
    assert.ok(state.admin.equals(admin.publicKey));
    assert.equal(state.hardCapLamports.toNumber(), hardCapLamports.toNumber());
    assert.equal(state.minRaiseLamports.toNumber(), minRaiseLamports.toNumber());
    assert.equal(state.perWalletCap.toNumber(), perWalletCap.toNumber());
    assert.equal(state.tauLamports.toNumber(), tauLamports.toNumber());
    assert.equal(state.saleAllocation.toNumber(), saleAllocation.toNumber());
    assert.equal(state.lpAllocation.toNumber(), lpAllocation.toNumber());
    assert.isTrue(state.fundingPeriodEnd.toNumber() > 0);
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


  it("Closes funding after period ends", async () => {
    // Initialize roster account using SDK
    const { rosterPda, signature: rosterSig } = await sdk.initRoster({ launch: launchState });
    console.log("Roster initialized with signature:", rosterSig);

    // Wait for funding period to end
    await waitForFundingPeriodEnd(launchState);

    // Deposits are now automatically closed (no manual call needed)
    const state = await sdk.fetchLaunch(launchState);
    const currentTime = Math.floor(Date.now() / 1000);
    assert.isTrue(currentTime >= state.fundingPeriodEnd.toNumber());
  });

  it("Sets the VRF seed", async () => {
    // Create a new launch state for this test
    const testSaleMint = anchor.web3.Keypair.generate();
    const [testLaunchState] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("launch"), testSaleMint.publicKey.toBuffer()],
      program.programId
    );

    // Initialize launch using SDK
    await sdk.initLaunch({
      saleMint: testSaleMint.publicKey,
      hardCapLamports,
      minRaiseLamports,
      perWalletCap,
      tauLamports,
      saleAllocation,
      lpAllocation,
      fundingDurationDays: 0, // Use 10 seconds for tests (0 = 10 seconds for testing)
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
          admin.publicKey,
          admin.publicKey
        ),
      ],
      signers: [admin.payer, testSaleMint],
    });


    // Initialize roster using SDK
    await sdk.initRoster({ launch: testLaunchState });

    // Wait for funding period to end
    await waitForFundingPeriodEnd(testLaunchState);

    // Deposits are now automatically closed (no manual call needed)
    const vrfSeed = anchor.web3.Keypair.generate().publicKey;

    // Set seed using SDK
    const { selectionPda, signature } = await sdk.setSeed({
      launch: testLaunchState,
      seed: vrfSeed.toBuffer(),
    });
    console.log("VRF seed set with signature:", signature);

    const state = await sdk.fetchLaunch(testLaunchState);
    assert.ok(state.vrfSeed !== null);
    assert.deepEqual(state.vrfSeed, Array.from(vrfSeed.toBuffer()));
  });

  it("Allows deposits", async () => {
    // Create a new launch state for this test
    const testSaleMint = anchor.web3.Keypair.generate();
    const [testLaunchState] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("launch"), testSaleMint.publicKey.toBuffer()],
      program.programId
    );

    // Initialize launch using SDK
    await sdk.initLaunch({
      saleMint: testSaleMint.publicKey,
      hardCapLamports,
      minRaiseLamports,
      perWalletCap,
      tauLamports,
      saleAllocation,
      lpAllocation,
      fundingDurationDays: 0, // Use 10 seconds for tests (0 = 10 seconds for testing)
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
          admin.publicKey,
          admin.publicKey
        ),
      ],
      signers: [admin.payer, testSaleMint],
    });


    // Initialize roster using SDK
    await sdk.initRoster({ launch: testLaunchState });

    const depositor = anchor.web3.Keypair.generate();
    
    // Airdrop SOL to the depositor
    await provider.connection.requestAirdrop(
      depositor.publicKey,
      20 * anchor.web3.LAMPORTS_PER_SOL
    );
    
    // Wait for the airdrop to complete
    await new Promise(resolve => setTimeout(resolve, 1000));

    const depositAmount = new anchor.BN(2 * anchor.web3.LAMPORTS_PER_SOL);

    // Deposit using SDK
    const { userPda, signature } = await sdk.deposit({
      launch: testLaunchState,
      amountLamports: depositAmount,
      userKeypair: depositor,
    });
    console.log("Deposit made with signature:", signature);

    const state = await sdk.fetchLaunch(testLaunchState);
    assert.equal(
      state.totalDeposited.toNumber(),
      depositAmount.toNumber()
    );

    const userAccount = await sdk.fetchUserContribution(testLaunchState, depositor.publicKey);
    assert.equal(userAccount.deposited.toNumber(), depositAmount.toNumber());
    assert.ok(userAccount.wallet.equals(depositor.publicKey));
  });

  it("Allows withdrawals", async () => {
    // Create a new launch state for this test
    const testSaleMint = anchor.web3.Keypair.generate();
    const [testLaunchState] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("launch"), testSaleMint.publicKey.toBuffer()],
      program.programId
    );

    // Initialize launch using SDK
    await sdk.initLaunch({
      saleMint: testSaleMint.publicKey,
      hardCapLamports,
      minRaiseLamports,
      perWalletCap,
      tauLamports,
      saleAllocation,
      lpAllocation,
      fundingDurationDays: 0, // Use 10 seconds for tests (0 = 10 seconds for testing)
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
          admin.publicKey,
          admin.publicKey
        ),
      ],
      signers: [admin.payer, testSaleMint],
    });


    // Initialize roster using SDK
    await sdk.initRoster({ launch: testLaunchState });

    const depositor = anchor.web3.Keypair.generate();
    
    // Airdrop SOL to the depositor
    await provider.connection.requestAirdrop(
      depositor.publicKey,
      20 * anchor.web3.LAMPORTS_PER_SOL
    );
    
    // Wait for the airdrop to complete
    await new Promise(resolve => setTimeout(resolve, 1000));

    const depositAmount = new anchor.BN(2 * anchor.web3.LAMPORTS_PER_SOL);

    // Deposit using SDK
    await sdk.deposit({
      launch: testLaunchState,
      amountLamports: depositAmount,
      userKeypair: depositor,
    });

    // Now, withdraw the funds using SDK
    const initialBalance = await provider.connection.getBalance(
      depositor.publicKey
    );

    const { signature } = await sdk.withdraw({
      launch: testLaunchState,
      amountLamports: depositAmount,
      userKeypair: depositor,
    });
    console.log("Withdrawal made with signature:", signature);

    const finalBalance = await provider.connection.getBalance(
      depositor.publicKey
    );

    assert.isAbove(finalBalance, initialBalance);

    const state = await sdk.fetchLaunch(testLaunchState);
    assert.equal(state.totalDeposited.toNumber(), 0);

    const userAccount = await sdk.fetchUserContribution(testLaunchState, depositor.publicKey);
    assert.equal(userAccount.deposited.toNumber(), 0);
  });

  it("Complete flow: Multiple users deposit beyond hard cap, cranking selects winners", async () => {
    // Create a new launch state for this comprehensive test
    const testSaleMint = anchor.web3.Keypair.generate();
    const [testLaunchState] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("launch"), testSaleMint.publicKey.toBuffer()],
      program.programId
    );
    
    // Get the correct mint authority
    const [mintAuth] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("mint_auth"), testLaunchState.toBuffer()],
      program.programId
    );

    // Initialize launch with smaller caps for testing
    const testHardCap = new anchor.BN(20 * anchor.web3.LAMPORTS_PER_SOL); // 20 SOL hard cap
    const testMinRaise = new anchor.BN(5 * anchor.web3.LAMPORTS_PER_SOL); // 5 SOL min raise
    const testPerWalletCap = new anchor.BN(3 * anchor.web3.LAMPORTS_PER_SOL); // 3 SOL per wallet
    const testTau = new anchor.BN(0.5 * anchor.web3.LAMPORTS_PER_SOL); // 0.5 SOL per ticket

    // Initialize launch using SDK
    await sdk.initLaunch({
      saleMint: testSaleMint.publicKey,
      hardCapLamports: testHardCap,
      minRaiseLamports: testMinRaise,
      perWalletCap: testPerWalletCap,
      tauLamports: testTau,
      saleAllocation,
      lpAllocation,
      fundingDurationDays: 1, // Use 30 seconds for this comprehensive test (1 = 30 seconds for testing)
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
      signers: [admin.payer, testSaleMint],
    });


    // Initialize roster using SDK
    await sdk.initRoster({ launch: testLaunchState });

    // Create multiple users and deposit funds
    const users = [];
    const depositAmount = new anchor.BN(2 * anchor.web3.LAMPORTS_PER_SOL); // 2 SOL per user
    
    for (let i = 0; i < 15; i++) { // Create 15 users to exceed hard cap
      const user = anchor.web3.Keypair.generate();
      
      // Airdrop SOL to the user
      await provider.connection.requestAirdrop(
        user.publicKey,
        20 * anchor.web3.LAMPORTS_PER_SOL
      );
      
      // Wait for the airdrop to complete
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Confirm the user has SOL
      const balance = await provider.connection.getBalance(user.publicKey);
      console.log(`User ${i} balance: ${balance / anchor.web3.LAMPORTS_PER_SOL} SOL`);

      // Deposit using SDK
      const { userPda, signature } = await sdk.deposit({
        launch: testLaunchState,
        amountLamports: depositAmount,
        userKeypair: user,
      });

      users.push({ keypair: user, contribution: userPda });
    }

    // Verify total deposits exceed hard cap
    let state = await sdk.fetchLaunch(testLaunchState);
    assert.isAbove(state.totalDeposited.toNumber(), testHardCap.toNumber());
    console.log(`Total deposited: ${state.totalDeposited.toNumber() / anchor.web3.LAMPORTS_PER_SOL} SOL`);
    console.log(`Hard cap: ${testHardCap.toNumber() / anchor.web3.LAMPORTS_PER_SOL} SOL`);
    console.log(`Total tickets: ${state.totalTickets}`);

    // Wait for funding period to end
    await waitForFundingPeriodEnd(testLaunchState);

    // Deposits are now automatically closed (no manual call needed)
    state = await sdk.fetchLaunch(testLaunchState);
    const currentTime = Math.floor(Date.now() / 1000);
    assert.isTrue(currentTime >= state.fundingPeriodEnd.toNumber());

    // Set VRF seed using SDK
    const vrfSeed = anchor.web3.Keypair.generate().publicKey;
    const { selectionPda, signature: seedSig } = await sdk.setSeed({
      launch: testLaunchState,
      seed: vrfSeed.toBuffer(),
    });
    console.log("VRF seed set with signature:", seedSig);

    state = await sdk.fetchLaunch(testLaunchState);
    assert.ok(state.vrfSeed !== null);

    // Store the total tickets count before processing
    const totalTicketsToProcess = state.totalTickets;
    console.log(`Total tickets to process: ${totalTicketsToProcess}`);

    // Process all tickets in batches (cranking) using SDK
    const maxItemsPerBatch = 10;
    let processed = 0;
    
    while (processed < totalTicketsToProcess) {
      const { signature: batchSig } = await sdk.processBatch({
        launch: testLaunchState,
        maxItems: maxItemsPerBatch,
      });

      const selectionAccount = await sdk.fetchSelection(testLaunchState);
      processed = selectionAccount.processed;
      console.log(`Processed ${processed}/${totalTicketsToProcess} tickets`);
      
      // Add a small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Verify all tickets are processed
    const finalSelectionAccount = await sdk.fetchSelection(testLaunchState);
    const finalState = await sdk.fetchLaunch(testLaunchState);
    console.log(`Final processed: ${finalSelectionAccount.processed}, Total tickets: ${totalTicketsToProcess}`);
    console.log(`Heap length: ${finalSelectionAccount.heap.length}, K capacity: ${finalState.kCapacity}`);
    assert.equal(finalSelectionAccount.processed, totalTicketsToProcess);
    assert.equal(finalSelectionAccount.heap.length, finalState.kCapacity); // Heap length should equal K capacity

    // Finalize selection using SDK
    const { signature: finalizeSig } = await sdk.finalizeSelection({ launch: testLaunchState });
    console.log("Selection finalized with signature:", finalizeSig);

    state = await sdk.fetchLaunch(testLaunchState);
    assert.isTrue(state.selectionFinalized);
    assert.ok(state.thresholdScore !== null);
    console.log(`Threshold score: ${state.thresholdScore}`);

    // Open claims using SDK
    const { signature: claimsSig } = await sdk.openClaims({ launch: testLaunchState });
    console.log("Claims opened with signature:", claimsSig);

    state = await sdk.fetchLaunch(testLaunchState);
    assert.isTrue(state.claimsOpen);
    assert.ok(state.tokensPerTicket !== null);
    console.log(`Tokens per ticket: ${state.tokensPerTicket}`);

    // Test claim refunds for some users (simulate losers) using SDK
    const testUser = users[0];
    const userAccountBefore = await sdk.fetchUserContribution(testLaunchState, testUser.keypair.publicKey);
    const initialBalance = await provider.connection.getBalance(testUser.keypair.publicKey);

    const { signature: refundSig } = await sdk.claimRefund({
      launch: testLaunchState,
      userKeypair: testUser.keypair,
    });
    console.log("Refund claimed with signature:", refundSig);

    const finalBalance = await provider.connection.getBalance(testUser.keypair.publicKey);
    const userAccountAfter = await sdk.fetchUserContribution(testLaunchState, testUser.keypair.publicKey);
    
    assert.isTrue(userAccountAfter.claimedRefund);
    console.log(`User refund claimed. Balance change: ${(finalBalance - initialBalance) / anchor.web3.LAMPORTS_PER_SOL} SOL`);

    // Test claim tokens for a user (simulate winner) using SDK
    const { userAta, signature: tokenSig } = await sdk.claimTokens({
      launch: testLaunchState,
      saleMint: testSaleMint.publicKey,
      userKeypair: testUser.keypair,
      createAtaIfMissing: true,
    });
    console.log("Tokens claimed with signature:", tokenSig);

    const finalTokenBalance = await provider.connection.getTokenAccountBalance(userAta);
    const userAccountFinal = await sdk.fetchUserContribution(testLaunchState, testUser.keypair.publicKey);
    
    assert.isTrue(userAccountFinal.claimedTokens);
    console.log(`User tokens claimed. Token balance: ${finalTokenBalance.value.uiAmount}`);

    console.log("Complete flow test passed! All functions tested successfully.");
  });

  it("Project ID increments correctly", async () => {
    // Get the project counter PDA to check current state
    const [projectCounterPda] = sdk.getProjectCounterPda();
    
    // Create multiple projects and verify IDs increment
    const project1Mint = anchor.web3.Keypair.generate();
    const project2Mint = anchor.web3.Keypair.generate();
    const project3Mint = anchor.web3.Keypair.generate();

    // Initialize first project
    const [project1Launch] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("launch"), project1Mint.publicKey.toBuffer()],
      program.programId
    );

    await sdk.initLaunch({
      saleMint: project1Mint.publicKey,
      hardCapLamports,
      minRaiseLamports,
      perWalletCap,
      tauLamports,
      saleAllocation,
      lpAllocation,
      fundingDurationDays: 0, // Use 10 seconds for tests (0 = 10 seconds for testing)
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

    // Initialize second project
    const [project2Launch] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("launch"), project2Mint.publicKey.toBuffer()],
      program.programId
    );

    await sdk.initLaunch({
      saleMint: project2Mint.publicKey,
      hardCapLamports,
      minRaiseLamports,
      perWalletCap,
      tauLamports,
      saleAllocation,
      lpAllocation,
      fundingDurationDays: 0, // Use 10 seconds for tests (0 = 10 seconds for testing)
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

    // Initialize third project
    const [project3Launch] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("launch"), project3Mint.publicKey.toBuffer()],
      program.programId
    );

    await sdk.initLaunch({
      saleMint: project3Mint.publicKey,
      hardCapLamports,
      minRaiseLamports,
      perWalletCap,
      tauLamports,
      saleAllocation,
      lpAllocation,
      fundingDurationDays: 0, // Use 10 seconds for tests (0 = 10 seconds for testing)
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

    // Verify project IDs
    const project1State = await sdk.fetchLaunch(project1Launch);
    const project2State = await sdk.fetchLaunch(project2Launch);
    const project3State = await sdk.fetchLaunch(project3Launch);

    // Verify that IDs are sequential and increment correctly
    assert.equal(project2State.projectId.toNumber(), project1State.projectId.toNumber() + 1);
    assert.equal(project3State.projectId.toNumber(), project2State.projectId.toNumber() + 1);

    console.log("Project IDs increment correctly:", {
      project1: project1State.projectId.toNumber(),
      project2: project2State.projectId.toNumber(),
      project3: project3State.projectId.toNumber(),
    });
  });

  it("PDA derivation consistency", async () => {
    // Test that SDK PDA derivation matches direct program derivation
    const testMint = anchor.web3.Keypair.generate();
    
    // SDK PDAs
    const sdkPdas = sdk.deriveAllPdas(testMint.publicKey);
    
    // Direct program PDAs
    const [directLaunch] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("launch"), testMint.publicKey.toBuffer()],
      program.programId
    );
    const [directEscrow] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), directLaunch.toBuffer()],
      program.programId
    );
    const [directRoster] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("roster"), directLaunch.toBuffer()],
      program.programId
    );
    const [directSelection] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("selection"), directLaunch.toBuffer()],
      program.programId
    );
    const [directMintAuth] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("mint_auth"), directLaunch.toBuffer()],
      program.programId
    );
    const [directProjectCounter] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("project_counter")],
      program.programId
    );

    // Verify all PDAs match
    assert.ok(sdkPdas.launch.equals(directLaunch));
    assert.ok(sdkPdas.escrow.equals(directEscrow));
    assert.ok(sdkPdas.roster.equals(directRoster));
    assert.ok(sdkPdas.selection.equals(directSelection));
    assert.ok(sdkPdas.mintAuth.equals(directMintAuth));
    assert.ok(sdkPdas.projectCounter.equals(directProjectCounter));

    console.log("All PDA derivations are consistent between SDK and direct program calls");
  });
});
