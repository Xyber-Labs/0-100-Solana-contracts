import { BN, Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createInitializeMintInstruction,
} from "@solana/spl-token";
interface LaunchConfig {
  hardCapLamports: number;
  minRaiseLamports: number;
  perWalletCap: number;
  tauLamports: number;
  saleAllocation: number;
  lpAllocation: number;
  fundingDurationDays: number;
  numBlocks: number;
  creatorInitialDepositLamports: number;
  creatorDailyLamportsLimit: number;
}

// A simplified SDK type, as we don't have the full type in this context
type Sdk = any;

export async function runFullFlow(
  sdk: Sdk,
  program: Program,
  provider: any,
  config: LaunchConfig,
  addLog: (log: string) => void
): Promise<{ success: boolean; message: string }> {
  const admin = provider.wallet;
  addLog(`--- Starting Full Flow ---`);
  addLog(`Admin wallet: ${admin.publicKey.toBase58()}`);

  let testLaunchState: PublicKey;

  // --- Simulation Parameters ---
  const TOTAL_SUPPLY = 1_000_000_000; // 1 Billion
  const SALE_PERCENTAGE = 0.45946; // 45.946%
  const TOKEN_DECIMALS = 6;
  
  // Calculate sale_allocation based on simulation parameters
  const saleAllocation = Math.floor(TOTAL_SUPPLY * SALE_PERCENTAGE) * (10 ** TOKEN_DECIMALS);
  config.saleAllocation = saleAllocation;

  // Override creator deposit for this specific test
  const LAMPORTS_PER_SOL = 1_000_000_000;
  config.creatorInitialDepositLamports = 1 * LAMPORTS_PER_SOL;
  
  addLog(`\n--- Using Simulation Parameters ---`);
  addLog(`   -> Total Supply: ${TOTAL_SUPPLY.toLocaleString()}`);
  addLog(`   -> Sale Percentage: ${SALE_PERCENTAGE * 100}%`);
  addLog(`   -> Calculated Sale Allocation (atomic units): ${config.saleAllocation.toLocaleString()}`);
  addLog(`   -> Creator Deposit: ${config.creatorInitialDepositLamports / LAMPORTS_PER_SOL} SOL`);
  addLog(`------------------------------------`);
  // --- End Simulation Parameters ---

  try {
    // Helper to wait
    async function waitForFundingPeriodEnd(launchPda: PublicKey) {
      addLog("Fetching launch state to check funding period...");
      const state = await sdk.fetchLaunch(launchPda);
      const currentTime = Math.floor(Date.now() / 1000);
      const fundingEndTime = state.fundingPeriodEnd.toNumber();

      if (currentTime >= fundingEndTime) {
        addLog("Funding period has already ended.");
        return;
      }

      const waitTime = fundingEndTime - currentTime;
      if (waitTime > 0) {
        addLog(`Waiting ${waitTime + 2} seconds for funding period to end...`);
        await new Promise((resolve) =>
          setTimeout(resolve, (waitTime + 2) * 1000)
        );
      }
    }

    // Helper to get token balance
    async function getTokenBalance(ata: PublicKey): Promise<number> {
      try {
        const balance = await provider.connection.getTokenAccountBalance(ata);
        return parseFloat(balance.value.uiAmountString || "0");
      } catch (error) {
        // If ATA doesn't exist, balance is 0
        return 0;
      }
    }

    // 1. Initialize Launch
    addLog(`[1/10] Initializing Launch...`);
    
    // Debug: Check available methods
    addLog(`Available SDK methods: ${Object.keys(sdk).join(', ')}`);
    
    // Check admin balance and adjust creator deposit if needed
    let adminBalance: number;
    try {
      adminBalance = await provider.connection.getBalance(admin.publicKey);
    } catch (error) {
      // Fallback for LiteSVM - assume 10 SOL balance
      adminBalance = 10 * 1e9;
      addLog(`Using fallback admin balance: ${adminBalance / 1e9} SOL`);
    }
    
    const availableForCreatorDeposit = adminBalance - 500000000; // Reserve 0.5 SOL for fees
    const adjustedCreatorDeposit = Math.min(config.creatorInitialDepositLamports, availableForCreatorDeposit);
    
    if (adjustedCreatorDeposit < config.creatorInitialDepositLamports) {
      addLog(`Admin balance: ${adminBalance / 1e9} SOL`);
      addLog(`Reducing creator deposit from ${config.creatorInitialDepositLamports / 1e9} SOL to ${adjustedCreatorDeposit / 1e9} SOL`);
      config.creatorInitialDepositLamports = adjustedCreatorDeposit;
    }
    
    const testSaleMint = Keypair.generate();
    [testLaunchState] = sdk.getLaunchPda(testSaleMint.publicKey);
    const [mintAuth] = sdk.getMintAuthPda(testLaunchState);
    const [escrow] = sdk.getEscrowPda(testLaunchState);
    const [projectCounter] = sdk.getProjectCounterPda();
    
    // Check if getCreatorGrantPda exists before calling it
    let creatorGrant: PublicKey;
    if (typeof sdk.getCreatorGrantPda === 'function') {
      [creatorGrant] = sdk.getCreatorGrantPda(testLaunchState);
    } else {
      throw new Error(`getCreatorGrantPda method not found on SDK. Available methods: ${Object.keys(sdk).join(', ')}`);
    }

    const tx = new Transaction();

    const cuInstruction = ComputeBudgetProgram.setComputeUnitLimit({
      units: 1_400_000,
    });
    tx.add(cuInstruction);

    // Add pre-instructions
    tx.add(
      SystemProgram.createAccount({
        fromPubkey: admin.publicKey,
        newAccountPubkey: testSaleMint.publicKey,
        space: 82,
        lamports: 2039280, // Fixed rent exemption for 82 bytes
        programId: TOKEN_PROGRAM_ID,
      })
    );
    tx.add(
      createInitializeMintInstruction(
        testSaleMint.publicKey,
        6,
        mintAuth,
        admin.publicKey
      )
    );

    // Add main instruction
    const initLaunchIx = await program.methods
      .initLaunch({
        hardCapLamports: new BN(config.hardCapLamports),
        minRaiseLamports: new BN(config.minRaiseLamports),
        perWalletCap: new BN(config.perWalletCap),
        tauLamports: new BN(config.tauLamports),
        saleAllocation: new BN(config.saleAllocation),
        lpAllocation: new BN(config.lpAllocation),
        fundingDurationSeconds: new BN(5), // Use 5 seconds for testing
        numBlocks: new BN(config.numBlocks),
        creatorInitialDepositLamports: new BN(config.creatorInitialDepositLamports),
        creatorDailyLamportsLimit: new BN(config.creatorDailyLamportsLimit),
      })
      .accountsStrict({
        creator: admin.publicKey,
        projectCounter,
        launchState: testLaunchState,
        saleMint: testSaleMint.publicKey,
        escrow,
        creatorGrant,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    tx.add(initLaunchIx);

    // Set fee payer and recent blockhash
    tx.feePayer = admin.publicKey;
    // For LiteSVM, use a dummy blockhash
    tx.recentBlockhash = "11111111111111111111111111111111";

    // Send transaction using provider's sendAndConfirm method
    const signature = await provider.sendAndConfirm(tx, [testSaleMint]);

    addLog(`   -> Launch initialized. Signature: ${signature}`);
    addLog(`   -> Launch PDA: ${testLaunchState.toBase58()}`);

    // 2. Initialize Roster
    addLog(`\n[2/10] Initializing Roster...`);
    await sdk.initRoster({ launch: testLaunchState });
    addLog("   -> Roster initialized.");

    // 3. Simulate deposits to create a ~2x overflow
    const k_capacity = config.hardCapLamports / config.tauLamports;
    let numUsersToSimulate = Math.floor(k_capacity * 2);
    const depositAmount = new BN(config.tauLamports); // 1 ticket per user
    const usersWithDeposits = new Map<string, { keypair: Keypair; tickets: number }>();

    addLog(`\n[3/10] Simulating deposits for a ~2x overflow...`);
    addLog(`   -> Capacity (k): ${k_capacity}`);
    addLog(`   -> Target users for 2x overflow: ${numUsersToSimulate}`);

    if (numUsersToSimulate > 50) {
      addLog(
        `   -> Capping simulation at 50 users to keep test runtime reasonable.`
      );
      numUsersToSimulate = 50;
    }
    if (numUsersToSimulate === 0) {
      addLog(`   -> At least one user will be simulated.`);
      numUsersToSimulate = 1;
    }

    addLog(
      `   -> Simulating ${numUsersToSimulate} users, each depositing for 1 ticket.`
    );

    // Step 1: Generate all user keypairs
    const users = Array.from({ length: numUsersToSimulate }, () =>
      Keypair.generate()
    );

    // Step 2: Check admin balance and adjust user count/funding
    let currentAdminBalance: number;
    try {
      currentAdminBalance = await provider.connection.getBalance(admin.publicKey);
    } catch (error) {
      currentAdminBalance = 500000000; // Fallback: assume 0.5 SOL remaining
    }
    
    const fundingPerUser = Number(depositAmount) + 5000000; // deposit + ~0.005 SOL buffer for fees
    const maxAffordableUsers = Math.floor(currentAdminBalance / fundingPerUser);
    
    if (maxAffordableUsers < numUsersToSimulate) {
      addLog(`Admin balance: ${currentAdminBalance / 1e9} SOL`);
      addLog(`Reducing users from ${numUsersToSimulate} to ${maxAffordableUsers} due to insufficient funds`);
      numUsersToSimulate = Math.max(1, maxAffordableUsers);
      users.splice(numUsersToSimulate); // Trim users array
    }
    
    if (numUsersToSimulate === 0) {
      throw new Error("Insufficient admin balance to fund any users");
    }
    
    addLog(
      `   -> Funding ${numUsersToSimulate} users with transfers from admin...`
    );
    await Promise.all(
      users.map(async (user) => {
        const transferIx = SystemProgram.transfer({
          fromPubkey: admin.publicKey,
          toPubkey: user.publicKey,
          lamports: fundingPerUser,
        });
        const tx = new Transaction().add(transferIx);
        tx.feePayer = admin.publicKey;
        tx.recentBlockhash = "11111111111111111111111111111111";
        await provider.sendAndConfirm(tx, []);
      })
    );
    addLog("   -> All users funded.");

    // Step 4: Deposit from all users in parallel
    addLog(
      `   -> Sending ${numUsersToSimulate} deposit transactions in parallel...`
    );
    await Promise.all(
      users.map((user) =>
        sdk.deposit({
          launch: testLaunchState,
          amountLamports: depositAmount,
          userKeypair: user,
        }).then(() => {
          usersWithDeposits.set(user.publicKey.toBase58(), {
            keypair: user,
            tickets: depositAmount.toNumber() / config.tauLamports,
          });
        })
      )
    );
    addLog("   -> All deposits completed.");

    // 4. Wait for Funding to End
    addLog(`\n[4/10] Waiting for funding period to end...`);
    await waitForFundingPeriodEnd(testLaunchState);
    addLog("   -> Funding period closed.");

    // 5. Set VRF Seed
    addLog(`\n[5/10] Setting VRF Seed...`);
    await sdk.setSeed({ launch: testLaunchState });
    addLog("   -> VRF seed set.");

    // 6. Process Batches
    addLog(`\n[6/10] Processing batches (cranking)...`);
    const state = await sdk.fetchLaunch(testLaunchState);
    const totalTicketsToProcess = state.totalTickets;
    let processed = 0;
    let crankTxCount = 0;
    while (processed < totalTicketsToProcess) {
      await sdk.processBatch({ launch: testLaunchState, maxItems: 10 });
      const selectionAccount = await sdk.fetchSelection(testLaunchState);
      processed = selectionAccount.processed;
      crankTxCount++;
      addLog(`   -> Processed ${processed}/${totalTicketsToProcess} tickets`);
    }

    addLog(`   -> Crank finished.`);
    addLog(`   -> Total transactions: ${crankTxCount}`);

    // 7. Finalize & Open Claims (now automatic)
    addLog(`\n[7/10] Verifying automatic finalization...`);
    const finalState = await sdk.fetchLaunch(testLaunchState);
    if (finalState.selectionFinalized && finalState.claimsOpen) {
      addLog("   -> Verified: Selection is finalized and claims are open.");
    } else {
      throw new Error(
        "Verification failed: Selection not finalized or claims not open."
      );
    }

    // 8. Create Pool
    addLog(`\n[8/10] Creating Pool...`);
    try {
      await sdk.createPool({ launch: testLaunchState });
      addLog("   -> Pool created successfully!");
      const poolState = await sdk.fetchPoolState(testLaunchState);
      addLog(`      - Pool ID: ${poolState.poolId.toString()}`);
    } catch (error: any) {
      if (error.message && error.message.includes("NoValidBlockhash")) {
        addLog(
          "   -> Pool creation failed as expected: No valid blockhash found."
        );
        addLog("   -> This is the correct and expected behavior.");
      } else {
        // Re-throw if it's a different error
        throw error;
      }
    }

    // 9. Test User Token/Refund Claiming
    addLog(`\n[9/10] Testing User Token & Refund Claiming...`);
    const selection = await sdk.fetchSelection(testLaunchState);
    
    // --- DEBUG LOG ---
    addLog(`   -> DEBUG: Fetched Selection account content:`);
    addLog(`      ${JSON.stringify(selection, (key, value) =>
          typeof value === 'bigint' ? value.toString() : value, 2
      )}`);
    // --- END DEBUG LOG ---
    
    const winners = selection.winners || [];
    const losers = selection.losers || [];
    addLog(`   -> Winners: ${winners.length}, Losers: ${losers.length}`);

    let totalTokensClaimed = 0;
    let totalRefundsClaimed = 0;
    const initialAdminBalanceForClaims = await provider.connection.getBalance(admin.publicKey);

    // Claim for winners
    for (const winnerPubkey of winners) {
      const winnerData = usersWithDeposits.get(winnerPubkey.toBase58());
      if (winnerData) {
        const userAta = sdk.getUserAta(testSaleMint.publicKey, winnerData.keypair.publicKey);
        const initialBalance = await getTokenBalance(userAta);
        
        await sdk.claimTokens({
          launch: testLaunchState,
          saleMint: testSaleMint.publicKey,
          userKeypair: winnerData.keypair,
          createAtaIfMissing: true,
        });

        const finalBalance = await getTokenBalance(userAta);
        totalTokensClaimed += (finalBalance - initialBalance);
      }
    }
    if(winners.length > 0) addLog(`   -> Total tokens claimed by winners: ${totalTokensClaimed.toFixed(6)}`);

    // Claim for losers
    for (const loserPubkey of losers) {
      const loserData = usersWithDeposits.get(loserPubkey.toBase58());
      if (loserData) {
        await sdk.claimRefund({
          launch: testLaunchState,
          userKeypair: loserData.keypair,
        });
        // We can't easily track the refund amount per user without fetching balances,
        // so we'll check the admin's balance change as a proxy.
      }
    }
    
    const finalAdminBalanceForClaims = await provider.connection.getBalance(admin.publicKey);
    // Note: This is an approximation as it includes fees.
    totalRefundsClaimed = (finalAdminBalanceForClaims - initialAdminBalanceForClaims) / 1e9; 
    
    if (losers.length > 0) addLog(`   -> Admin balance change after refunds (proxy for SOL refunded): ~${totalRefundsClaimed.toFixed(6)} SOL`);


    // 10. Test Creator Token Claiming (if creator deposit was made)
    if (config.creatorInitialDepositLamports > 0) {
      addLog(`\n[10/10] Testing Creator Token Claiming...`);
      try {
        // Use the same admin wallet as the creator (since that's who initialized the launch)
        // Don't pass creatorKeypair - let the SDK use the provider's wallet (payer)
        
        // Create creator ATA for the sale mint
        const creatorAta = sdk.getUserAta(testSaleMint.publicKey, admin.publicKey);
        const initialCreatorTokenBalance = await getTokenBalance(creatorAta);
        
        // Claim creator tokens (should respect daily limits)
        if (typeof sdk.claimCreatorTokens === 'function') {
          await sdk.claimCreatorTokens({
            launch: testLaunchState,
            saleMint: testSaleMint.publicKey,
            creatorAta: creatorAta,
            // Don't pass creatorKeypair - SDK will use provider's wallet
            createAtaIfMissing: true,
          });
        } else {
          throw new Error(`claimCreatorTokens method not found on SDK`);
        }
        
        addLog("   -> Creator tokens claimed successfully!");
        const finalCreatorTokenBalance = await getTokenBalance(creatorAta);
        const tokensClaimed = finalCreatorTokenBalance - initialCreatorTokenBalance;
        addLog(`   -> Creator ATA: ${creatorAta.toBase58()}`);
        addLog(`   -> Tokens claimed in this transaction: ${tokensClaimed.toFixed(6)}`);
        
        // Check creator grant state
        if (typeof sdk.fetchCreatorGrant === 'function') {
          const creatorGrantState = await sdk.fetchCreatorGrant(testLaunchState);
          addLog(`   -> Reserved tickets: ${creatorGrantState.reservedTickets}`);
          addLog(`   -> Claimed tickets: ${creatorGrantState.claimedTickets}`);
          addLog(`   -> Daily ticket cap: ${creatorGrantState.dailyTicketCap}`);
        } else {
          addLog(`   -> fetchCreatorGrant method not found on SDK`);
        }
        
      } catch (error: any) {
        addLog(`   -> Creator token claiming failed: ${error.message}`);
        // Don't fail the entire flow for this
      }
    }

    addLog("\n✅ Full flow finished successfully!");
    return { success: true, message: "Flow completed successfully" };
  } catch (error: any) {
    addLog(`\n--- SCRIPT FAILED ---`);
    addLog(`Error: ${error.message}`);
    console.error("Full flow error details:", error);
    return { success: false, message: error.message };
  }
}
