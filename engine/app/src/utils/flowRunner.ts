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
} from "@solana/spl-token";

interface LaunchConfig {
  hardCapLamports: number;
  minRaiseLamports: number;
  perWalletCap: number;
  tauLamports: number;
  saleAllocation: string;
  lpAllocation: number;
  fundingDurationSeconds: number; // New field for direct seconds
  unlockTimeSec: number;
  rosterShardCap: number;
  creatorInitialDepositLamports: number;
  creatorDailyLamportsLimit: number;
  creatorClaimLockPeriodSec: number;
  // Optional Raydium CLMM config for pool creation
  quoteMint?: string; // defaults to WSOL if not provided
  ammConfig?: string; // required to actually create pool
  clmmProgram?: string; // required to actually create pool
}

// A simplified SDK type, as we don't have the full type in this context
type Sdk = any;

interface SimulationConfig {
  numUsers: number;
  maxTicketsPerUser: number;
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
  const adminInitialBalance = await provider.connection.getBalance(admin.publicKey);
  let userFundingCost = 0;

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
      )} SOL). Please fund it with at least ${MIN_BALANCE_FOR_FEES / 1e9
        } SOL to cover transaction fees.`;
      addLog(errorMessage);
      return { success: false, message: errorMessage };
    }

    const availableForCreatorDeposit = adminBalance - MIN_BALANCE_FOR_FEES;
    const adjustedCreatorDeposit = Math.min(
      config.creatorInitialDepositLamports,
      availableForCreatorDeposit
    );
    userFundingCost += config.creatorInitialDepositLamports - adjustedCreatorDeposit;


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

    const MINT_RENT = 2039280; // Fixed rent exemption for 82 bytes

    // 1. Initialize Launch
    addLog(`[1/10] Initializing Launch...`);

    const balanceBeforeLaunch = await provider.connection.getBalance(admin.publicKey);

    // Debug: Check available methods
    addLog(`Available SDK methods: ${Object.keys(sdk).join(', ')}`);

    const testBaseMint = Keypair.generate();
    [testLaunchState] = sdk.getLaunchPda(testBaseMint.publicKey);
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

    // Note: base mint account will be created during CLMM pool creation; only pass its pubkey as seed here

    // Ensure funding period is long enough for simulated deposits (dynamic estimate)
    const estFundingBatches = Math.ceil(simConfig.numUsers / 50); // FUNDING_BATCH_SIZE
    const estDepositBatches = Math.ceil(simConfig.numUsers / 50); // BATCH_SIZE
    const estSec = estFundingBatches * 2 + estDepositBatches * 3 + 5; // ~2s per funding batch, ~3s per deposit batch + overhead
    const estClamped = Math.max(15, Math.min(estSec, 90));
    const cfgSec = typeof config.fundingDurationSeconds === 'number' ? config.fundingDurationSeconds : 0;
    const fundingDurationSeconds = Math.max(15, Math.min(cfgSec || estClamped, estClamped));

    // Add main instruction
    // Mirror LiteSVM: derive baseTotalAllocation/baseSaleBasisPoints from sale/lp
    const saleAllocBN = new BN(config.saleAllocation);
    const lpAllocBN = new BN(String(config.lpAllocation));
    const baseTotalAllocationBN = saleAllocBN.add(lpAllocBN);
    const baseSaleBpsBN = baseTotalAllocationBN.isZero()
      ? new BN(0)
      : new BN(Math.floor(saleAllocBN.toNumber() * 10000 / baseTotalAllocationBN.toNumber()));

    if (lpAllocBN.isZero()) {
      throw new Error("Invalid config: lpAllocation is zero; LP must be > 0");
    }

    const initLaunchIx = await program.methods
      .initLaunch({
        hardCapLamports: new BN(config.hardCapLamports),
        minRaiseLamports: new BN(config.minRaiseLamports),
        perWalletCap: new BN(config.perWalletCap),
        tauLamports: new BN(config.tauLamports),
        baseTotalAllocation: baseTotalAllocationBN,
        baseSaleBasisPoints: baseSaleBpsBN,
        fundingDurationSeconds: new BN(fundingDurationSeconds),
        unlockTimeSec: new BN(config.unlockTimeSec),
        rosterShardCap: config.rosterShardCap,
        creatorInitialDepositLamports: new BN(config.creatorInitialDepositLamports),
        creatorDailyLamportsLimit: new BN(config.creatorDailyLamportsLimit),
        creatorClaimLockPeriodSec: new BN(config.creatorClaimLockPeriodSec),
      })
      .accountsStrict({
        creator: admin.publicKey,
        projectCounter,
        launchState: testLaunchState,
        baseMint: testBaseMint.publicKey,
        escrowAuthority: escrow,
        creatorGrant,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    tx.add(initLaunchIx);

    // Set fee payer and recent blockhash
    tx.feePayer = admin.publicKey;
    tx.recentBlockhash = (
      await provider.connection.getLatestBlockhash()
    ).blockhash;

    // Send transaction using provider's sendAndConfirm method
    const signature = await provider.sendAndConfirm(tx, []);

    const balanceAfterLaunch = await provider.connection.getBalance(admin.publicKey);
    const grossLaunchCost = balanceBeforeLaunch - balanceAfterLaunch;
    const launchTxFees = grossLaunchCost - config.creatorInitialDepositLamports - MINT_RENT;


    addLog(`   -> Launch initialized. Signature: ${signature}`);
    addLog(`   -> Launch PDA: ${testLaunchState.toBase58()}`);

    // 2. Pre-initialize all necessary roster shards
    const numShards = Math.ceil(simConfig.numUsers / config.rosterShardCap);
    addLog(
      `\n[2/10] Calculated ${numShards} shards needed for ${simConfig.numUsers} users with a capacity of ${config.rosterShardCap}. Initializing...`
    );
    const balanceBeforeShards = await provider.connection.getBalance(admin.publicKey);
    for (let i = 0; i < numShards; i++) {
      try {
        await sdk.initRosterShard({ launch: testLaunchState, shardId: i });
        addLog(`   -> Shard ${i} initialized.`);
      } catch (error: any) {
        // This might happen if another process initialized it, which is fine.
        if (error.message && error.message.includes("custom program error: 0x0")) {
          addLog(`   -> Shard ${i} was already initialized.`);
        } else {
          throw error;
        }
      }
    }

    const balanceAfterShards = await provider.connection.getBalance(admin.publicKey);
    const shardCreationCost = balanceBeforeShards - balanceAfterShards;

    // 3. Simulate deposits for 1000 users with various amounts
    const TARGET_USERS = simConfig.numUsers;
    const MAX_TICKETS_PER_USER = simConfig.maxTicketsPerUser; // Use value from simConfig
    const usersWithDeposits = new Map<
      string,
      { keypair: Keypair; tickets: number; shardId: number }
    >();

    addLog(`\n[3/10] Simulating deposits for up to ${TARGET_USERS} users...`);
    addLog(
      `   -> Each user will deposit for a random amount of tickets (1-${MAX_TICKETS_PER_USER}).`
    );

    // Step 1: Generate all potential user keypairs and their desired deposits
    let users = Array.from({ length: TARGET_USERS }, (_, i) => {
      const keypair = Keypair.generate();
      const tickets = Math.floor(Math.random() * MAX_TICKETS_PER_USER) + 1;
      const depositAmount = new BN(config.tauLamports * tickets);
      const shardId = Math.floor(i / config.rosterShardCap);
      return { keypair, tickets, depositAmount, shardId };
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
    userFundingCost += cumulativeCost;

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

    // Step 4: Deposit from all users, using pre-calculated shard IDs
    addLog(
      `   -> Sending ${numUsersToSimulate} deposit transactions in batches of 50...`
    );
    const BATCH_SIZE = 50;

    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);
      addLog(`   -> Processing batch ${Math.floor(i / BATCH_SIZE) + 1}...`);

      const depositPromises = batch.map((user) =>
        (async () => {
          try {
            await sdk.deposit({
              launch: testLaunchState,
              amountLamports: user.depositAmount,
              userKeypair: user.keypair,
              shardId: user.shardId, // Use pre-calculated shard ID
            });
            usersWithDeposits.set(user.keypair.publicKey.toBase58(), {
              keypair: user.keypair,
              tickets: user.tickets,
              shardId: user.shardId,
            });
          } catch (error: any) {
            addLog(
              `   -> ❌ Deposit failed for user in shard ${user.shardId}: ${error.message}`
            );
            // Stop the simulation on failure to prevent cascading issues.
            throw new Error(
              `Deposit failed for user ${user.keypair.publicKey.toBase58()} in shard ${user.shardId
              }: ${error.message}`
            );
          }
        })()
      );

      // Wait for all deposits in the current batch to complete
      await Promise.all(depositPromises);
    }
    addLog("   -> All deposits completed.");

    // 4. Wait for Funding to End
    addLog(`\n[4/10] Waiting for funding period to end...`);
    await waitForFundingPeriodEnd(testLaunchState);
    addLog("   -> Funding period closed.");

    const balanceBeforeCranking = await provider.connection.getBalance(admin.publicKey);

    // 5. Set VRF Seed
    addLog(`\n[5/10] Setting VRF Seed...`);
    await sdk.setSeed({ launch: testLaunchState });
    addLog("   -> VRF seed set.");

    // 6. Finalize shard(s)
    addLog(`\n[6/10] Finalizing roster shards...`);
    for (let i = 0; i < numShards; i++) {
      await sdk.finalizeRosterShard({ launch: testLaunchState, shardId: i });
      addLog(`   -> Shard ${i} finalized.`);
    }

    // 7. Create Pool (prepare, Raydium CLMM creation, add liquidity)
    addLog(`\n[7/10] Creating Pool...`);
    let prepared = false;
    for (let i = 0; i < 60; i++) {
      try {
        await sdk.preparePoolCreation({ launch: testLaunchState, computeUnits: 2_000_000 });
        prepared = true;
        addLog("   -> preparePoolCreation succeeded (valid recent blockhash found). ");
        break;
      } catch (e: any) {
        const msg = (e && e.message) ? String(e.message) : "";
        if (msg.includes("NoValidBlockhash")) {
          if (i === 0) addLog("   -> Waiting for a valid recent blockhash (retrying up to 60s)...");
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        throw e;
      }
    }
    if (!prepared) throw new Error("No valid recent blockhash observed within retry window");

    // If Raydium config is provided, create CLMM pool and add liquidity
    const wsolMint = new PublicKey("So11111111111111111111111111111111111111112");
    const quoteMintPk = config.quoteMint ? new PublicKey(config.quoteMint) : wsolMint;

    // Auto-select Raydium IDs when not provided
    const endpoint = (provider as any)?.connection?.rpcEndpoint || "";
    const isMainnet = /mainnet/i.test(endpoint);
    const defaultClmm = isMainnet
      ? new PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK")
      : new PublicKey("DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH");
    const defaultAmm = isMainnet
      ? new PublicKey("2QdhepnKRTLjjSqPL1PtKNwqrUkoLee5Gqs8bvZhRdMv")
      : new PublicKey("CD4aJtX11cqTCAc83nxSPkkh5JW2yjD6uwHeovjqQ1qu");

    let ammConfigPk = new PublicKey(config.ammConfig || defaultAmm);
    let clmmProgramPk = new PublicKey(config.clmmProgram || defaultClmm);

    if (!config.ammConfig || !config.clmmProgram) {
      addLog("   -> Raydium config not provided; using defaults for network.");
      addLog(`      - CLMM Program: ${clmmProgramPk.toBase58()}`);
      addLog(`      - AmmConfig:   ${ammConfigPk.toBase58()}`);
    }

    // Preflight: ensure AmmConfig exists and owner matches CLMM program id. If not, try alt defaults.
    const tryResolveAmmConfig = async () => {
      const info = await provider.connection.getAccountInfo(ammConfigPk);
      if (info && info.owner.equals(clmmProgramPk)) return;
      // Try alternate pair (switch mainnet/devnet defaults)
      const altClmm = clmmProgramPk.equals(defaultClmm) ? (isMainnet ? defaultClmm : new PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK")) : defaultClmm;
      const altAmm = ammConfigPk.equals(defaultAmm) ? (isMainnet ? defaultAmm : new PublicKey("2QdhepnKRTLjjSqPL1PtKNwqrUkoLee5Gqs8bvZhRdMv")) : defaultAmm;
      const altInfo = await provider.connection.getAccountInfo(altAmm);
      if (altInfo && altInfo.owner.equals(altClmm)) {
        addLog("   -> Switching to alternate Raydium IDs based on on-chain owner match.");
        clmmProgramPk = altClmm;
        ammConfigPk = altAmm;
        addLog(`      - CLMM Program: ${clmmProgramPk.toBase58()}`);
        addLog(`      - AmmConfig:   ${ammConfigPk.toBase58()}`);
        return;
      }
      // If still mismatch, emit guidance and abort
      const observedOwner = info ? info.owner.toBase58() : "<missing>";
      const expectedOwner = clmmProgramPk.toBase58();
      const msg = `AmmConfig owner mismatch: owner=${observedOwner}, expected=${expectedOwner}. Ensure your local validator loads Raydium program and AmmConfig for the same network (use NET=mainnet-beta or NET=devnet in validator scripts), or pass matching ammConfig/clmmProgram in config.`;
      addLog(`   -> ${msg}`);
      throw new Error(msg);
    };
    await tryResolveAmmConfig();

    addLog("   -> Creating Raydium CLMM pool via SDK...");
    const clmm = await sdk.createClmmPool({
      launch: testLaunchState,
      quoteMint: quoteMintPk,
      baseMint: testBaseMint,
      ammConfig: ammConfigPk,
      clmmProgram: clmmProgramPk,
    });
    addLog(`      - CLMM create signature: ${clmm.signature}`);
    addLog("   -> Adding initial liquidity to CLMM pool...");
    const addLiq = await sdk.addClmmLiquidityTx({
      payer: admin.publicKey,
      launch: testLaunchState,
      quoteMint: quoteMintPk,
      baseMint: testBaseMint.publicKey,
      baseTokenAta: clmm.baseTokenAta,
      ammConfig: ammConfigPk,
      clmmProgram: clmmProgramPk,
      provider,
    });
    const addLiqSig = await provider.sendAndConfirm(addLiq.transaction, addLiq.signers || []);
    addLog(`      - Liquidity add signature: ${addLiqSig}`);

    // 8. Verify claims (opened by pool liquidity); if Raydium was skipped, abort before claims
    addLog(`\n[8/10] Verifying claims availability...`);
    const finalLaunchState = await sdk.fetchLaunch(testLaunchState);
    if (!config.ammConfig || !config.clmmProgram) {
      if (!finalLaunchState.claimsOpen) {
        const msg = "Raydium config missing; claims stay closed until pool is created and liquidity is added.";
        addLog(`   -> ${msg}`);
        return { success: false, message: msg };
      }
    }
    if (finalLaunchState.claimsOpen) {
      addLog("   -> Claims are open.");
    } else {
      throw new Error("Verification failed: Claims not open after pool/liquidity.");
    }

    const balanceAfterCranking = await provider.connection.getBalance(admin.publicKey);
    const crankingCost = balanceBeforeCranking - balanceAfterCranking;

    // 9. Test User Token & Refund Claiming (must be after pool created)
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
            testBaseMint.publicKey,
            userData.keypair.publicKey
          );
          const initialBalance = await getTokenBalance(userAta);

          await sdk.claimTokens({
            launch: testLaunchState,
            baseMint: testBaseMint.publicKey,
            userKeypair: userData.keypair,
            createAtaIfMissing: true,
            shardId: userData.shardId,
            computeUnits: 2_000_000,
          });

          const finalBalance = await getTokenBalance(userAta);
          return {
            status: "winner",
            tokensClaimed: finalBalance - initialBalance,
            tickets: userData.tickets,
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
              return { status: "loser", tickets: userData.tickets };
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
    let winningTickets = 0;
    let losingTickets = 0;

    for (const result of allResults) {
      switch (result.status) {
        case "winner":
          successfulTokenClaims++;
          tokensClaimed += result.tokensClaimed || 0;
          winningTickets += result.tickets || 0;
          break;
        case "loser":
          successfulRefundClaims++;
          losingTickets += result.tickets || 0;
          break;
        case "failed":
          failedClaims++;
          if (result.publicKey && result.error) {
            addLog(
              `   -> ❌ ${result.type
              } claim failed for ${result.publicKey.toBase58()}: ${result.error.message
              }`
            );
          }
          break;
      }
    }

    const totalTicketsInSystem = winningTickets + losingTickets;
    const actualWinRate = totalTicketsInSystem > 0 ? (winningTickets / totalTicketsInSystem) * 100 : 0;

    addLog(`   -> Winners (successful token claims): ${successfulTokenClaims} users (${winningTickets} winning tickets)`);
    addLog(`   -> Losers (successful refund claims): ${successfulRefundClaims} users (${losingTickets} losing tickets)`);
    if (failedClaims > 0) {
      addLog(`   -> Failed claims (token or refund): ${failedClaims}`);
    }
    addLog(
      `   -> Total tokens claimed by winners: ${tokensClaimed.toFixed(6)}`
    );
    addLog(`   -> Win rate: ${actualWinRate.toFixed(2)}% of tickets won`);

    // --- Winning Algorithm Debug ---
    const launchStateForDebug = await sdk.fetchLaunch(testLaunchState);
    const n = launchStateForDebug.totalTickets;
    const k = launchStateForDebug.kCapacity;
    const creatorGrantForDebug = await sdk.fetchCreatorGrant(testLaunchState);
    const reservedTickets = creatorGrantForDebug.reservedTickets;
    const k_pub = k - reservedTickets;
    const expectedWinProbability = n > 0 ? (k_pub / n) * 100 : 0;
    const tokensPerTicket = launchStateForDebug.saleAllocation.div(new BN(k)).toNumber();
    const expectedTotalTokens = tokensPerTicket * k_pub;

    addLog(`\n--- WINNING ALGORITHM DEBUG ---`);
    addLog(`   -> Total tickets in system: ${totalTicketsInSystem}`);
    addLog(`   -> Public total tickets (n): ${n}`);
    addLog(`   -> K capacity: ${k}`);
    addLog(`   -> Reserved tickets (creator): ${reservedTickets}`);
    addLog(`   -> K public (k_pub): ${k_pub}`);
    addLog(`   -> Expected win probability: ${expectedWinProbability.toFixed(4)}%`);
    addLog(`   -> Actual win rate: ${actualWinRate.toFixed(4)}%`);
    addLog(`   -> Tokens per ticket: ${(tokensPerTicket / (10 ** TOKEN_DECIMALS)).toFixed(6)}`);
    addLog(`   -> Expected total tokens: ${(expectedTotalTokens / (10 ** TOKEN_DECIMALS)).toFixed(6)}`);
    addLog(`   -> Actual total tokens: ${tokensClaimed.toFixed(6)}`);
    addLog(`   -> Difference: ${(expectedTotalTokens / (10 ** TOKEN_DECIMALS) - tokensClaimed).toFixed(6)}`);
    addLog(`------------------------------------`);


    // Final check for any remaining errors
    if (failedClaims > 0) {
      throw new Error(
        `${failedClaims} users failed to claim either tokens or a refund.`
      );
    }

    let totalTokensClaimedByCreator = 0;
    let creatorClaimCost = 0;
    // 10. Test Creator Token Claiming (if creator deposit was made)
    if (config.creatorInitialDepositLamports > 0) {
      const balanceBeforeCreatorClaims = await provider.connection.getBalance(admin.publicKey);
      addLog(
        `\n[10/10] Testing Creator Token Claiming (Accrued Vesting)...`
      );
      addLog(`   -> Creator Deposit: ${config.creatorInitialDepositLamports / 1e9} SOL`);
      addLog(`   -> Lock Period: ${config.creatorClaimLockPeriodSec} seconds per ticket cap`);

      const creatorAta = sdk.getUserAta(testBaseMint.publicKey, admin.publicKey);

      addLog(`\n   --- Firing 3 rapid claims to test initial lock ---`);
      let initialSuccess = 0;
      let initialFailures = 0;
      for (let i = 0; i < 3; i++) {
        addLog(`   -> Attempt ${i + 1}/3...`);
        try {
          const initialBalance = await getTokenBalance(creatorAta);
          await sdk.claimCreatorTokens({
            launch: testLaunchState,
            baseMint: testBaseMint.publicKey,
            creatorAta: creatorAta,
            createAtaIfMissing: true,
            computeUnits: 2_000_000,
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
          baseMint: testBaseMint.publicKey,
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
          baseMint: testBaseMint.publicKey,
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
      const balanceAfterCreatorClaims = await provider.connection.getBalance(admin.publicKey);
      creatorClaimCost = balanceBeforeCreatorClaims - balanceAfterCreatorClaims;
    }

    const adminFinalBalance = await provider.connection.getBalance(admin.publicKey);
    const totalSpentByAdmin = adminInitialBalance - adminFinalBalance;
    const totalSOLCollected = finalLaunchState.totalDeposited.toNumber();
    const netFundingCost = userFundingCost - totalSOLCollected;

    const trueOperationalCost = launchTxFees + shardCreationCost + crankingCost + creatorClaimCost;
    const totalFeesPaid = totalSpentByAdmin - netFundingCost - config.creatorInitialDepositLamports - MINT_RENT;
    const simulationTxFees = totalFeesPaid - trueOperationalCost;


    addLog(`\n--- COST ANALYSIS ---`);
    addLog(`   Admin balance before test: ${adminInitialBalance / LAMPORTS_PER_SOL} SOL`);
    addLog(`   Admin balance after test: ${adminFinalBalance / LAMPORTS_PER_SOL} SOL`);
    addLog(`   Total SOL spent by admin: ${(totalSpentByAdmin / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

    addLog(`\n   --- True Operational Cost (Production Estimate) ---`);
    addLog(`     -> Initial launch (tx fees): ${(launchTxFees / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    addLog(`     -> Roster shard creation:    ${(shardCreationCost / LAMPORTS_PER_SOL).toFixed(6)} SOL (includes recoverable rent)`);
    addLog(`     -> Cranking operations:      ${(crankingCost / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    addLog(`     -> Creator claims:           ${(creatorClaimCost / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    addLog(`     --------------------------------------------------`);
    addLog(`     -> TOTAL OPERATIONAL COST:   ${(trueOperationalCost / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

    addLog(`\n   --- Simulation-Specific Items ---`);
    addLog(`     -> User funding tx fees:     ${(simulationTxFees / LAMPORTS_PER_SOL).toFixed(6)} SOL (approx)`);
    addLog(`     -> Net simulation funding:   ${(netFundingCost / LAMPORTS_PER_SOL).toFixed(6)} SOL (capital movement)`);

    addLog(`\n   --- Other Capital Movements ---`);
    addLog(`     -> Creator initial deposit:  ${(config.creatorInitialDepositLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    addLog(`     -> Sale mint rent:           ${(MINT_RENT / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

    addLog(`\n   --- Fundraising Analysis ---`);
    const totalUserDeposits = finalLaunchState.totalDeposited.toNumber();
    addLog(`     -> Total user deposits:    ${totalUserDeposits / LAMPORTS_PER_SOL} SOL`);
    const crankCostPerSOL = totalUserDeposits > 0 ? crankingCost / totalUserDeposits : 0;
    addLog(`     -> Crank cost per SOL raised: ${crankCostPerSOL.toFixed(12)} SOL`);
    addLog(`--- END COST ANALYSIS ---`);

    addLog(`\n\n--- DISTRIBUTION SUMMARY ---`);
    addLog(`   Total SOL collected:      ${(totalSOLCollected / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
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