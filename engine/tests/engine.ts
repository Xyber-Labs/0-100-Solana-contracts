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

describe("engine", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.engine as Program<Engine>;
  const admin = provider.wallet;

  let saleMint: anchor.web3.Keypair;
  let launchState: anchor.web3.PublicKey;
  let escrow: anchor.web3.PublicKey;
  const hardCapLamports = new anchor.BN(100 * anchor.web3.LAMPORTS_PER_SOL);
  const minRaiseLamports = new anchor.BN(10 * anchor.web3.LAMPORTS_PER_SOL);
  const perWalletCap = new anchor.BN(5 * anchor.web3.LAMPORTS_PER_SOL);
  const tauLamports = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);
  const saleAllocation = new anchor.BN(1000000);
  const lpAllocation = new anchor.BN(500000);

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

    await program.methods
      .initLaunch(
        hardCapLamports,
        minRaiseLamports,
        perWalletCap,
        tauLamports,
        saleAllocation,
        lpAllocation
      )
      .accountsStrict({
        admin: admin.publicKey,
        launchState,
        saleMint: saleMint.publicKey,
        escrow,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([admin.payer, saleMint])
      .preInstructions([
        anchor.web3.SystemProgram.createAccount({
          fromPubkey: admin.publicKey,
          newAccountPubkey: saleMint.publicKey,
          space: 82, // Mint account size
          lamports: await provider.connection.getMinimumBalanceForRentExemption(
            82
          ),
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
          saleMint.publicKey,
          6,
          admin.publicKey,
          admin.publicKey
        ),
      ])
      .rpc();
  });

  // Helper function to initialize roster account
  async function initializeRoster() {
    const [roster] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("roster"), launchState.toBuffer()],
      program.programId
    );

    try {
      // Check if roster account already exists
      await program.account.roster.fetch(roster);
      return roster;
    } catch (error) {
      // Account doesn't exist, create it
      await program.methods
        .initRoster()
        .accountsStrict({
          admin: admin.publicKey,
          launchState,
          roster,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      return roster;
    }
  }

  it("Initializes the launch state", async () => {
    const state = await program.account.launchState.fetch(launchState);

    assert.ok(state.admin.equals(admin.publicKey));
    assert.equal(state.hardCapLamports.toNumber(), hardCapLamports.toNumber());
    assert.equal(state.minRaiseLamports.toNumber(), minRaiseLamports.toNumber());
    assert.equal(state.perWalletCap.toNumber(), perWalletCap.toNumber());
    assert.equal(state.tauLamports.toNumber(), tauLamports.toNumber());
    assert.equal(state.saleAllocation.toNumber(), saleAllocation.toNumber());
    assert.equal(state.lpAllocation.toNumber(), lpAllocation.toNumber());
    assert.isFalse(state.fundingOpen);
    assert.isFalse(state.depositsClosed);
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

  it("Opens funding", async () => {
    await program.methods
      .openFunding()
      .accountsStrict({
        admin: admin.publicKey,
        launchState,
      })
      .rpc();

    const state = await program.account.launchState.fetch(launchState);
    assert.isTrue(state.fundingOpen);
  });

  it("Closes funding", async () => {
    await program.methods
      .openFunding()
      .accountsStrict({
        admin: admin.publicKey,
        launchState,
      })
      .rpc();

    let state = await program.account.launchState.fetch(launchState);
    assert.isTrue(state.fundingOpen);

    // Initialize roster account
    const roster = await initializeRoster();

    await program.methods
      .closeDeposits()
      .accountsStrict({
        admin: admin.publicKey,
        launchState,
        roster,
        launch: launchState,
      })
      .rpc();

    state = await program.account.launchState.fetch(launchState);
    assert.isFalse(state.fundingOpen);
    assert.isTrue(state.depositsClosed);
  });

  it("Sets the VRF seed", async () => {
    // Create a new launch state for this test
    const testSaleMint = anchor.web3.Keypair.generate();
    const [testLaunchState] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("launch"), testSaleMint.publicKey.toBuffer()],
      program.programId
    );
    const [testEscrow] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), testLaunchState.toBuffer()],
      program.programId
    );

    await program.methods
      .initLaunch(
        hardCapLamports,
        minRaiseLamports,
        perWalletCap,
        tauLamports,
        saleAllocation,
        lpAllocation
      )
      .accountsStrict({
        admin: admin.publicKey,
        launchState: testLaunchState,
        saleMint: testSaleMint.publicKey,
        escrow: testEscrow,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([admin.payer, testSaleMint])
      .preInstructions([
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
      ])
      .rpc();

    // Open funding
    await program.methods
      .openFunding()
      .accountsStrict({
        admin: admin.publicKey,
        launchState: testLaunchState,
      })
      .rpc();

    // Initialize roster account
    const [testRoster] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("roster"), testLaunchState.toBuffer()],
      program.programId
    );

    await program.methods
      .initRoster()
        .accountsStrict({
          admin: admin.publicKey,
          launchState: testLaunchState,
          roster: testRoster,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
      .rpc();

    await program.methods
      .closeDeposits()
      .accountsStrict({
        admin: admin.publicKey,
        launchState: testLaunchState,
        roster: testRoster,
        launch: testLaunchState,
      })
      .rpc();

    const vrfSeed = anchor.web3.Keypair.generate().publicKey;
    const [selectionState] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("selection"), testLaunchState.toBuffer()],
      program.programId
    );

    await program.methods
      // @ts-ignore
      .setSeed(vrfSeed.toBuffer())
      .accountsStrict({
        admin: admin.publicKey,
        launchState: testLaunchState,
        selectionState,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const state = await program.account.launchState.fetch(testLaunchState);
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
    const [testEscrow] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), testLaunchState.toBuffer()],
      program.programId
    );

    await program.methods
      .initLaunch(
        hardCapLamports,
        minRaiseLamports,
        perWalletCap,
        tauLamports,
        saleAllocation,
        lpAllocation
      )
      .accountsStrict({
        admin: admin.publicKey,
        launchState: testLaunchState,
        saleMint: testSaleMint.publicKey,
        escrow: testEscrow,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([admin.payer, testSaleMint])
      .preInstructions([
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
      ])
      .rpc();

    await program.methods
      .openFunding()
      .accountsStrict({
        admin: admin.publicKey,
        launchState: testLaunchState,
      })
      .rpc();

    // Initialize roster account
    const [testRoster] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("roster"), testLaunchState.toBuffer()],
      program.programId
    );

    await program.methods
      .initRoster()
        .accountsStrict({
          admin: admin.publicKey,
          launchState: testLaunchState,
          roster: testRoster,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
      .rpc();

    const depositor = anchor.web3.Keypair.generate();
    
    // Airdrop SOL to the depositor
    await provider.connection.requestAirdrop(
      depositor.publicKey,
      20 * anchor.web3.LAMPORTS_PER_SOL
    );
    
    // Wait for the airdrop to complete
    await new Promise(resolve => setTimeout(resolve, 1000));

    const depositAmount = new anchor.BN(2 * anchor.web3.LAMPORTS_PER_SOL);

    const [userContribution] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("user"),
        testLaunchState.toBuffer(),
        depositor.publicKey.toBuffer(),
      ],
      program.programId
    );

    await program.methods
      .deposit(depositAmount)
      .accountsStrict({
        user: depositor.publicKey,
        launchState: testLaunchState,
        userContribution,
        roster: testRoster,
        escrow: testEscrow,
        launch: testLaunchState,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([depositor])
      .rpc();

    const state = await program.account.launchState.fetch(testLaunchState);
    assert.equal(
      state.totalDeposited.toNumber(),
      depositAmount.toNumber()
    );

    const userAccount = await program.account.userContribution.fetch(userContribution);
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
    const [testEscrow] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), testLaunchState.toBuffer()],
      program.programId
    );

    await program.methods
      .initLaunch(
        hardCapLamports,
        minRaiseLamports,
        perWalletCap,
        tauLamports,
        saleAllocation,
        lpAllocation
      )
      .accountsStrict({
        admin: admin.publicKey,
        launchState: testLaunchState,
        saleMint: testSaleMint.publicKey,
        escrow: testEscrow,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([admin.payer, testSaleMint])
      .preInstructions([
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
      ])
      .rpc();

    // First, deposit some funds
    await program.methods
      .openFunding()
      .accountsStrict({
        admin: admin.publicKey,
        launchState: testLaunchState,
      })
      .rpc();

    // Initialize roster account
    const [testRoster] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("roster"), testLaunchState.toBuffer()],
      program.programId
    );

    await program.methods
      .initRoster()
        .accountsStrict({
          admin: admin.publicKey,
          launchState: testLaunchState,
          roster: testRoster,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
      .rpc();

    const depositor = anchor.web3.Keypair.generate();
    
    // Airdrop SOL to the depositor
    await provider.connection.requestAirdrop(
      depositor.publicKey,
      20 * anchor.web3.LAMPORTS_PER_SOL
    );
    
    // Wait for the airdrop to complete
    await new Promise(resolve => setTimeout(resolve, 1000));

    const depositAmount = new anchor.BN(2 * anchor.web3.LAMPORTS_PER_SOL);
    const [userContribution] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("user"),
        testLaunchState.toBuffer(),
        depositor.publicKey.toBuffer(),
      ],
      program.programId
    );

    await program.methods
      .deposit(depositAmount)
      .accountsStrict({
        user: depositor.publicKey,
        launchState: testLaunchState,
        userContribution,
        roster: testRoster,
        escrow: testEscrow,
        launch: testLaunchState,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([depositor])
      .rpc();

    // Now, withdraw the funds
    const initialBalance = await provider.connection.getBalance(
      depositor.publicKey
    );

    await program.methods
      .withdraw(depositAmount)
      .accountsStrict({
        user: depositor.publicKey,
        launchState: testLaunchState,
        userContribution,
        roster: testRoster,
        escrow: testEscrow,
        launch: testLaunchState,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([depositor])
      .rpc();

    const finalBalance = await provider.connection.getBalance(
      depositor.publicKey
    );

    assert.isAbove(finalBalance, initialBalance);

    const state = await program.account.launchState.fetch(testLaunchState);
    assert.equal(state.totalDeposited.toNumber(), 0);

    const userAccount = await program.account.userContribution.fetch(userContribution);
    assert.equal(userAccount.deposited.toNumber(), 0);
  });

  it("Complete flow: Multiple users deposit beyond hard cap, cranking selects winners", async () => {
    // Create a new launch state for this comprehensive test
    const testSaleMint = anchor.web3.Keypair.generate();
    const [testLaunchState] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("launch"), testSaleMint.publicKey.toBuffer()],
      program.programId
    );
    const [testEscrow] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), testLaunchState.toBuffer()],
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

    await program.methods
      .initLaunch(
        testHardCap,
        testMinRaise,
        testPerWalletCap,
        testTau,
        saleAllocation,
        lpAllocation
      )
      .accountsStrict({
        admin: admin.publicKey,
        launchState: testLaunchState,
        saleMint: testSaleMint.publicKey,
        escrow: testEscrow,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([admin.payer, testSaleMint])
      .preInstructions([
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
      ])
      .rpc();

    // Open funding
    await program.methods
      .openFunding()
      .accountsStrict({
        admin: admin.publicKey,
        launchState: testLaunchState,
      })
      .rpc();

    // Initialize roster account
    const [testRoster] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("roster"), testLaunchState.toBuffer()],
      program.programId
    );

    await program.methods
      .initRoster()
        .accountsStrict({
          admin: admin.publicKey,
          launchState: testLaunchState,
          roster: testRoster,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
      .rpc();

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

      const [userContribution] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("user"),
          testLaunchState.toBuffer(),
          user.publicKey.toBuffer(),
        ],
        program.programId
      );

      await program.methods
        .deposit(depositAmount)
        .accountsStrict({
          user: user.publicKey,
          launchState: testLaunchState,
          userContribution,
          roster: testRoster,
          escrow: testEscrow,
          launch: testLaunchState,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      users.push({ keypair: user, contribution: userContribution });
    }

    // Verify total deposits exceed hard cap
    let state = await program.account.launchState.fetch(testLaunchState);
    assert.isAbove(state.totalDeposited.toNumber(), testHardCap.toNumber());
    console.log(`Total deposited: ${state.totalDeposited.toNumber() / anchor.web3.LAMPORTS_PER_SOL} SOL`);
    console.log(`Hard cap: ${testHardCap.toNumber() / anchor.web3.LAMPORTS_PER_SOL} SOL`);
    console.log(`Total tickets: ${state.totalTickets}`);

    // Close deposits
    await program.methods
      .closeDeposits()
      .accountsStrict({
        admin: admin.publicKey,
        launchState: testLaunchState,
        roster: testRoster,
        launch: testLaunchState,
      })
      .rpc();

    state = await program.account.launchState.fetch(testLaunchState);
    assert.isTrue(state.depositsClosed);
    assert.equal(state.kCapacity, testHardCap.toNumber() / testTau.toNumber()); // K = hard_cap / tau

    // Set VRF seed
    const vrfSeed = anchor.web3.Keypair.generate().publicKey;
    const [selectionState] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("selection"), testLaunchState.toBuffer()],
      program.programId
    );

    await program.methods
      // @ts-ignore
      .setSeed(vrfSeed.toBuffer())
      .accountsStrict({
        admin: admin.publicKey,
        launchState: testLaunchState,
        selectionState,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    state = await program.account.launchState.fetch(testLaunchState);
    assert.ok(state.vrfSeed !== null);

    // Store the total tickets count before processing
    const totalTicketsToProcess = state.totalTickets;
    console.log(`Total tickets to process: ${totalTicketsToProcess}`);

    // Process all tickets in batches (cranking)
    const maxItemsPerBatch = 10;
    let processed = 0;
    
    while (processed < totalTicketsToProcess) {
      await program.methods
        .processBatch(maxItemsPerBatch)
        .accountsStrict({
          selectionState,
          launchState: testLaunchState,
          roster: testRoster,
        })
        .rpc();

      const selectionAccount = await program.account.selectionState.fetch(selectionState);
      processed = selectionAccount.processed;
      console.log(`Processed ${processed}/${totalTicketsToProcess} tickets`);
      
      // Add a small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Verify all tickets are processed
    const finalSelectionAccount = await program.account.selectionState.fetch(selectionState);
    console.log(`Final processed: ${finalSelectionAccount.processed}, Total tickets: ${totalTicketsToProcess}`);
    console.log(`Heap length: ${finalSelectionAccount.heap.length}, K capacity: ${state.kCapacity}`);
    assert.equal(finalSelectionAccount.processed, totalTicketsToProcess);
    assert.equal(finalSelectionAccount.heap.length, state.kCapacity);

    // Finalize selection
    await program.methods
      .finalizeSelection()
      .accountsStrict({
        selectionState,
        launchState: testLaunchState,
      })
      .rpc();

    state = await program.account.launchState.fetch(testLaunchState);
    assert.isTrue(state.selectionFinalized);
    assert.ok(state.thresholdScore !== null);
    console.log(`Threshold score: ${state.thresholdScore}`);

    // Open claims
    await program.methods
      .openClaims()
      .accountsStrict({
        admin: admin.publicKey,
        launchState: testLaunchState,
      })
      .rpc();

    state = await program.account.launchState.fetch(testLaunchState);
    assert.isTrue(state.claimsOpen);
    assert.ok(state.tokensPerTicket !== null);
    console.log(`Tokens per ticket: ${state.tokensPerTicket}`);

    // Test claim refunds for some users (simulate losers)
    const testUser = users[0];
    const userAccountBefore = await program.account.userContribution.fetch(testUser.contribution);
    const initialBalance = await provider.connection.getBalance(testUser.keypair.publicKey);

    await program.methods
      .claimRefund()
      .accountsStrict({
        user: testUser.keypair.publicKey,
        launchState: testLaunchState,
        userContribution: testUser.contribution,
        selectionState,
        escrow: testEscrow,
      })
      .signers([testUser.keypair])
      .rpc();

    const finalBalance = await provider.connection.getBalance(testUser.keypair.publicKey);
    const userAccountAfter = await program.account.userContribution.fetch(testUser.contribution);
    
    assert.isTrue(userAccountAfter.claimedRefund);
    console.log(`User refund claimed. Balance change: ${(finalBalance - initialBalance) / anchor.web3.LAMPORTS_PER_SOL} SOL`);

    // Test claim tokens for a user (simulate winner)
    // First create a token account for the user
    const userTokenAccount = await getAssociatedTokenAddress(
      testSaleMint.publicKey,
      testUser.keypair.publicKey
    );

    const createTokenAccountIx = createAssociatedTokenAccountInstruction(
      admin.publicKey,
      userTokenAccount,
      testUser.keypair.publicKey,
      testSaleMint.publicKey
    );

    await program.methods
      .claimTokens()
      .accountsStrict({
        user: testUser.keypair.publicKey,
        launchState: testLaunchState,
        userContribution: testUser.contribution,
        selectionState,
        saleMint: testSaleMint.publicKey,
        mintAuth: mintAuth,
        userAta: userTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([testUser.keypair])
      .preInstructions([createTokenAccountIx])
      .rpc();

    const finalTokenBalance = await provider.connection.getTokenAccountBalance(userTokenAccount);
    const userAccountFinal = await program.account.userContribution.fetch(testUser.contribution);
    
    assert.isTrue(userAccountFinal.claimedTokens);
    console.log(`User tokens claimed. Token balance: ${finalTokenBalance.value.uiAmount}`);

    console.log("Complete flow test passed! All functions tested successfully.");
  });
});
