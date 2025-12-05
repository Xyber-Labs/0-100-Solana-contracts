import { BN, Program } from "@coral-xyz/anchor";
import type { LaunchConfig } from "../types/launch";
import {
  Keypair,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
  SystemProgram,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  createTransferInstruction,
  createInitializeMintInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { EngineClient } from "@xyber-labs/0-100-sdk";
import { waitForFundingPeriodEnd as waitForFundingPeriodEndHelper, fundUsersParallel, airdropUsersParallel, depositUsersParallel, preparePoolCreationWithRetry, mintForTestSafe } from "./flowHelpers";
import { runRaydiumSwaps } from "./raydiumSwaps";
import { LaunchStatsCollector } from "./stats/launchStats";
import type { LaunchSummary, LaunchUserRow } from "./stats/launchStats";


interface SimulationConfig {
  numUsers: number;
  maxTicketsPerUser: number;
  useTestMintForBase?: boolean;
  raydiumSwapsCount?: number;
  raydiumSolPerSwap?: number;
  minTicketsPerUser?: number;
  ticketsTargetMultiplier?: number;
  useAirdropForUsers?: boolean;
}

export async function runFullFlow(
  sdk: EngineClient,
  program: Program,
  provider: any,
  config: LaunchConfig,
  addLog: (log: string) => void,
  simConfig: SimulationConfig,
  adminSigners: Keypair[] = []
): Promise<{
  success: boolean;
  message: string;
  statsRows?: LaunchUserRow[];
  statsCsv?: string;
  statsSummary?: LaunchSummary;
}> {
  const admin = provider.wallet;
  const adminInitialBalance = await provider.connection.getBalance(admin.publicKey);
  let userFundingCost = 0;
  let poolBaseLiquidityUi: number | null = null;
  let poolQuoteLiquidityUi: number | null = null;
  const stats = new LaunchStatsCollector();

  (globalThis as any).__sealCost = 0;
  (globalThis as any).__sealDetails = [];
  (globalThis as any).__shardsRentRefundLamports = 0;
  (globalThis as any).__closedShardsCount = 0;

  addLog(`--- Starting Full Flow ---`);
  addLog(`Admin wallet: ${admin.publicKey.toBase58()}`);

  let testLaunchState: PublicKey;

  // --- Simulation Parameters (provided by caller via config) ---
  const LAMPORTS_PER_SOL = 1_000_000_000;

  // Override creator deposit for this specific test
  config.creatorInitialDepositLamports = 8 * LAMPORTS_PER_SOL;
  // daily limit will be recalculated below to allow full creator claim if needed

  addLog(`\n--- Using Simulation Parameters ---`);
  addLog(`   -> Base total supply (tokens): ${config.baseTotalAllocationTokens}`);
  addLog(`   -> Sale Allocation (bps): ${String((config as any).saleBasisPoints ?? 0)}`);
  addLog(`   -> LP Allocation (bps): ${String((config as any).lpBasisPoints ?? 0)}`);
  addLog(`   -> Team Allocation (bps of base_total): ${(config as any).teamAllocationBasisPoints}`);
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
    const threshold: number = Number(engineConfig.threshold ?? 1);

    const engineXyberMintStr = String(engineConfig.xyberMint ?? "");
    const engineXyberMintDefault = /^0+$/i.test(engineXyberMintStr.replace(/[^0-9a-f]/gi, ""));
    let xyberMint: PublicKey;
    if (engineXyberMintDefault || !engineConfig.xyberMint) {
      throw new Error("EngineConfig.xyberMint is not set. Initialize config before running the flow.");
    }
    xyberMint = engineConfig.xyberMint as PublicKey;
    addLog(`   -> Using XYBER mint from config: ${xyberMint.toBase58()}`);

    const mintInfo = await provider.connection.getAccountInfo(xyberMint);
    if (!mintInfo) {
      addLog(`   -> XYBER mint account is missing on this cluster: ${xyberMint.toBase58()}`);
      // Best-effort attempt to create a new local mint and update config; may fail if multisig required
      try {
        const newMint = Keypair.generate();
        const lamports = await provider.connection.getMinimumBalanceForRentExemption(82);
        const tx = new Transaction()
          .add(SystemProgram.createAccount({ fromPubkey: admin.publicKey, newAccountPubkey: newMint.publicKey, space: 82, lamports, programId: TOKEN_PROGRAM_ID }))
          .add(createInitializeMintInstruction(newMint.publicKey, 9, admin.publicKey, null));
        await provider.sendAndConfirm!(tx, [newMint]);
        try {
          if (threshold > 1 && adminSigners.length < threshold) {
            throw new Error(`Not enough admin signers provided (${adminSigners.length}/${threshold}).`);
          }
          await (sdk as any).updateEngineConfig({ newXyberMint: newMint.publicKey, signerAdmins: adminSigners });
          xyberMint = newMint.publicKey;
          addLog(`   -> Updated EngineConfig.xyberMint to new local mint: ${xyberMint.toBase58()}`);
        } catch (e: any) {
          addLog(`   -> Failed to update EngineConfig.xyberMint automatically: ${e?.message || e}`);
          throw new Error("XYBER mint missing and EngineConfig update failed. Provide enough adminSigners, or re-run predeploy to set xyberMint correctly.");
        }
      } catch (e: any) {
        throw new Error(`Failed to provision XYBER mint locally: ${e?.message || e}`);
      }
    }

    const creatorXyberAta = getAssociatedTokenAddressSync(xyberMint, admin.publicKey);
    const treasuryXyberAta = getAssociatedTokenAddressSync(xyberMint, treasuryPubkey);
    try {
      const ataTx = new Transaction()
        .add(createAssociatedTokenAccountInstruction(admin.publicKey, creatorXyberAta, admin.publicKey, xyberMint))
        .add(createAssociatedTokenAccountInstruction(admin.publicKey, treasuryXyberAta, treasuryPubkey, xyberMint));
      await provider.sendAndConfirm!(ataTx, []);
    } catch (e: any) {
      // ignore creation races; we'll verify below
      addLog(`   -> ATA creation attempt finished: ${e?.message ? "with warnings" : "ok"}`);
    }
    const creatorAtaInfo = await provider.connection.getAccountInfo(creatorXyberAta);
    const treasuryAtaInfo = await provider.connection.getAccountInfo(treasuryXyberAta);
    if (!creatorAtaInfo || !treasuryAtaInfo) {
      throw new Error("Failed to create required XYBER ATAs for creator/treasury. Ensure XYBER mint exists and wallet has authority.");
    }
    if (creationFeeU64 > 0) {
      const creatorXyberBalance = await getTokenBalance(creatorXyberAta);
      const requiredXyberUi = creationFeeU64 / Math.pow(10, 9);
      if (creatorXyberBalance >= requiredXyberUi) {
        addLog(`   -> Creator XYBER ATA already funded for creation fee (balance=${creatorXyberBalance}, required=${requiredXyberUi}). Skipping funding and config update.`);
      } else {
        let funded = false;
        try {
          const mintFeeTx = new Transaction().add(createMintToInstruction(xyberMint, creatorXyberAta, admin.publicKey, BigInt(creationFeeU64)));
          await provider.sendAndConfirm!(mintFeeTx, []);
          funded = true;
        } catch (_) { }
        if (!funded) {
          try {
            const transferTx = new Transaction().add(createTransferInstruction(treasuryXyberAta, creatorXyberAta, treasuryPubkey, BigInt(creationFeeU64)));
            await provider.sendAndConfirm!(transferTx, []);
            funded = true;
          } catch (_) { }
        }
        if (!funded) {
          try {
            if (threshold > 1 && adminSigners.length < threshold) {
              throw new Error(`Not enough admin signers provided (${adminSigners.length}/${threshold}).`);
            }
            await (sdk as any).updateEngineConfig({ newCreationFee: new BN(0), signerAdmins: adminSigners });
            addLog("   -> Creation fee set to 0 via config update.");
          } catch (e: any) {
            throw new Error(`Unable to fund creator XYBER ATA for creation fee and cannot update config: ${e?.message || e}`);
          }
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

    // Check if getCreatorGrantPda exists before calling it
    if (typeof sdk.getCreatorGrantPda !== 'function') {
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
    const estSec = estFundingBatches * 1 + estDepositBatches * 2 + 5;
    // allow much longer windows for big simulations, but keep a sane floor
    const estClamped = Math.max(30, Math.min(estSec, 600));
    const cfgSec = typeof config.fundingDurationSeconds === "number" ? config.fundingDurationSeconds : 0;
    const fundingDurationSeconds = Math.max(30, cfgSec, estClamped);

    const DECIMALS_SCALE = new BN(1_000_000_000);
    const DECIMALS_SCALE_FACTOR = 1_000_000_000;
    function formatAtomicBn(value: BN): string {
      const negative = value.isNeg();
      const abs = negative ? value.neg() : value;
      const whole = abs.div(DECIMALS_SCALE);
      const frac = abs.mod(DECIMALS_SCALE);
      const fracStrRaw = frac.toString().padStart(9, "0");
      const fracStr = fracStrRaw.replace(/0+$/, "");
      const base = fracStr.length ? `${whole.toString()}.${fracStr}` : whole.toString();
      return negative && base !== "0" ? `-${base}` : base;
    }
    function formatLargeQuantity(value: number): string {
      const abs = Math.abs(value);
      if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
      if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
      if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
      return value.toFixed(2);
    }
    async function updateSupplySnapshot(baseMint: PublicKey | null) {
      if (!baseMint) return;
      try {
        const supply = await provider.connection.getTokenSupply(baseMint);
        const amountStr = typeof supply.value.amount === "string" ? supply.value.amount : String(supply.value.amount ?? "0");
        const observedAtomic = new BN(amountStr);
        const launchForSupply: any = await (sdk as any).fetchLaunch(testLaunchState);
        const baseTotalAllocationBn = new BN(launchForSupply.baseTotalAllocation.toString());
        const teamBps = Number(launchForSupply.teamAllocationBasisPoints ?? 0);
        const expectedAtomic = baseTotalAllocationBn;
        const teamAtomic = expectedAtomic.mul(new BN(teamBps)).div(new BN(10000));
        const nonTeamAtomic = expectedAtomic.sub(teamAtomic);
        const deltaAtomic = expectedAtomic.sub(observedAtomic);
        const baseMintSupplyUi = formatAtomicBn(observedAtomic);
        const expectedUi = formatAtomicBn(expectedAtomic);
        const nonTeamUi = formatAtomicBn(nonTeamAtomic);
        const teamUi = formatAtomicBn(teamAtomic);
        const deltaAbsUi = formatAtomicBn(deltaAtomic.abs());
        const deltaSign = deltaAtomic.isNeg() ? "-" : "+";
        addLog(`   Base mint total supply:   ${baseMintSupplyUi}`);
        addLog(`   Expected supply (base_total): ${expectedUi}`);
        addLog(`   Non-team allocation:      ${nonTeamUi}`);
        addLog(`   Team allocation (${teamBps}bps): ${teamUi}`);
        addLog(`   Supply delta (expected - actual): ${deltaSign}${deltaAbsUi}`);
      } catch (_) { }
    }
    let baseTotalTokensNum = Number((config as any).baseTotalAllocationTokens ?? 0);
    if (!baseTotalTokensNum || baseTotalTokensNum <= 0) {
      baseTotalTokensNum = 1_000_000_000;
      (config as any).baseTotalAllocationTokens = baseTotalTokensNum;
      addLog(`   -> baseTotalAllocationTokens was missing/zero, defaulted to ${baseTotalTokensNum}`);
    }
    const baseTotalTokens = new BN(String(baseTotalTokensNum));
    const baseTotalAllocationBN = baseTotalTokens.mul(DECIMALS_SCALE);
    const saleBpsNum = Number((config as any).saleBasisPoints ?? 0);
    const lpBpsNum = Number((config as any).lpBasisPoints ?? 0);
    const teamBpsNum = Number((config as any).teamAllocationBasisPoints ?? 0);
    const totalBps = saleBpsNum + lpBpsNum + teamBpsNum;
    if (baseTotalAllocationBN.isZero()) {
      throw new Error("Invalid config: baseTotalAllocationTokens is zero");
    }
    if (totalBps !== 10000) {
      throw new Error(`Invalid config: sale+lp+team bps must equal 10000 (got ${totalBps})`);
    }
    if (lpBpsNum <= 0) {
      throw new Error("Invalid config: lpBasisPoints must be > 0");
    }
    const baseSaleBpsBN = new BN(saleBpsNum);

    const metaName = `Lumi Project #${projectId}`;
    const metaSymbol = "LUMI";
    const metaUri = "https://ipfs.io/ipfs/QmNb2nS5krQAKq1rMojoGxSu6c5JTgMish4apbP7xCgTVV";
    const kCap = Math.floor(config.hardCapLamports / config.tauLamports);
    const rosterShardsTotal = (config as any).rosterShardsTotal && (config as any).rosterShardsTotal > 0
      ? Math.min(65535, (config as any).rosterShardsTotal)
      : Math.min(65535, Math.ceil(kCap / Math.max(1, config.rosterShardCap)));
    addLog("launch config: " + JSON.stringify(config));
    const { initLaunchTx } = await sdk.initLaunchTx({
      creator: admin.publicKey,
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
      rosterShardsTotal,
      poolCreationGracePeriodSec: config.poolCreationGracePeriodSec,
      creatorInitialDepositLamports: new BN(config.creatorInitialDepositLamports),
      creatorDailyLamportsLimit: new BN(config.creatorDailyLamportsLimit),
      creatorClaimLockPeriodSec: new BN(config.creatorClaimLockPeriodSec),
      creatorMaxDepositLamports: new BN((config as any).creatorMaxDepositLamports ?? config.creatorInitialDepositLamports),
      provider,
      xyberMint,
      name: metaName,
      symbol: metaSymbol,
      uri: metaUri,
      isMutable: true,
      sellerFeeBasisPoints: 0,
      teamAllocationBasisPoints: (config as any).teamAllocationBasisPoints ?? 1000,
      teamVestingDurationSec: (config as any).teamVestingDurationSec ?? 1, // tests can set to 1s to claim immediately
    });
    const signature = await provider.sendAndConfirm!(initLaunchTx, []);

    const balanceAfterLaunch = await provider.connection.getBalance(admin.publicKey);
    const grossLaunchCost = balanceBeforeLaunch - balanceAfterLaunch;
    const launchTxFees = grossLaunchCost - config.creatorInitialDepositLamports - MINT_RENT;

    addLog(`   -> Launch initialized. Signature: ${signature}`);
    addLog(`   -> Launch PDA: ${testLaunchState.toBase58()}`);

    // Initialize team vesting early so it exists throughout the flow
    try {
      await sdk.initTeamVesting({ launch: testLaunchState });
      addLog(`   -> Team vesting initialized`);
    } catch (e: any) {
      const msg = String(e?.message || e);
      addLog(`   -> Team vesting init skipped: ${msg}`);
    }

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

    const MAX_TICKETS_PER_USER = Math.max(1, simConfig.maxTicketsPerUser);
    const MIN_TICKETS_PER_USER = Math.max(1, (simConfig as any).minTicketsPerUser ?? 1);
    const usersNeeded = Math.ceil(kPubExpected / MAX_TICKETS_PER_USER);
    const requestedUsers = simConfig.numUsers && simConfig.numUsers > 0 ? simConfig.numUsers : usersNeeded;
    const maxUsersCapacity = rosterShardsTotal * config.rosterShardCap;
    const TARGET_USERS = Math.min(requestedUsers, maxUsersCapacity);
    const numShards = Math.min(Math.ceil(TARGET_USERS / config.rosterShardCap), rosterShardsTotal);
    addLog(
      `\n[3/10] Calculated ${numShards}/${rosterShardsTotal} shards for ${TARGET_USERS} target users (k_pub=${kPubExpected}, cap=${config.rosterShardCap}). Initializing...`
    );
    if (requestedUsers > TARGET_USERS) {
      addLog(`   -> Requested ${requestedUsers} users exceeds shard capacity (${maxUsersCapacity}). Capped to ${TARGET_USERS}.`);
    }
    const balanceBeforeShards = await provider.connection.getBalance(admin.publicKey);
    for (let i = 1; i <= numShards; i++) {
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

    const usersWithDeposits = new Map<
      string,
      { keypair: Keypair; tickets: number; shardId: number; depositAmount: BN }
    >();

    addLog(`\n[3/10] Simulating deposits for ${TARGET_USERS} users...`);

    const maxTicketsCapacity = TARGET_USERS * MAX_TICKETS_PER_USER;
    const ticketsSliderRaw = (simConfig as any).ticketsTargetMultiplier;
    const ticketsSlider = typeof ticketsSliderRaw === "number" && ticketsSliderRaw > 0 ? ticketsSliderRaw : 1;
    const ticketsSliderClamped = Math.max(1, Math.min(ticketsSlider, 100));
    const fillRatio = (ticketsSliderClamped - 1) / 99;
    addLog(`   -> ticketsFillPercent: ${ticketsSliderClamped}%`);
    addLog(`   -> maxTicketsCapacity (users * maxTicketsPerUser): ${maxTicketsCapacity}`);

    const ticketsPerUser: number[] = new Array(TARGET_USERS).fill(0);
    if (ticketsSliderClamped === 100) {
      for (let i = 0; i < TARGET_USERS; i++) {
        ticketsPerUser[i] = MAX_TICKETS_PER_USER;
      }
    } else {
      for (let i = 0; i < TARGET_USERS; i++) {
        const span = MAX_TICKETS_PER_USER - MIN_TICKETS_PER_USER;
        const effectiveSpan = Math.max(0, Math.round(span * fillRatio));
        const high = MIN_TICKETS_PER_USER + effectiveSpan;
        const low = MIN_TICKETS_PER_USER;
        if (high <= low) {
          ticketsPerUser[i] = low;
        } else {
          const extra = Math.floor(Math.random() * (high - low + 1));
          ticketsPerUser[i] = low + extra;
        }
      }
    }
    const provisionalUsers: { keypair: Keypair; tickets: number; depositAmount: BN; shardId: number }[] = [];
    for (let i = 0; i < TARGET_USERS; i++) {
      const tickets = ticketsPerUser[i];
      const keypair = Keypair.generate();
      const depositAmount = new BN(config.tauLamports).mul(new BN(tickets));
      const shardId = 1 + Math.floor(i / config.rosterShardCap);
      provisionalUsers.push({ keypair, tickets, depositAmount, shardId });
    }
    let users = provisionalUsers;
    const useAirdropForUsers = !!(simConfig as any).useAirdropForUsers;

    let cumulativeCost = 0;

    let numUsersToSimulate = users.length;

    if (!useAirdropForUsers) {
      let currentAdminBalance: number;
      try {
        currentAdminBalance = await provider.connection.getBalance(admin.publicKey);
      } catch (error) {
        currentAdminBalance = 500000000;
      }

      const feeBufferPerUser = 5000000;
      const affordableUsers = [];

      for (const user of users) {
        const costForThisUser = user.depositAmount.toNumber() + feeBufferPerUser;
        if (cumulativeCost + costForThisUser <= currentAdminBalance) {
          cumulativeCost += costForThisUser;
          affordableUsers.push(user);
        } else {
          break;
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

      numUsersToSimulate = users.length;
      addLog(
        `   -> Total cost to fund ${numUsersToSimulate} users: ${(
          cumulativeCost / LAMPORTS_PER_SOL
        ).toFixed(4)} SOL`
      );
    } else {
      addLog("   -> Using airdrop funding for users (ignoring admin balance).");
    }

    // concurrency runner moved to helpers

    const fundingConcurrency = Math.min(200, numUsersToSimulate);
    addLog(
      useAirdropForUsers
        ? `   -> Funding ${numUsersToSimulate} users via airdrop (parallel)...`
        : `   -> Funding ${numUsersToSimulate} users with transfers from admin (parallel)...`
    );
    addLog(`      - Concurrency: ${fundingConcurrency}`);
    if (useAirdropForUsers) {
      await airdropUsersParallel({
        provider,
        users,
        concurrency: fundingConcurrency,
        addLog,
      });
    } else {
      await fundUsersParallel({
        provider,
        admin: admin.publicKey,
        users,
        concurrency: fundingConcurrency,
        addLog,
      });
    }
    addLog("   -> All users funded.");

    // Step 4: Deposit from all users, using pre-calculated shard IDs
    const depositConcurrency = numUsersToSimulate > 5000 ? 100 : Math.min(200, numUsersToSimulate);
    const uniqueShardsInUse = new Set(users.map(u => u.shardId)).size;
    const totalTicketsSim = users.reduce((acc, u) => acc + u.tickets, 0);
    const avgTicketsSim = totalTicketsSim / Math.max(1, numUsersToSimulate);
    addLog(`   -> Sending ${numUsersToSimulate} deposit transactions in parallel...`);
    addLog(`      - Concurrency: ${depositConcurrency}`);
    addLog(`      - Shards involved: ${uniqueShardsInUse}/${rosterShardsTotal} (cap per shard ${config.rosterShardCap})`);
    addLog(`      - Tickets: total=${totalTicketsSim}, avgPerUser=${avgTicketsSim.toFixed(2)}`);
    const depositResults = await depositUsersParallel({ sdk, launchPda: testLaunchState, users, concurrency: depositConcurrency, addLog });
    const successfulResults = depositResults.filter((r) => !!r) as Array<{ pubkey: PublicKey; shardId: number }>;
    const failedCount = depositResults.length - successfulResults.length;
    for (const result of successfulResults) {
      const k = result.pubkey.toBase58();
      const user = users.find(u => u.keypair.publicKey.toBase58() === k)!;
      usersWithDeposits.set(k, {
        keypair: user.keypair,
        tickets: user.tickets,
        shardId: result.shardId,
        depositAmount: user.depositAmount,
      });
    }
    if (failedCount > 0) {
      addLog(`   -> ${failedCount} deposits failed after retries and were skipped.`);
    }
    addLog("   -> All deposits completed.");

    // 4. Wait for Funding to End
    addLog(`\n[4/10] Waiting for funding period to end...`);
    await waitForFundingPeriodEndHelper({ provider, sdk, launchPda: testLaunchState, addLog });
    addLog("   -> Funding period closed.");
    const balanceBeforeSetSeed = await provider.connection.getBalance(admin.publicKey);

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
    const balanceAfterSetSeed = await provider.connection.getBalance(admin.publicKey);
    const setSeedCost = balanceBeforeSetSeed - balanceAfterSetSeed;

    // 6. Finalize shard(s)
    addLog(`\n[6/10] Finalizing roster shards...`);
    // Ensure ALL shards up to launch_state.roster_shards are finalized
    const launchAfterDeposits: any = await sdk.fetchLaunch(testLaunchState);
    const totalShards: number = Number(launchAfterDeposits.rosterShards ?? 0);
    const balanceBeforeFinalize = await provider.connection.getBalance(admin.publicKey);
    for (let i = 1; i <= totalShards; i++) {
      // initialize shard if it wasn't created earlier (empty shard is OK)
      try {
        await sdk.initRosterShard({ launch: testLaunchState, shardId: i });
      } catch (_) {
        // ignore if exists
      }
      await sdk.finalizeRosterShard({ launch: testLaunchState, shardId: i });
      addLog(`   -> Shard ${i}/${totalShards} finalized.`);
    }
    const balanceAfterFinalize = await provider.connection.getBalance(admin.publicKey);
    const finalizeCost = balanceBeforeFinalize - balanceAfterFinalize;
    const crankingCost = setSeedCost + finalizeCost;

    addLog(`\n[6.5/10] Sealing and closing roster shards...`);
    {
      const launch: any = await sdk.fetchLaunch(testLaunchState);
      const totalShards: number = Number(launch.rosterShards ?? 0);
      let sealCost = 0;
      const sealDetails: { shardId: number; costLamports: number; batches: number }[] = [];
      let shardsRentRefundLamports = 0;
      let closedShardsCount = 0;
      for (let shardId = 1; shardId <= totalShards; shardId++) {
        const [rosterShardPda] = sdk.getRosterShardPda(testLaunchState, shardId);
        let shardAcc: any = null;
        try {
          shardAcc = await (program.account as any).rosterShard.fetch(rosterShardPda);
        } catch (_) {
          shardAcc = null;
        }
        const wallets: PublicKey[] = (shardAcc?.wallets as PublicKey[]) || [];
        const MAX_UNITS = 1_400_000;
        const MAX_BATCH = 24; // avoid tx size overflow due to remaining accounts
        let batchSize = Math.min(20, MAX_BATCH);
        const sealBefore = await provider.connection.getBalance(admin.publicKey);
        let batches = 0;
        for (let from = 0; from < wallets.length;) {
          const end = Math.min(from + batchSize, wallets.length);
          const slice = wallets.slice(from, end);
          const { transaction } = await (sdk as any).sealRosterShardTx({
            launch: testLaunchState,
            shardId,
            from,
            max: slice.length,
            walletsSlice: slice,
          });
          try {
            try { transaction.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: MAX_UNITS })); } catch (_) {}
            await provider.sendAndConfirm!(transaction, []);
            addLog(`   -> Shard ${shardId}: sealed users [${from}..${end - 1}]`);
            batches += 1;
            from = end;
            // Try cautiously increasing batch size within safe limit
            if (batchSize < MAX_BATCH) batchSize = Math.min(MAX_BATCH, batchSize + 2);
          } catch (e: any) {
            const msg = String(e?.message || "");
            const cuExceeded = msg.includes("exceeded CUs meter") || msg.includes("consumed 200000 of 200000 compute units") || msg.includes("Program failed to complete");
            const txTooLarge = msg.includes("Transaction too large") || msg.includes("> 1232");
            if (cuExceeded && batchSize > 1) {
              batchSize = Math.max(1, Math.floor(batchSize / 2));
              addLog(`   -> Shard ${shardId}: CU exceeded, reducing batch size to ${batchSize} and retrying [${from}..${end - 1}]`);
              continue;
            } else if (txTooLarge && batchSize > 1) {
              batchSize = Math.max(1, Math.floor(batchSize * 3 / 4));
              addLog(`   -> Shard ${shardId}: TX too large, reducing batch size to ${batchSize} and retrying [${from}..${end - 1}]`);
              continue;
            }
            addLog(`   -> Shard ${shardId}: seal batch failed [${from}..${end - 1}]: ${e?.message || e}`);
            throw e;
          }
        }
        const sealAfter = await provider.connection.getBalance(admin.publicKey);
        const shardSealCost = Math.max(0, sealBefore - sealAfter);
        sealCost += shardSealCost;
        sealDetails.push({ shardId, costLamports: shardSealCost, batches });
        const before = await provider.connection.getBalance(admin.publicKey);
        const { transaction: closeTx } = await (sdk as any).closeRosterShardTx({
          launch: testLaunchState,
          shardId,
          payer: admin.publicKey,
          refundTo: admin.publicKey,
        });
        let deltaForShard = 0;
        try {
          await provider.sendAndConfirm!(closeTx, []);
          const after = await provider.connection.getBalance(admin.publicKey);
          const delta = after - before;
          addLog(`   -> Shard ${shardId} closed. Payer delta: ${(delta / 1e9).toFixed(9)} SOL`);
          if (delta > 0) {
            shardsRentRefundLamports += delta;
          }
          closedShardsCount += 1;
          deltaForShard = delta;
        } catch (e: any) {
          addLog(`   -> Shard ${shardId}: close failed: ${e?.message || e}`);
          throw e;
        }
        // Persist seal metrics on the function scope for end summary
        (globalThis as any).__sealCost = (globalThis as any).__sealCost ? (globalThis as any).__sealCost + shardSealCost : shardSealCost;
        const prev = (globalThis as any).__sealDetails || [];
        (globalThis as any).__sealDetails = [...prev, { shardId, costLamports: shardSealCost, batches }];
        (globalThis as any).__shardsRentRefundLamports = ((globalThis as any).__shardsRentRefundLamports ?? 0) + Math.max(0, deltaForShard);
        (globalThis as any).__closedShardsCount = ((globalThis as any).__closedShardsCount ?? 0) + 1;
      }
    }

    // 7. Create Pool (prepare, Raydium CLMM creation, add liquidity)
    addLog(`\n[7/10] Prepare Pool Creation...`);
    await preparePoolCreationWithRetry({ sdk, launchPda: testLaunchState, addLog });

    let mintedBaseMint: PublicKey | null = null;
    const wantTestMint = !!(simConfig && (simConfig as any).useTestMintForBase);
    if (wantTestMint) {
      mintedBaseMint = await mintForTestSafe({ sdk, launchPda: testLaunchState, baseMintKeypair: testBaseMint, addLog });
      addLog(`      - Minted base mint (test): ${mintedBaseMint.toBase58()}`);
    } else {
      let clmmProgramStr = String((config as any).clmmProgram || "");
      if (!clmmProgramStr) {
        try {
          const raydiumFromSdk = (sdk as any).getRaydiumClmmProgramId?.();
          if (raydiumFromSdk) {
            clmmProgramStr = raydiumFromSdk.toBase58();
          }
        } catch (_) {}
      }
      if (!clmmProgramStr) {
        const ep = (provider as any)?.connection?.rpcEndpoint || "";
        clmmProgramStr = ep.includes("devnet")
          ? "DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH"
          : "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK";
      }
      (config as any).clmmProgram = clmmProgramStr;
      const clmmProgramPk = new PublicKey(clmmProgramStr);

      const createPool = await (sdk as any).createClmmPoolTx({
        payer: (provider as any).wallet.publicKey,
        launch: testLaunchState,
        clmmProgram: clmmProgramPk,
        provider,
      });
      const sig = await (provider as any).sendAndConfirm(createPool.transaction, createPool.signers);
      addLog(`      - CLMM pool created. Signature: ${sig}`);
      mintedBaseMint = createPool.baseMint;
      try {
        if (!mintedBaseMint) {
          throw new Error("Base mint missing after CLMM pool creation");
        }
        addLog(`      - Base mint: ${mintedBaseMint.toBase58()}`);

        const addLiq = await (sdk as any).addClmmLiquidityTx({
          payer: (provider as any).wallet.publicKey,
          launch: testLaunchState,
          baseMint: mintedBaseMint,
          provider,
        });
        const sigL = await (provider as any).sendAndConfirm(addLiq.transaction, addLiq.signers);
        addLog(`      - Initial liquidity added. Signature: ${sigL}`);
        try {
          const baseVaultBal = await provider.connection.getTokenAccountBalance(addLiq.baseVault);
          const quoteVaultBal = await provider.connection.getTokenAccountBalance(addLiq.quoteVault);
          const baseUi = Number(baseVaultBal.value.uiAmount ?? baseVaultBal.value.uiAmountString ?? "0");
          const quoteUi = Number(quoteVaultBal.value.uiAmount ?? quoteVaultBal.value.uiAmountString ?? "0");
          poolBaseLiquidityUi = baseUi;
          poolQuoteLiquidityUi = quoteUi;
          addLog(`      - Pool liquidity: base=${baseUi} quote=${quoteUi}`);
        } catch (_) {}
      } catch (liqErr: any) {
        addLog(`      - Warning: addClmmLiquidity failed (claims may remain closed): ${liqErr?.message || liqErr}`);
      }
    }
    const baseMintForClaims: PublicKey = mintedBaseMint ?? testBaseMint.publicKey;
    await updateSupplySnapshot(mintedBaseMint);

    // 9. Test User Token & Refund Claiming (must be after pool created)
    addLog(`\n[9/10] Testing User Token & Refund Claiming...`);
    try {
      const poolStateAcc = await (sdk as any).fetchPoolState(testLaunchState);
      const claimsReady = !!(poolStateAcc?.claimsReady);
      if (!claimsReady) {
        addLog(`   -> Claims are not ready (CLMM liquidity not added). Skipping user claims/refunds step.`);
        addLog(`   -> Note: On non-Rayduim networks, addClmmLiquidity may fail; claims stay closed by design.`);
        try {
          addLog(`\n--- DISTRIBUTION SUMMARY (claims not ready) ---`);
          const launchForSummary: any = await (sdk as any).fetchLaunch(testLaunchState);
          const totalSOLCollected = Number(launchForSummary.totalDeposited ?? 0);
          addLog(`   Total SOL collected:      ${(totalSOLCollected / 1e9).toFixed(4)} SOL`);
          if (mintedBaseMint) {
            addLog(`   Base mint:                ${mintedBaseMint.toBase58()}`);
            await updateSupplySnapshot(mintedBaseMint);
          }
          addLog(`   ------------------------------------`);
        } catch (_) {}
        addLog(`\n✅ Full flow finished successfully (claims step skipped due to claims_ready=false).`);
        return { success: true, message: "Flow completed (claims skipped)" };
      }
    } catch (_) {
      // If pool state missing, treat as not ready
      addLog(`   -> Pool state not found; skipping claims step.`);
      try {
        addLog(`\n--- DISTRIBUTION SUMMARY (no pool) ---`);
        const launchForSummary: any = await (sdk as any).fetchLaunch(testLaunchState);
        const totalSOLCollected = Number(launchForSummary.totalDeposited ?? 0);
        addLog(`   Total SOL collected:      ${(totalSOLCollected / 1e9).toFixed(4)} SOL`);
        if (mintedBaseMint) {
          addLog(`   Base mint:                ${mintedBaseMint.toBase58()}`);
          await updateSupplySnapshot(mintedBaseMint);
        }
        addLog(`   ------------------------------------`);
      } catch (_) {}
      addLog(`\n✅ Full flow finished successfully (claims step skipped; pool not created).`);
      return { success: true, message: "Flow completed (no pool yet)" };
    }

    for (const [user, info] of usersWithDeposits.entries()) {
      stats.registerUser({
        user,
        shardId: info.shardId,
        tickets: info.tickets,
        depositLamports: BigInt(info.depositAmount.toString()),
      });
    }

    const allUsersData = Array.from(usersWithDeposits.values());

    function toBytesFromBase64(b64: string): Uint8Array {
      try {
        // @ts-ignore
        if (typeof Buffer !== "undefined" && Buffer.from) return new Uint8Array(Buffer.from(b64, "base64"));
      } catch { }
      const bin = typeof atob === "function" ? atob(b64) : "";
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }

    function parseTokensClaimedFromLogs(logs: string[]): { amount?: number; yApproved?: number } | null {
      if (!logs || !logs.length) return null;
      const discriminator = [25, 128, 244, 55, 241, 136, 200, 91];
      for (const line of logs) {
        const idx = line.indexOf("Program data: ");
        if (idx === -1) continue;
        const b64 = line.slice(idx + "Program data: ".length).trim();
        if (!b64) continue;
        const bytes = toBytesFromBase64(b64);
        if (bytes.length < 8) continue;
        let match = true;
        for (let i = 0; i < 8; i++) if (bytes[i] !== discriminator[i]) { match = false; break; }
        if (!match) continue;
        if (bytes.length < 8 + 32 + 32 + 8 + 4) continue;
        const amountView = new DataView(bytes.buffer, bytes.byteOffset + 8 + 32 + 32, 8);
        const yView = new DataView(bytes.buffer, bytes.byteOffset + 8 + 32 + 32 + 8, 4);
        const amountLo = amountView.getUint32(0, true);
        const amountHi = amountView.getUint32(4, true);
        const amount = Number((BigInt(amountHi) << 32n) + BigInt(amountLo));
        const yApproved = yView.getUint32(0, true);
        return { amount, yApproved };
      }
      return null;
    }

    const demoUser = allUsersData[0];
    if (demoUser) {
      addLog(`   -> Demo: simulating token claim for ${demoUser.keypair.publicKey.toBase58()} (shard ${demoUser.shardId})`);
      try {
        const { transaction, userAta } = await (sdk as any).claimTokensTx({
          launch: testLaunchState,
          baseMint: baseMintForClaims,
          userPubkey: demoUser.keypair.publicKey,
          shardId: demoUser.shardId,
          createAtaIfMissing: true,
        });
        const latest = await provider.connection.getLatestBlockhash();
        transaction.feePayer = provider.wallet.publicKey;
        transaction.recentBlockhash = latest.blockhash ?? latest;
        let sim: any;
        try {
          sim = await provider.connection.simulateTransaction(transaction, { sigVerify: false, replaceRecentBlockhash: true } as any);
        } catch (_) {
          sim = await provider.connection.simulateTransaction(transaction as any);
        }
        const logs = sim?.value?.logs ?? sim?.logs ?? [];
        const parsed = parseTokensClaimedFromLogs(logs);
        addLog(`      user ATA: ${userAta.toBase58()}`);
        if (sim?.value?.err) {
          addLog(`      simulation error: ${JSON.stringify(sim.value.err)}`);
        } else if (parsed && typeof parsed.amount === "number") {
          const amountUi = parsed.amount / Math.pow(10, 9);
          addLog(`simulation:      would receive: ${amountUi.toFixed(6)} tokens (y_approved=${parsed.yApproved ?? "?"})`);
        } else {
          addLog("simulation:      simulation ok (no parsable event in logs)");
        }
      } catch (e: any) {
        addLog(`      simulation failed: ${e?.message || e}`);
      }
    }

    const totalClaimUsers = allUsersData.length;
    const CLAIM_BATCH_SIZE = totalClaimUsers > 2000 ? 20 : 50;
    addLog(`   -> Claiming for ${totalClaimUsers} users in batches of ${CLAIM_BATCH_SIZE}...`);
    let allResults = [];

    for (let i = 0; i < allUsersData.length; i += CLAIM_BATCH_SIZE) {
      const batch = allUsersData.slice(i, i + CLAIM_BATCH_SIZE);
      addLog(`   -> Processing claim batch ${Math.floor(i / CLAIM_BATCH_SIZE) + 1}...`);

      const claimPromises = batch.map(async (userData) => {
        const userPk = userData.keypair.publicKey;
        const userKey = userPk.toBase58();
        const userAta = sdk.getUserAta(baseMintForClaims, userPk);
        const initialBalance = await getTokenBalance(userAta);
        const tryClaimTokens = async () => {
          let attempt = 0;
          const maxAttempts = 3;
          const baseDelay = 200;
          for (;;) {
            try {
              await sdk.claimTokens({
                launch: testLaunchState,
                baseMint: baseMintForClaims,
                userKeypair: userData.keypair,
                createAtaIfMissing: true,
                shardId: userData.shardId,
              });
              return true;
            } catch (e: any) {
              const msg = String(e?.message || "");
              if (msg.includes("NoTokensToClaim")) return false;
              const transient = msg.includes("aborted") || msg.includes("Blockhash") || msg.includes("Too many") || msg.includes("ETIMEDOUT") || msg.includes("ECONNRESET") || msg.includes("not confirmed in 30.00 seconds");
              attempt++;
              if (!transient || attempt >= maxAttempts) {
                stats.recordFailure({ user: userKey, phase: "claim", error: e });
                throw e;
              }
              const jitter = Math.floor(Math.random() * 100);
              const delay = baseDelay * Math.min(8, 2 ** (attempt - 1)) + jitter;
              await new Promise(r => setTimeout(r, delay));
            }
          }
        };
        try {
          let tokensClaimedUi = 0;
          const won = await tryClaimTokens();
          if (won) {
            const finalBalance = await getTokenBalance(userAta);
            const deltaUi = finalBalance - initialBalance;
            const deltaAtomic = BigInt(Math.round(deltaUi * 1e9));
            if (deltaAtomic > 0n) {
              stats.recordWinner({ user: userKey, tokensAtomicDelta: deltaAtomic });
              tokensClaimedUi = deltaUi;
            }
          }
          const beforeLamports = await provider.connection.getBalance(userPk);
          let attemptR = 0;
          const maxAttemptsR = 3;
          const baseDelayR = 200;
          for (;;) {
            try {
              await sdk.claimRefund({
                launch: testLaunchState,
                userKeypair: userData.keypair,
                shardId: userData.shardId,
              });
              const afterLamports = await provider.connection.getBalance(userPk);
              const refundDelta = Math.max(0, afterLamports - beforeLamports);
              if (refundDelta > 0) {
                stats.recordLoser({
                  user: userKey,
                  refundLamportsDelta: BigInt(refundDelta),
                });
              }
              if (tokensClaimedUi > 0) {
                return {
                  status: "winner",
                  tokensClaimed: tokensClaimedUi,
                  tickets: userData.tickets,
                };
              }
              return { status: "loser", tickets: userData.tickets };
            } catch (refundError: any) {
              const msg = String(refundError?.message || "");
              const transient = msg.includes("aborted") || msg.includes("Blockhash") || msg.includes("Too many") || msg.includes("ETIMEDOUT") || msg.includes("ECONNRESET") || msg.includes("not confirmed in 30.00 seconds");
              attemptR++;
              if (!transient || attemptR >= maxAttemptsR) {
                stats.recordFailure({ user: userKey, phase: "refund", error: refundError });
                return {
                  status: "failed",
                  type: "refund",
                  error: refundError,
                  publicKey: userPk,
                };
              }
              const jitter = Math.floor(Math.random() * 100);
              const delay = baseDelayR * Math.min(8, 2 ** (attemptR - 1)) + jitter;
              await new Promise(r => setTimeout(r, delay));
            }
          }
        } catch (error: any) {
          stats.recordFailure({ user: userKey, phase: "claim", error });
          return {
            status: "failed",
            type: "token",
            error,
            publicKey: userPk,
          };
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
    let tokensPerTicketBN: BN | null = null;
    try {
      const perScaled: any = (launchStateForDebug as any).tokensPerTicket;
      if (perScaled && typeof perScaled.toString === "function") {
        const candidate = new BN(perScaled.toString());
        if (!candidate.isZero()) tokensPerTicketBN = candidate;
      } else if (typeof perScaled === "number" && perScaled > 0) {
        tokensPerTicketBN = new BN(Math.floor(perScaled));
      }
    } catch {
      tokensPerTicketBN = null;
    }
    if (!tokensPerTicketBN) {
      const publicTicketsNum = typeof (n as any).toNumber === "function" ? (n as any).toNumber() : Number(n);
      const reservedTicketsNum = typeof (reservedTickets as any).toNumber === "function" ? (reservedTickets as any).toNumber() : Number(reservedTickets);
      const grandTotalTickets = Math.max(0, publicTicketsNum + reservedTicketsNum);
      const kNum = typeof (k as any).toNumber === "function" ? (k as any).toNumber() : Number(k);
      const divisor = Math.max(1, Math.min(grandTotalTickets, kNum));
      const baseTotalAllocationBn = new BN((launchStateForDebug as any).baseTotalAllocation.toString());
      const saleBpsBn = new BN(((launchStateForDebug as any).baseSaleBasisPoints ?? 0).toString());
      const saleAtomic = baseTotalAllocationBn.mul(saleBpsBn).div(new BN(10000));
      tokensPerTicketBN = saleAtomic.div(new BN(divisor));
      addLog(`   -> tokensPerTicket fallback used (saleAtomic/divisor model)`);
    }
    const minTicketsForExpectation = Math.min(
      typeof (n as any).toNumber === "function" ? (n as any).toNumber() : Number(n),
      typeof (k_pub as any).toNumber === "function" ? (k_pub as any).toNumber() : Number(k_pub)
    );
    const expectedTotalTokensBN = tokensPerTicketBN.mul(new BN(Math.max(0, minTicketsForExpectation)));

    addLog(`\n--- WINNING ALGORITHM DEBUG ---`);
    addLog(`   -> Total tickets in system: ${totalTicketsInSystem}`);
    addLog(`   -> Public total tickets (n): ${n}`);
    addLog(`   -> K capacity: ${k}`);
    addLog(`   -> Reserved tickets (creator): ${reservedTickets}`);
    addLog(`   -> K public (k_pub): ${k_pub}`);
    addLog(`   -> Expected win probability: ${expectedWinProbability.toFixed(4)}%`);
    addLog(`   -> Actual win rate: ${actualWinRate.toFixed(4)}%`);
    // Print tokens per ticket and expected totals in UI units
    const tokensPerTicketUi = Number(tokensPerTicketBN.toString()) / DECIMALS_SCALE_FACTOR;
    const expectedTotalTokensUi = Number(expectedTotalTokensBN.toString()) / DECIMALS_SCALE_FACTOR;
    addLog(`   -> Tokens per ticket: ${tokensPerTicketUi.toFixed(6)}`);
    addLog(`   -> Expected total tokens: ${expectedTotalTokensUi.toFixed(6)}`);
    addLog(`   -> Actual total tokens: ${tokensClaimed.toFixed(6)}`);
    addLog(`   -> Difference: ${(expectedTotalTokensUi - tokensClaimed).toFixed(6)}`);
    addLog(`------------------------------------`);


    // Final check for any remaining errors
    if (failedClaims > 0) {
      throw new Error(
        `${failedClaims} users failed to claim either tokens or a refund.`
      );
    }

    let totalTokensClaimedByCreator = 0;
    let totalTokensClaimedByTeam = 0;
    let creatorClaimCost = 0;
    // 10. Test Creator Token Claiming (if creator deposit was made)
    if (config.creatorInitialDepositLamports > 0) {
      const balanceBeforeCreatorClaims = await provider.connection.getBalance(admin.publicKey);
      addLog(
        `\n[10/10] Testing Creator Token Claiming (Accrued Vesting)...`
      );
      addLog(`   -> Creator Deposit: ${config.creatorInitialDepositLamports / 1e9} SOL`);
      addLog(`   -> Lock Period: ${config.creatorClaimLockPeriodSec} seconds per ticket cap`);

      const creatorAta = sdk.getUserAta(baseMintForClaims, admin.publicKey);

      // Ensure creator ATA exists before any claim attempts
      try {
        const { ix } = sdk.buildCreateAtaIx({
          payer: admin.publicKey,
          owner: admin.publicKey,
          mint: baseMintForClaims,
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
            baseMint: baseMintForClaims,
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
          baseMint: baseMintForClaims,
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
          baseMint: baseMintForClaims,
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

    // Team vesting claim (best-effort; logs on-chain state, multi-claim if needed)
    try {
      const vestSec = (config as any).teamVestingDurationSec ?? 1;
      const launchForTeam: any = await sdk.fetchLaunch(testLaunchState);
      let teamOnChain: any = null;
      try { teamOnChain = await sdk.fetchTeamVesting(testLaunchState); } catch (_) { }
      if (teamOnChain) {
        const now = Math.floor(Date.now() / 1000);
        addLog(`[Team Vesting] State before claim: total=${(Number(teamOnChain.totalAllocation) / 1e9).toFixed(6)}, claimed=${(Number(teamOnChain.claimed) / 1e9).toFixed(6)}, duration=${Number(teamOnChain.durationSec)}, start=${Number(teamOnChain.startTs)}, now=${now}`);
        addLog(`[Team Vesting] Launch config: team_bps=${Number(launchForTeam.teamAllocationBasisPoints)}, base_total_allocation=${(Number(launchForTeam.baseTotalAllocation) / 1e9).toFixed(6)}`);
      }
      await new Promise(res => setTimeout(res, Math.max(1, vestSec) * 1000 + 600));
      const teamCreatorAta = sdk.getUserAta(baseMintForClaims, admin.publicKey);
      try {
        const ataInfo = await provider.connection.getAccountInfo(teamCreatorAta);
        if (!ataInfo) {
          const { ix } = sdk.buildCreateAtaIx({ payer: admin.publicKey, owner: admin.publicKey, mint: baseMintForClaims });
          await provider.sendAndConfirm!(new Transaction().add(ix), []);
        }
      } catch (_) { }
      const attemptClaim = async () => {
        const before = await getTokenBalance(teamCreatorAta);
        const { transaction } = await sdk.claimTeamTokensTx({
          launch: testLaunchState,
          baseMint: baseMintForClaims,
          creator: admin.publicKey,
          creatorAta: teamCreatorAta,
          createAtaIfMissing: true,
        });
        try { transaction.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: 3_000_000 })); } catch (_) { }
        transaction.feePayer = admin.publicKey;
        try {
          const latest = await provider.connection.getLatestBlockhash();
          (transaction as any).recentBlockhash = (latest as any)?.blockhash ?? latest;
        } catch (_) { }
        await provider.wallet.signTransaction(transaction as any);
        await provider.sendAndConfirm!(transaction, []);
        const after = await getTokenBalance(teamCreatorAta);
        const delta = Math.max(0, after - before);
        totalTokensClaimedByTeam += delta;
        return delta;
      };
      let retries = 3;
      while (retries-- > 0) {
        try {
          const got = await attemptClaim();
          if (got > 0) addLog(`[Team Vesting] Claimed ${got.toFixed(6)} tokens`);
          if (got === 0) break;
        } catch (e: any) {
          const msg = String(e?.message || e);
          if (msg.includes("NothingToClaim")) break;
          if (msg.includes("TeamClaimTooFrequent")) {
            await new Promise(res => setTimeout(res, 1100));
            continue;
          }
          addLog(`[Team Vesting] Claim skipped: ${msg}`);
          break;
        }
      }
    } catch (e: any) {
      addLog(`[Team Vesting] initTeamVesting skipped: ${String(e?.message || e)}`);
    }

    try {
      const raydiumSwapsCount = (simConfig as any)?.raydiumSwapsCount ?? 10;
      const raydiumSolPerSwap = (simConfig as any)?.raydiumSolPerSwap ?? 1;
      addLog(`\n------------------------------------`);
      addLog(`--- RAYDIUM SWAP PARAMETERS ---`);
      addLog(`   Swaps count: ${raydiumSwapsCount}`);
      addLog(`   SOL per swap: ${raydiumSolPerSwap}`);
      addLog(`------------------------------------`);
      if (mintedBaseMint && poolBaseLiquidityUi !== null && poolQuoteLiquidityUi !== null && raydiumSwapsCount > 0 && raydiumSolPerSwap > 0) {
        addLog(`\n[11/10] Executing Raydium swaps...`);
        await runRaydiumSwaps({
          provider,
          sdk,
          launchPda: testLaunchState,
          baseMint: mintedBaseMint,
          swapsCount: raydiumSwapsCount,
          solPerSwap: raydiumSolPerSwap,
          addLog,
        });
      } else {
        addLog(`\n[11/10] Raydium swaps skipped (pool/liquidity unavailable or zero parameters).`);
      }
    } catch (e: any) {
      addLog(`\n[11/10] Raydium swaps step failed: ${String(e?.message || e)}`);
    }

    // 12. Test CLMM position close: funds should return to creator
    try {
      addLog(`\n[12/10] Testing CLMM position close (funds back to creator)...`);
      if (!mintedBaseMint || poolBaseLiquidityUi === null || poolQuoteLiquidityUi === null) {
        addLog(`   -> Skipped: pool or liquidity not available.`);
      } else {
        // Creator (admin) token accounts for WSOL and base mint
        const WSOL_MINT_PK = new PublicKey("So11111111111111111111111111111111111111112");
        const creatorBaseAta = sdk.getUserAta(mintedBaseMint, admin.publicKey);
        const creatorWsolAta = sdk.getUserAta(WSOL_MINT_PK, admin.publicKey);

        // Ensure ATAs exist (best-effort)
        try {
          const { ix: createBaseAtaIx } = sdk.buildCreateAtaIx({
            payer: admin.publicKey,
            owner: admin.publicKey,
            mint: mintedBaseMint,
          });
          const txBase = new Transaction().add(createBaseAtaIx);
          await provider.sendAndConfirm!(txBase, []);
        } catch (_) { }
        try {
          const { ix: createWsolAtaIx } = sdk.buildCreateAtaIx({
            payer: admin.publicKey,
            owner: admin.publicKey,
            mint: WSOL_MINT_PK,
          });
          const txWsol = new Transaction().add(createWsolAtaIx);
          await provider.sendAndConfirm!(txWsol, []);
        } catch (_) { }

        const baseBefore = await getTokenBalance(creatorBaseAta);
        const wsolBefore = await getTokenBalance(creatorWsolAta);

        addLog(
          `   -> Creator balances before close clmm position: base=${baseBefore.toFixed(
            6
          )} WSOL=${wsolBefore.toFixed(6)}`
        );

        // For this test we attempt to close the CLMM position completely.
        // The on-chain instruction now ignores the client-provided liquidity
        // parameter and instead uses the full on-chain liquidity from the
        // Raydium personal_position account, so we can safely pass 0 here.
        const maxU128 = new BN(0);
        const { creatorTokenAccount0, creatorTokenAccount1 } = await (sdk as any).closeClmmPosition({
          launch: testLaunchState,
          liquidity: maxU128,
          payerKeypair: undefined,
        });

        addLog(`   -> closeClmmPosition used creatorTokenAccount0=${creatorTokenAccount0.toBase58()}, creatorTokenAccount1=${creatorTokenAccount1.toBase58()}`);

        const baseAfter = await getTokenBalance(creatorBaseAta);
        const wsolAfter = await getTokenBalance(creatorWsolAta);

        const baseDelta = baseAfter - baseBefore;
        const wsolDelta = wsolAfter - wsolBefore;

        addLog(`   -> Creator balances delta from CLMM close: base=${baseDelta.toFixed(6)} WSOL=${wsolDelta.toFixed(6)}`);

        if (baseDelta > 0 || wsolDelta > 0) {
          addLog(`   -> ✅ VERIFICATION PASSED: creator received funds from closeClmmPosition.`);
          addLog(`   -> Creator balances after close clmm position: base=${baseAfter.toFixed(6)} WSOL=${wsolAfter.toFixed(6)}`);
        } else {
          throw new Error("Creator did not receive any funds from closeClmmPosition (both deltas are zero).");
        }
      }
    } catch (e: any) {
      addLog(`\n[12/10] CLMM close test failed: ${String(e?.message || e)}`);
      throw e;
    }

    addLog(`\n\n--- DISTRIBUTION SUMMARY ---`);
    addLog(`   Total SOL collected:      ${(totalSOLCollected / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    addLog(`   Total claimed by users:   ${tokensClaimed.toFixed(6)}`);
    addLog(`   Total claimed by creator: ${totalTokensClaimedByCreator.toFixed(6)}`);
    addLog(`   Total claimed by team:    ${totalTokensClaimedByTeam.toFixed(6)}`);
    try {
      if (mintedBaseMint) {
        addLog(`   Base mint:                ${mintedBaseMint.toBase58()}`);
        await updateSupplySnapshot(mintedBaseMint);
      }
    } catch (_) { }
    const poolBaseStr = poolBaseLiquidityUi !== null ? formatLargeQuantity(poolBaseLiquidityUi) : "n/a";
    const poolQuoteStr = poolQuoteLiquidityUi !== null ? formatLargeQuantity(poolQuoteLiquidityUi) : "n/a";
    addLog(`   Pool Liquidity:           base=${poolBaseStr} quote=${poolQuoteStr}`);
    addLog(`   ------------------------------------`);
    const totalDistributed = tokensClaimed + totalTokensClaimedByCreator + totalTokensClaimedByTeam;
    addLog(`   TOTAL DISTRIBUTED:        ${totalDistributed.toFixed(6)}`);
    addLog(`--- END SUMMARY ---\n`);
    try {
      const sealCostLamports = Number((globalThis as any).__sealCost ?? 0);
      const sealDetails: { shardId: number; costLamports: number; batches: number }[] = (globalThis as any).__sealDetails ?? [];
      addLog(`\n--- ADMIN NON-REFUNDABLE COST SUMMARY ---`);
      addLog(`   Crank (set seed):                  ${(setSeedCost / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
      addLog(`   Finalize shards (lottery finalize): ${(finalizeCost / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
      addLog(`   Seal shards total:                  ${(sealCostLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
      if (sealDetails.length > 0) {
        for (const d of sealDetails) {
          addLog(`     - Shard ${d.shardId}: ${ (d.costLamports / LAMPORTS_PER_SOL).toFixed(6) } SOL in ${d.batches} batch(es)`);
        }
      }
      const nonRefundableTotal = setSeedCost + finalizeCost + sealCostLamports;
      addLog(`   ------------------------------------`);
      addLog(`   TOTAL NON-REFUNDABLE ADMIN COST:    ${(nonRefundableTotal / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
      addLog(`--- END ADMIN COST SUMMARY ---`);
    } catch (_) {}

    try {
      const rentRefundLamports = Number((globalThis as any).__shardsRentRefundLamports ?? 0);
      addLog(`\n--- RENT REFUND SUMMARY ---`);
      addLog(`   Total rent returned from closing shards: ${(rentRefundLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
      const grossOperationalCost = trueOperationalCost;
      const netOperationalCost = Math.max(0, grossOperationalCost - rentRefundLamports);
      addLog(`   Gross operational cost (incl. shard rents): ${(grossOperationalCost / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
      addLog(`   Net operational cost after rent return:     ${(netOperationalCost / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    addLog(`--- END RENT REFUND SUMMARY ---`);
    } catch (_) {}

    try {
      if (tokensPerTicketBN) {
        stats.finalizeTickets(BigInt(tokensPerTicketBN.toString()));
      }
    } catch (_) {}
    const statsSummary = stats.getSummary();
    const statsRows = stats.getRows();
    const statsCsv = stats.toCSV();
    addLog("\n✅ Full flow finished successfully!");
    return {
      success: true,
      message: "Flow completed successfully",
      statsRows,
      statsCsv,
      statsSummary,
    };
  } catch (error: any) {
    addLog(`\n--- SCRIPT FAILED ---`);
    addLog(`Error: ${error.message}`);
    console.error("Full flow error details:", error);
    const statsSummary = stats.getSummary();
    const statsRows = stats.getRows();
    const statsCsv = stats.toCSV();
    return {
      success: false,
      message: error.message,
      statsRows,
      statsCsv,
      statsSummary,
    };
  }
}