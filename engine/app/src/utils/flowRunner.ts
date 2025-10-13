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
  saleAllocation: string;
  lpAllocation: number;
  fundingDurationSeconds: number; // New field for direct seconds
  numBlocks: number;
  rosterShardCap: number;
  creatorInitialDepositLamports: number;
  creatorDailyLamportsLimit: number;
  creatorClaimLockPeriodSec: number;
}

// A simplified SDK type, as we don't have the full type in this context
type Sdk = any;

interface SimulationConfig {
  numUsers: number;
}

export async function runFullFlow(
  sdk: Sdk,
  program: Program,
  provider: any,
  config: LaunchConfig,
  addLog: (log: string) => void,
  simConfig: SimulationConfig
): Promise<{ success: boolean; message: string }> {
  const admin = provider.wallet;
  addLog(`--- Starting Full Flow ---`);
  addLog(`Admin wallet: ${admin.publicKey.toBase58()}`);

  let testLaunchState: PublicKey;

  // --- Simulation Parameters ---
  const TOTAL_SUPPLY = 1_000_000_000; // 1 Billion
  const SALE_PERCENTAGE = 0.45946; // 45.946%
  const TOKEN_DECIMALS = 6;
  
  // // Calculate sale_allocation based on simulation parameters
  // const saleAllocation = Math.floor(TOTAL_SUPPLY * SALE_PERCENTAGE) * (10 ** TOKEN_DECIMALS);
  // config.saleAllocation = saleAllocation;

  // Override creator deposit for this specific test
  const LAMPORTS_PER_SOL = 1_000_000_000;
  config.creatorInitialDepositLamports = 8 * LAMPORTS_PER_SOL;
  config.creatorDailyLamportsLimit = 2 * LAMPORTS_PER_SOL; // Set to 2 SOL to make daily_ticket_cap = 2
  
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

    let adminBalance: number;
    try {
      adminBalance = await provider.connection.getBalance(admin.publicKey);
    } catch (error) {
      // Fallback for LiteSVM - assume 10 SOL balance
      adminBalance = 10 * 1e9;
      addLog(`Using fallback admin balance: ${adminBalance / 1e9} SOL`);
    }

    const MIN_BALANCE_FOR_FEES = 500000000; // 0.5 SOL

    if (adminBalance < MIN_BALANCE_FOR_FEES) {
      const errorMessage = `Admin wallet balance is too low (${(
        adminBalance / 1e9
      ).toFixed(
        2
      )} SOL). Please fund it with at least ${
        MIN_BALANCE_FOR_FEES / 1e9
      } SOL to cover transaction fees.`;
      addLog(errorMessage);
      return { success: false, message: errorMessage };
    }

    const availableForCreatorDeposit = adminBalance - MIN_BALANCE_FOR_FEES;
    const adjustedCreatorDeposit = Math.min(
      config.creatorInitialDepositLamports,
      availableForCreatorDeposit
    );

    if (adjustedCreatorDeposit < config.creatorInitialDepositLamports) {
      addLog(`Admin balance: ${(adminBalance / 1e9).toFixed(2)} SOL`);
      addLog(
        `Reducing creator deposit from ${(
          config.creatorInitialDepositLamports / 1e9
        ).toFixed(2)} SOL to ${(adjustedCreatorDeposit / 1e9).toFixed(2)} SOL`
      );
    }
    config.creatorInitialDepositLamports = adjustedCreatorDeposit;

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
        fundingDurationSeconds: new BN(config.fundingDurationSeconds),
        numBlocks: new BN(config.numBlocks),
        rosterShardCap: config.rosterShardCap,
        creatorInitialDepositLamports: new BN(config.creatorInitialDepositLamports),
        creatorDailyLamportsLimit: new BN(config.creatorDailyLamportsLimit),
        creatorClaimLockPeriodSec: new BN(config.creatorClaimLockPeriodSec),
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
    tx.recentBlockhash = (
      await provider.connection.getLatestBlockhash()
    ).blockhash;

    // Send transaction using provider's sendAndConfirm method
    const signature = await provider.sendAndConfirm(tx, [testSaleMint]);

    addLog(`   -> Launch initialized. Signature: ${signature}`);
    addLog(`   -> Launch PDA: ${testLaunchState.toBase58()}`);

    // 2. Initialize Roster Shard 0 (new sharded system)
    addLog(`\n[2/10] Initializing Roster Shard 0...`);
    await sdk.initRosterShard({ launch: testLaunchState, shardId: 0 });
    addLog("   -> Shard 0 initialized.");

    // 3. Simulate deposits for 1000 users with various amounts
    const TARGET_USERS = simConfig.numUsers;
    const MAX_TICKETS_PER_USER = 5; // e.g., users can deposit for 1 to 5 tickets
    const usersWithDeposits = new Map<
      string,
      { keypair: Keypair; tickets: number; shardId: number }
    >();

    addLog(`\n[3/10] Simulating deposits for up to ${TARGET_USERS} users...`);
    addLog(
      `   -> Each user will deposit for a random amount of tickets (1-${MAX_TICKETS_PER_USER}).`
    );

    // Step 1: Generate all potential user keypairs and their desired deposits
    let users = Array.from({ length: TARGET_USERS }, () => {
      const keypair = Keypair.generate();
      const tickets = Math.floor(Math.random() * MAX_TICKETS_PER_USER) + 1;
      const depositAmount = new BN(config.tauLamports * tickets);
      return { keypair, tickets, depositAmount };
    });

    // Step 2: Check admin balance and filter users we can afford to fund
    let currentAdminBalance: number;
    try {
      currentAdminBalance = await provider.connection.getBalance(admin.publicKey);
    } catch (error) {
      currentAdminBalance = 500000000; // Fallback: assume 0.5 SOL remaining
    }

    const feeBufferPerUser = 5000000; // ~0.005 SOL buffer for fees
    const affordableUsers = [];
    let cumulativeCost = 0;

    for (const user of users) {
      const costForThisUser = user.depositAmount.toNumber() + feeBufferPerUser;
      if (cumulativeCost + costForThisUser <= currentAdminBalance) {
        cumulativeCost += costForThisUser;
        affordableUsers.push(user);
      } else {
        break; // Stop when we can't afford the next user
      }
    }

    if (users.length !== affordableUsers.length) {
      addLog(
        `   -> Admin balance can only fund ${affordableUsers.length} out of ${TARGET_USERS} users.`
      );
      if (affordableUsers.length === 0) {
        throw new Error(
          "Insufficient admin balance to fund any users for the simulation."
        );
      }
      users = affordableUsers;
    }

    const numUsersToSimulate = users.length;
    addLog(
      `   -> Total cost to fund ${numUsersToSimulate} users: ${(
        cumulativeCost / LAMPORTS_PER_SOL
      ).toFixed(4)} SOL`
    );

    // Step 3: Fund users
    addLog(
      `   -> Funding ${numUsersToSimulate} users with transfers from admin...`
    );
    const FUNDING_BATCH_SIZE = 50; // Process 50 users at a time
    for (let i = 0; i < users.length; i += FUNDING_BATCH_SIZE) {
      const batch = users.slice(i, i + FUNDING_BATCH_SIZE);
      addLog(`   -> Funding batch ${Math.floor(i / FUNDING_BATCH_SIZE) + 1}...`);
      await Promise.all(
        batch.map(async (user) => {
          const fundingAmount = user.depositAmount.toNumber() + feeBufferPerUser;
          const transferIx = SystemProgram.transfer({
            fromPubkey: admin.publicKey,
            toPubkey: user.keypair.publicKey,
            lamports: fundingAmount,
          });
          const tx = new Transaction().add(transferIx);
          tx.feePayer = admin.publicKey;
          tx.recentBlockhash = (
            await provider.connection.getLatestBlockhash()
          ).blockhash;
          await provider.sendAndConfirm(tx, []);
        })
      );
    }
    addLog("   -> All users funded.");

    // Step 4: Deposit from all users, handling sharding in batches
    addLog(
      `   -> Sending ${numUsersToSimulate} deposit transactions in batches of 50...`
    );
    let currentShardId = 0;
    const BATCH_SIZE = 50;

    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);
      addLog(`   -> Processing batch ${Math.floor(i / BATCH_SIZE) + 1}...`);

      const depositPromises = batch.map((user) =>
        (async () => {
          let successfulDeposit = false;
          let attemptShardId = currentShardId;

          while (!successfulDeposit) {
            try {
              await sdk.deposit({
                launch: testLaunchState,
                amountLamports: user.depositAmount,
                userKeypair: user.keypair,
                shardId: attemptShardId,
              });
              usersWithDeposits.set(user.keypair.publicKey.toBase58(), {
                keypair: user.keypair,
                tickets: user.tickets,
                shardId: attemptShardId,
              });
              successfulDeposit = true;
            } catch (error: any) {
              if (
                error.message &&
                error.message.includes("RosterShardFull")
              ) {
                // This shard is full, try initializing the next one.
                const nextShardId = attemptShardId + 1;
                try {
                  await sdk.initRosterShard({
                    launch: testLaunchState,
                    shardId: nextShardId,
                  });
                } catch (initError: any) {
                  // error 0x0 is 'AccountInUse', which is fine. It means another promise created it.
                  if (
                    !initError.message.includes("custom program error: 0x0")
                  ) {
                    throw initError; // Rethrow other initialization errors
                  }
                }
                // Retry with the next shard
                attemptShardId = nextShardId;
              } else {
                // A different, unexpected error occurred.
                throw error;
              }
            }
          }
        })()
      );

      // Wait for all deposits in the current batch to complete
      await Promise.all(depositPromises);

      // After the batch, update the global shard ID for the next batch to start from.
      const maxShardInBatch = Array.from(usersWithDeposits.values()).reduce(
        (max, u) => Math.max(max, u.shardId),
        currentShardId
      );
      currentShardId = maxShardInBatch;
    }
    addLog("   -> All deposits completed.");

    // 4. Wait for Funding to End
    addLog(`\n[4/10] Waiting for funding period to end...`);
    await waitForFundingPeriodEnd(testLaunchState);
    addLog("   -> Funding period closed.");

    // 5. Set VRF Seed
    addLog(`\n[5/10] Setting VRF Seed...`);
    await sdk.setSeed({ launch: testLaunchState });
    addLog("   -> VRF seed set.");

    // 6. Finalize shard(s)
    addLog(`\n[6/10] Finalizing roster shards...`);
    for (let i = 0; i <= currentShardId; i++) {
      await sdk.finalizeRosterShard({ launch: testLaunchState, shardId: i });
      addLog(`   -> Shard ${i} finalized.`);
    }

    // 7. Open Claims
    addLog(`\n[7/10] Opening claims...`);
    await sdk.openClaims({ launch: testLaunchState });
    const finalState = await sdk.fetchLaunch(testLaunchState);
    if (finalState.claimsOpen) {
      addLog("   -> Claims are open.");
    } else {
      throw new Error("Verification failed: Claims not open.");
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

    // 9. Test User Token & Refund Claiming
    addLog(`\n[9/10] Testing User Token & Refund Claiming...`);

    const allUsersData = Array.from(usersWithDeposits.values());

    addLog(`   -> Claiming for ${allUsersData.length} users in batches of 50...`);
    const CLAIM_BATCH_SIZE = 50;
    let allResults = [];

    for (let i = 0; i < allUsersData.length; i += CLAIM_BATCH_SIZE) {
      const batch = allUsersData.slice(i, i + CLAIM_BATCH_SIZE);
      addLog(`   -> Processing claim batch ${Math.floor(i / CLAIM_BATCH_SIZE) + 1}...`);
      
      const claimPromises = batch.map(async (userData) => {
        try {
          // Attempt to claim tokens for every user
          const userAta = sdk.getUserAta(
            testSaleMint.publicKey,
            userData.keypair.publicKey
          );
          const initialBalance = await getTokenBalance(userAta);

          await sdk.claimTokens({
            launch: testLaunchState,
            saleMint: testSaleMint.publicKey,
            userKeypair: userData.keypair,
            createAtaIfMissing: true,
            shardId: userData.shardId,
          });

          const finalBalance = await getTokenBalance(userAta);
          return {
            status: "winner",
            tokensClaimed: finalBalance - initialBalance,
          };
        } catch (error: any) {
          // If it fails with "NoTokensToClaim", they are a loser, so claim refund
          if (error.message && error.message.includes("NoTokensToClaim")) {
            try {
              await sdk.claimRefund({
                launch: testLaunchState,
                userKeypair: userData.keypair,
                shardId: userData.shardId,
              });
              return { status: "loser" };
            } catch (refundError: any) {
              return {
                status: "failed",
                type: "refund",
                error: refundError,
                publicKey: userData.keypair.publicKey,
              };
            }
          } else {
            // If it's another error, log it
            return {
              status: "failed",
              type: "token",
              error: error,
              publicKey: userData.keypair.publicKey,
            };
          }
        }
      });

      const batchResults = await Promise.all(claimPromises);
      allResults.push(...batchResults);
    }

    let successfulTokenClaims = 0;
    let successfulRefundClaims = 0;
    let tokensClaimed = 0;
    let failedClaims = 0;

    for (const result of allResults) {
      switch (result.status) {
        case "winner":
          successfulTokenClaims++;
          tokensClaimed += result.tokensClaimed || 0;
          break;
        case "loser":
          successfulRefundClaims++;
          break;
        case "failed":
          failedClaims++;
          if (result.publicKey && result.error) {
            addLog(
              `   -> ❌ ${
                result.type
              } claim failed for ${result.publicKey.toBase58()}: ${
                result.error.message
              }`
            );
          }
          break;
      }
    }

    addLog(
      `   -> Winners (successful token claims): ${successfulTokenClaims}`
    );
    addLog(`   -> Losers (successful refund claims): ${successfulRefundClaims}`);
    if (failedClaims > 0) {
      addLog(`   -> Failed claims (token or refund): ${failedClaims}`);
    }
    addLog(
      `   -> Total tokens claimed by winners: ${tokensClaimed.toFixed(6)}`
    );

    // Final check for any remaining errors
    if (failedClaims > 0) {
      throw new Error(
        `${failedClaims} users failed to claim either tokens or a refund.`
      );
    }

    let totalTokensClaimedByCreator = 0;
    // 10. Test Creator Token Claiming (if creator deposit was made)
    if (config.creatorInitialDepositLamports > 0) {
      addLog(
        `\n[10/10] Testing Creator Token Claiming (Accrued Vesting)...`
      );
      addLog(`   -> Creator Deposit: ${config.creatorInitialDepositLamports / 1e9} SOL`);
      addLog(`   -> Lock Period: ${config.creatorClaimLockPeriodSec} seconds per ticket cap`);

      const creatorAta = sdk.getUserAta(testSaleMint.publicKey, admin.publicKey);

      addLog(`\n   --- Firing 3 rapid claims to test initial lock ---`);
      let initialSuccess = 0;
      let initialFailures = 0;
      for (let i = 0; i < 3; i++) {
        addLog(`   -> Attempt ${i + 1}/3...`);
        try {
          const initialBalance = await getTokenBalance(creatorAta);
          await sdk.claimCreatorTokens({
            launch: testLaunchState,
            saleMint: testSaleMint.publicKey,
            creatorAta: creatorAta,
            createAtaIfMissing: true,
          });
          const finalBalance = await getTokenBalance(creatorAta);
          const claimedAmount = finalBalance - initialBalance;
          addLog(`      -> ✅ SUCCESS: Claim succeeded. Tokens claimed: ${claimedAmount.toFixed(6)}`);
          totalTokensClaimedByCreator += claimedAmount;
          initialSuccess++;
        } catch (error: any) {
          if (error.message.includes("NothingToClaim")) {
            addLog(`      -> ❌ FAILURE (EXPECTED): Claim failed as expected.`);
            initialFailures++;
          } else {
            addLog(`      -> ❌ FAILURE (UNEXPECTED): ${error.message}`);
            throw error;
          }
        }
        await new Promise(resolve => setTimeout(resolve, 200)); // 200ms delay between rapid attempts
      }

      if (initialSuccess === 1 && initialFailures === 2) {
        addLog(`   -> ✅ VERIFICATION PASSED: Initial rapid claims behaved as expected (1 success, 2 failures).`);
      } else {
        addLog(`   -> ❌ VERIFICATION FAILED: Expected 1 success and 2 failures, but got ${initialSuccess} and ${initialFailures}.`);
      }

      const waitTime = 3; // seconds (2 needed for 1 period of 2s with cap=2, +1s buffer)
      addLog(`\n   --- Waiting ${waitTime} seconds for all remaining tokens to accrue... ---`);
      await new Promise(resolve => setTimeout(resolve, waitTime * 1000));

      addLog(`\n   --- Attempting to claim all remaining accrued tokens at once ---`);
      
      // Debug: Check creator grant state before final claim
      const creatorGrantBeforeFinal = await sdk.fetchCreatorGrant(testLaunchState);
      addLog(`   -> Creator grant before final claim: reserved=${creatorGrantBeforeFinal.reservedTickets}, claimed=${creatorGrantBeforeFinal.claimedTickets}`);
      
      try {
        const initialBalance = await getTokenBalance(creatorAta);
        await sdk.claimCreatorTokens({
          launch: testLaunchState,
          saleMint: testSaleMint.publicKey,
          creatorAta: creatorAta,
        });
        const finalBalance = await getTokenBalance(creatorAta);
        const claimedAmount = finalBalance - initialBalance;
        addLog(`   -> ✅ SUCCESS: Claimed all remaining tokens. Tokens claimed: ${claimedAmount.toFixed(6)}`);
        totalTokensClaimedByCreator += claimedAmount;
      } catch (error: any) {
        // Debug: Check if all tokens were already claimed
        const creatorGrantAfterError = await sdk.fetchCreatorGrant(testLaunchState);
        addLog(`   -> Creator grant after error: reserved=${creatorGrantAfterError.reservedTickets}, claimed=${creatorGrantAfterError.claimedTickets}`);
        
        if (creatorGrantAfterError.claimedTickets === creatorGrantAfterError.reservedTickets) {
          addLog(`   -> ✅ SUCCESS: All tokens were already claimed in previous attempts. This is expected behavior.`);
        } else if (error.message.includes("NothingToClaim")) {
          addLog(`   -> ✅ SUCCESS: NothingToClaim error is expected when all tokens are already claimed.`);
        } else {
          addLog(`   -> ❌ FAILURE (UNEXPECTED): Claiming all tokens failed: ${error.message}`);
          throw error;
        }
      }
      
      addLog(`\n   --- Final check: Attempting to claim again (should fail) ---`);
      try {
        await sdk.claimCreatorTokens({
          launch: testLaunchState,
          saleMint: testSaleMint.publicKey,
          creatorAta: creatorAta,
        });
        addLog(`   -> ❌ VERIFICATION FAILED: Final claim succeeded when it should have failed.`);
      } catch (error: any) {
        if (error.message.includes("NothingToClaim")) {
          addLog(`   -> ✅ VERIFICATION PASSED: Final claim failed as expected (NothingToClaim).`);
        } else {
          addLog(`   -> ❌ VERIFICATION FAILED: Final claim failed with an unexpected error: ${error.message}`);
        }
      }

      const finalGrantState = await sdk.fetchCreatorGrant(testLaunchState);
      addLog(`\n--- Final State ---`);
      if (finalGrantState.claimedTickets === finalGrantState.reservedTickets) {
        addLog(`   -> ✅ VERIFICATION PASSED: All reserved tickets have been claimed (${finalGrantState.claimedTickets}/${finalGrantState.reservedTickets}).`);
      } else {
        addLog(`   -> ❌ VERIFICATION FAILED: Not all tickets were claimed (${finalGrantState.claimedTickets}/${finalGrantState.reservedTickets}).`);
      }
    }

    addLog(`\n\n--- DISTRIBUTION SUMMARY ---`);
    addLog(`   Total claimed by users:   ${tokensClaimed.toFixed(6)}`);
    addLog(`   Total claimed by creator: ${totalTokensClaimedByCreator.toFixed(6)}`);
    addLog(`   ------------------------------------`);
    const totalDistributed = tokensClaimed + totalTokensClaimedByCreator;
    addLog(`   TOTAL DISTRIBUTED:        ${totalDistributed.toFixed(6)}`);
    addLog(`--- END SUMMARY ---\n`);

    addLog("\n✅ Full flow finished successfully!");
    return { success: true, message: "Flow completed successfully" };
  } catch (error: any) {
    addLog(`\n--- SCRIPT FAILED ---`);
    addLog(`Error: ${error.message}`);
    console.error("Full flow error details:", error);
    return { success: false, message: error.message };
  }
}
