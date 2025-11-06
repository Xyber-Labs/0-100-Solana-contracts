import { BN, Program } from "@coral-xyz/anchor";
import type { LaunchConfig } from "../types/launch";
import {
  Keypair,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

// import type EngineSDK from "../../../ts-sdk/src/engine";
import type EngineSDK from "@xyber-labs/0-100-sdk";
import { waitForFundingPeriodEnd as waitForFundingPeriodEndHelper, fundUsersParallel, depositUsersParallel, preparePoolCreationWithRetry, mintForTestSafe } from "./flowHelpers";


// A simplified SDK type, as we don't have the full type in this context
interface SimulationConfig {
  numUsers: number;
  maxTicketsPerUser: number;
}

export async function runFullFlow(
  sdk: ReturnType<typeof EngineSDK.create>,
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
  const SALE_PERCENTAGE = 0.4814; // 48.14% (align with tests)
  const LP_PERCENTAGE = 0.4186;    // 41.86% (base total 90%)
  const TOKEN_DECIMALS = 9;

  // Ensure sale/lp allocations are set in human units (not atomic); override if missing/unreasonable
  const computedSaleHuman = Math.floor(TOTAL_SUPPLY * SALE_PERCENTAGE);
  const computedLpHuman = Math.floor(TOTAL_SUPPLY * LP_PERCENTAGE);
  const parsedSaleHuman = Number.parseInt(String(config.saleAllocation || "0"), 10);
  if (!Number.isFinite(parsedSaleHuman) || parsedSaleHuman <= 0 || parsedSaleHuman < 1_000_000) {
    config.saleAllocation = String(computedSaleHuman);
  }
  if (!Number.isFinite(config.lpAllocation) || config.lpAllocation <= 0 || config.lpAllocation < 1_000_000) {
    (config as any).lpAllocation = computedLpHuman;
  }

  // Override creator deposit for this specific test
  const LAMPORTS_PER_SOL = 1_000_000_000;
  config.creatorInitialDepositLamports = 8 * LAMPORTS_PER_SOL;
  // daily limit will be recalculated below to allow full creator claim if needed

  addLog(`\n--- Using Simulation Parameters ---`);
  addLog(`   -> Total Supply: ${TOTAL_SUPPLY.toLocaleString()}`);
  addLog(`   -> Sale Percentage: ${SALE_PERCENTAGE * 100}%`);
  addLog(`   -> Sale Allocation (human units): ${Number(config.saleAllocation).toLocaleString()}`);
  addLog(`   -> LP Allocation (human units): ${Number((config as any).lpAllocation).toLocaleString()}`);
  addLog(`   -> Creator Deposit: ${config.creatorInitialDepositLamports / LAMPORTS_PER_SOL} SOL`);
  addLog(`------------------------------------`);
  // --- End Simulation Parameters ---

  try {
    // waitForFundingPeriodEnd moved to helpers

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
    const maxAffordable = Math.max(0, availableForCreatorDeposit);
    const desired = Math.min(config.creatorInitialDepositLamports, maxAffordable);
    let adjustedCreatorDeposit = Math.floor(desired / config.tauLamports) * config.tauLamports;
    if (adjustedCreatorDeposit < config.creatorInitialDepositLamports) {
      addLog(`Admin balance: ${(adminBalance / 1e9).toFixed(2)} SOL`);
      addLog(
        `Adjusting creator deposit to τ-multiple: ${(
          config.creatorInitialDepositLamports / 1e9
        ).toFixed(2)} SOL -> ${(adjustedCreatorDeposit / 1e9).toFixed(2)} SOL`
      );
    }
    if (adjustedCreatorDeposit === 0 && maxAffordable >= config.tauLamports) {
      adjustedCreatorDeposit = Math.floor(maxAffordable / config.tauLamports) * config.tauLamports;
      adjustedCreatorDeposit = Math.max(config.tauLamports, adjustedCreatorDeposit);
      addLog(`Bumping creator deposit to at least 1τ: ${(adjustedCreatorDeposit / 1e9).toFixed(2)} SOL`);
    }
    userFundingCost += config.creatorInitialDepositLamports - adjustedCreatorDeposit;
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

    // 1. Prepare EngineConfig + XYBER fee accounts
    addLog(`[1/10] Preparing EngineConfig and XYBER fee accounts...`);
    const [engineConfigPda] = sdk.getConfigPda();
    let engineConfig: any | null = null;
    try {
      engineConfig = await (program.account as any).engineConfig.fetch(engineConfigPda);
    } catch (_) {
      engineConfig = null;
    }
    if (!engineConfig) {
      throw new Error("EngineConfig not initialized. Run migration to set treasury, fee and admins.");
    }
    const treasuryPubkey: PublicKey = engineConfig.treasury as PublicKey;
    const creationFeeU64: number = Number(engineConfig.creationFee ?? 0);

    // Reuse configured XYBER mint; do NOT fallback to ad-hoc mint to avoid mismatch with on-chain cfg
    const engineXyberMintStr = String(engineConfig.xyberMint ?? "");
    const engineXyberMintDefault = /^0+$/i.test(engineXyberMintStr.replace(/[^0-9a-f]/gi, ""));
    let xyberMint: PublicKey;
    if (engineXyberMintDefault || !engineConfig.xyberMint) {
      throw new Error("EngineConfig.xyberMint is not set. Run pre-deploy setup and deploy-config to initialize XYBER mint.");
    }
    xyberMint = engineConfig.xyberMint as PublicKey;
    addLog(`   -> Using XYBER mint from config: ${xyberMint.toBase58()}`);
    // Ensure ATAs exist for creator and treasury; mint fee to creator if needed
    const creatorXyberAta = getAssociatedTokenAddressSync(xyberMint, admin.publicKey);
    const treasuryXyberAta = getAssociatedTokenAddressSync(xyberMint, treasuryPubkey);
    const ataTx = new Transaction()
      .add(createAssociatedTokenAccountInstruction(admin.publicKey, creatorXyberAta, admin.publicKey, xyberMint))
      .add(createAssociatedTokenAccountInstruction(admin.publicKey, treasuryXyberAta, treasuryPubkey, xyberMint));
    try {
      await provider.sendAndConfirm!(ataTx, []);
    } catch (_) {
      // ignore if already exists
    }
    if (creationFeeU64 > 0) {
      try {
        const mintFeeTx = new Transaction().add(
          createMintToInstruction(xyberMint, creatorXyberAta, admin.publicKey, BigInt(creationFeeU64))
        );
        await provider.sendAndConfirm!(mintFeeTx, []);
      } catch (_) {
        // If not mint authority, try transferring fee from treasury ATA to creator ATA
        try {
          const transferTx = new Transaction().add(
            createTransferInstruction(
              treasuryXyberAta,
              creatorXyberAta,
              treasuryPubkey,
              BigInt(creationFeeU64)
            )
          );
          await provider.sendAndConfirm!(transferTx, []);
        } catch {
          // As a last resort, continue; initLaunch will fail later with insufficient XYBER
        }
      }
    }

    // 2. Initialize Launch
    addLog(`[2/10] Initializing Launch...`);

    const balanceBeforeLaunch = await provider.connection.getBalance(admin.publicKey);

    // Debug: Check available methods
    addLog(`Available SDK methods: ${Object.keys(sdk).join(', ')}`);

    const testBaseMint = Keypair.generate();
    let lastProjectId = 0;
    try {
      const counter: any = await sdk.fetchProjectCounter();
      lastProjectId = (counter?.lastProjectId?.toNumber && counter.lastProjectId.toNumber()) || 0;
    } catch (_) {
      lastProjectId = 0;
    }
    const projectId = lastProjectId + 1;
    [testLaunchState] = sdk.getLaunchPdaByProjectId(projectId);
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
    // Derive baseTotalAllocation/baseSaleBasisPoints from sale/lp
    // Convert to atomic units (9 decimals). If values look already atomic, pass-through.
    const DECIMALS_SCALE = new BN(1_000_000_000); // 10^9
    const toAtomic = (val: string | number): BN => {
      const raw = new BN(String(val));
      // Heuristic: if already very large (>= 1e13), assume atomic and do not rescale
      // 1e13 tokens * 1e9 = 1e22 (would overflow u64), so practical UI inputs (<= 1e12) should be rescaled
      const THRESHOLD = new BN("10000000000000"); // 1e13
      return raw.gte(THRESHOLD) ? raw : raw.mul(DECIMALS_SCALE);
    };
    const saleAllocBN = toAtomic(config.saleAllocation);
    const lpAllocBN = toAtomic(config.lpAllocation);
    const baseTotalAllocationBN = saleAllocBN.add(lpAllocBN);
    const baseSaleBpsBN = baseTotalAllocationBN.isZero()
      ? new BN(0)
      : saleAllocBN.mul(new BN(10000)).div(baseTotalAllocationBN);

    if (lpAllocBN.isZero()) {
      throw new Error("Invalid config: lpAllocation is zero; LP must be > 0");
    }

    const initRes = await sdk.initLaunch({
      projectId,
      hardCapLamports: new BN(config.hardCapLamports),
      minRaiseLamports: new BN(config.minRaiseLamports),
      perWalletCap: new BN(config.perWalletCap),
      tauLamports: new BN(config.tauLamports),
      baseTotalAllocation: baseTotalAllocationBN,
      baseSaleBasisPoints: baseSaleBpsBN,
      fundingDurationSeconds,
      unlockTimeSec: config.unlockTimeSec,
      rosterShardCap: config.rosterShardCap,
      creatorInitialDepositLamports: new BN(config.creatorInitialDepositLamports),
      creatorDailyLamportsLimit: new BN(config.creatorDailyLamportsLimit),
      creatorClaimLockPeriodSec: new BN(config.creatorClaimLockPeriodSec),
      creatorMaxDepositLamports: new BN((config as any).creatorMaxDepositLamports ?? config.creatorInitialDepositLamports),
      xyberMint,
    });

    const balanceAfterLaunch = await provider.connection.getBalance(admin.publicKey);
    const grossLaunchCost = balanceBeforeLaunch - balanceAfterLaunch;
    const launchTxFees = grossLaunchCost - config.creatorInitialDepositLamports - MINT_RENT;

    addLog(`   -> Launch initialized. Signature: ${initRes.signature}`);
    addLog(`   -> Launch PDA: ${testLaunchState.toBase58()}`);

    // Compute expected k_capacity and public target tickets to ensure full sale coverage
    const kCapacityExpected = Math.floor(config.hardCapLamports / config.tauLamports);
    const reservedExpected = Math.floor(
      (config.creatorInitialDepositLamports > 0
        ? (config.creatorInitialDepositLamports / config.hardCapLamports) * kCapacityExpected
        : 0)
    );
    const kPubExpected = Math.max(0, kCapacityExpected - reservedExpected);
    // Ensure creator can claim all reserved in one go for the simulation
    config.creatorDailyLamportsLimit = Math.max(
      config.creatorDailyLamportsLimit ?? 0,
      reservedExpected * config.tauLamports
    );

    // 3. Pre-initialize all necessary roster shards
    // We'll generate enough users to reach at least k_pub tickets
    const MAX_TICKETS_PER_USER = Math.max(1, simConfig.maxTicketsPerUser);
    const usersNeeded = Math.ceil(kPubExpected / MAX_TICKETS_PER_USER);
    const numShards = Math.ceil(usersNeeded / config.rosterShardCap);
    addLog(
      `\n[3/10] Calculated ${numShards} shards needed for ~${usersNeeded} users to cover k_pub=${kPubExpected} with cap=${config.rosterShardCap}. Initializing...`
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

    // 3. Simulate deposits to reach at least k_pub tickets
    const TARGET_USERS = usersNeeded;
    const MAX_TICKETS = MAX_TICKETS_PER_USER;
    const usersWithDeposits = new Map<
      string,
      { keypair: Keypair; tickets: number; shardId: number }
    >();

    addLog(`\n[3/10] Simulating deposits to cover k_pub tickets...`);

    // Step 1: Generate deterministic users to hit k_pubExpected tickets
    let remainingTickets = kPubExpected;
    const provisionalUsers: { keypair: Keypair; tickets: number; depositAmount: BN; shardId: number }[] = [];
    let idx = 0;
    while (remainingTickets > 0) {
      const tickets = Math.min(remainingTickets, MAX_TICKETS);
      const keypair = Keypair.generate();
      const depositAmount = new BN(config.tauLamports).mul(new BN(tickets));
      const shardId = Math.floor(idx / config.rosterShardCap);
      provisionalUsers.push({ keypair, tickets, depositAmount, shardId });
      remainingTickets -= tickets;
      idx++;
    }
    let users = provisionalUsers;

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

    // concurrency runner moved to helpers

    addLog(`   -> Funding ${numUsersToSimulate} users with transfers from admin (parallel)...`);
    await fundUsersParallel({ provider, admin: admin.publicKey, users, addLog });
    addLog("   -> All users funded.");

    // Step 4: Deposit from all users, using pre-calculated shard IDs
    addLog(`   -> Sending ${numUsersToSimulate} deposit transactions in parallel...`);
    // record for later claims
    for (const user of users) {
      usersWithDeposits.set(user.keypair.publicKey.toBase58(), { keypair: user.keypair, tickets: user.tickets, shardId: user.shardId });
    }
    await depositUsersParallel({ sdk, launchPda: testLaunchState, users, addLog });
    addLog("   -> All deposits completed.");

    // 4. Wait for Funding to End
    addLog(`\n[4/10] Waiting for funding period to end...`);
    await waitForFundingPeriodEndHelper({ provider, sdk, launchPda: testLaunchState, addLog });
    addLog("   -> Funding period closed.");

    const balanceBeforeCranking = await provider.connection.getBalance(admin.publicKey);

    // 5. Set VRF Seed
    addLog(`\n[5/10] Setting VRF Seed...`);
    {
      let seeded = false;
      for (let i = 0; i < 60; i++) {
        try {
          await sdk.setSeed({ launch: testLaunchState });
          seeded = true;
          break;
        } catch (e: any) {
          const msg = (e && e.message) ? String(e.message) : "";
          if (msg.includes("Funding period has not ended") || msg.includes("FundingPeriodNotEnded") || msg.includes("6002")) {
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
          throw e;
        }
      }
      if (!seeded) throw new Error("Timeout waiting for funding period to end on-chain");
      addLog("   -> VRF seed set.");
    }

    // 6. Finalize shard(s)
    addLog(`\n[6/10] Finalizing roster shards...`);
    for (let i = 0; i < numShards; i++) {
      await sdk.finalizeRosterShard({ launch: testLaunchState, shardId: i });
      addLog(`   -> Shard ${i} finalized.`);
    }

    const balanceAfterCranking = await provider.connection.getBalance(admin.publicKey);
    const crankingCost = balanceBeforeCranking - balanceAfterCranking;

    // 7. Create Pool (prepare, Raydium CLMM creation, add liquidity)
    addLog(`\n[7/10] Prepare Pool Creation...`);
    await preparePoolCreationWithRetry({ sdk, launchPda: testLaunchState, addLog });

    const mintedBaseMint = await mintForTestSafe({ sdk, launchPda: testLaunchState, baseMintKeypair: testBaseMint, addLog });
    addLog(`      - Minted base mint: ${mintedBaseMint.toBase58()}`);

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
    // Derive tokensPerTicket from on-chain state (preferred) or fallback to config
    let tokensPerTicket: number;
    try {
      const perScaled: any = (launchStateForDebug as any).tokensPerTicket;
      if (perScaled && typeof perScaled.toNumber === "function") {
        // On-chain stores value scaled by 1e6; convert back to atomic units
        const scaled = perScaled.toNumber();
        tokensPerTicket = Math.floor(scaled / 1_000_000);
      } else if (typeof perScaled === "number") {
        tokensPerTicket = Math.floor(perScaled / 1_000_000);
      } else {
        // Fallback: compute from config.saleAllocation and divisor
        const grandTotalTickets = (launchStateForDebug.publicTotalTickets as number)
          + (launchStateForDebug.creatorReservedTickets as number);
        const divisor = Math.min(grandTotalTickets, k);
        tokensPerTicket = divisor > 0
          ? new BN(config.saleAllocation).div(new BN(divisor)).toNumber()
          : 0;
      }
    } catch {
      tokensPerTicket = 0;
    }
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

      // Ensure creator ATA exists before any claim attempts
      try {
        const { ix } = sdk.buildCreateAtaIx({
          payer: admin.publicKey,
          owner: admin.publicKey,
          mint: testBaseMint.publicKey,
        });
        const tx = new Transaction().add(ix);
        await provider.sendAndConfirm!(tx, []);
      } catch (_) {
        // ignore if already exists or creation races
      }

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
    const launchAtEnd = await sdk.fetchLaunch(testLaunchState);
    const totalSOLCollected = launchAtEnd.totalDeposited.toNumber();
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
    const totalUserDeposits = launchAtEnd.totalDeposited.toNumber();
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