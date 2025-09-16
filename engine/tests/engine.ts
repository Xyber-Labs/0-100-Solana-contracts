import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Engine } from "../target/types/engine";
import { assert } from "chai";
import {
  createInitializeMintInstruction,
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
        .accounts({
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
      .accounts({
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
      .accounts({
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
      .accounts({
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
});
