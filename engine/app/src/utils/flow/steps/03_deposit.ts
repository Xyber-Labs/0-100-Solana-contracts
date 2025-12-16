import { FlowStep } from "../step";
import type { FlowContext, UserSimData } from "../types";
import { Keypair, PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { airdropUsersParallel, fundUsersParallel, depositUsersParallel } from "../../flowHelpers";

export class DepositStep extends FlowStep {
  constructor() {
    super("[3/10] Shards & Deposits");
  }

  async execute(context: FlowContext): Promise<void> {
    const { sdk, provider, config, admin, simConfig, addLog, testLaunchState } = context;
    if (!testLaunchState) throw new Error("Launch state not initialized");

    const LAMPORTS_PER_SOL = 1_000_000_000;

    // --- Calculate Shards ---
    const kCapacityExpected = Math.floor(config.hardCapLamports / config.tauLamports);
    const reservedExpected = Math.floor(
      (config.creatorInitialDepositLamports > 0
        ? (config.creatorInitialDepositLamports / config.hardCapLamports) * kCapacityExpected
        : 0)
    );
    const kPubExpected = Math.max(0, kCapacityExpected - reservedExpected);
    config.creatorDailyLamportsLimit = Math.max(
      config.creatorDailyLamportsLimit ?? 0,
      reservedExpected * config.tauLamports
    );

    const MAX_TICKETS_PER_USER = Math.max(1, simConfig.maxTicketsPerUser);
    const MIN_TICKETS_PER_USER = Math.max(1, (simConfig as any).minTicketsPerUser ?? 1);
    const usersNeeded = Math.ceil(kPubExpected / MAX_TICKETS_PER_USER);
    const requestedUsers = simConfig.numUsers && simConfig.numUsers > 0 ? simConfig.numUsers : usersNeeded;
    
    // Roster Shards Total logic from InitLaunchStep might have adjusted config, but we read from config again or recompute
    const kCap = Math.floor(config.hardCapLamports / config.tauLamports);
    const rosterShardsTotal = (config as any).rosterShardsTotal && (config as any).rosterShardsTotal > 0
      ? Math.min(65535, (config as any).rosterShardsTotal)
      : Math.min(65535, Math.ceil(kCap / Math.max(1, config.rosterShardCap)));

    const maxUsersCapacity = rosterShardsTotal * config.rosterShardCap;
    const TARGET_USERS = Math.min(requestedUsers, maxUsersCapacity);
    const numShards = Math.min(Math.ceil(TARGET_USERS / config.rosterShardCap), rosterShardsTotal);

    addLog(`\n[3/10] Calculated ${numShards}/${rosterShardsTotal} shards for ${TARGET_USERS} target users...`);
    if (requestedUsers > TARGET_USERS) {
      addLog(`   -> Requested ${requestedUsers} users exceeds capacity. Capped to ${TARGET_USERS}.`);
    }

    // --- Init Roster Shards ---
    const balanceBeforeShards = await provider.connection.getBalance(admin.publicKey);
    for (let i = 1; i <= numShards; i++) {
      try {
        await sdk.initRosterShard({ launch: testLaunchState, shardId: i });
        addLog(`   -> Shard ${i} initialized.`);
      } catch (error: any) {
        if (error.message && error.message.includes("custom program error: 0x0")) {
          addLog(`   -> Shard ${i} was already initialized.`);
        } else {
          throw error;
        }
      }
    }
    const balanceAfterShards = await provider.connection.getBalance(admin.publicKey);
    context.metrics.shardCreationCost = balanceBeforeShards - balanceAfterShards;

    // --- Simulate User Deposits (Gen Keys) ---
    addLog(`\n[3/10] Simulating deposits for ${TARGET_USERS} users...`);
    const ticketsSliderRaw = (simConfig as any).ticketsTargetMultiplier;
    const ticketsSlider = typeof ticketsSliderRaw === "number" && ticketsSliderRaw > 0 ? ticketsSliderRaw : 1;
    const ticketsSliderClamped = Math.max(1, Math.min(ticketsSlider, 100));
    const fillRatio = (ticketsSliderClamped - 1) / 99;

    const ticketsPerUser: number[] = new Array(TARGET_USERS).fill(0);
    if (ticketsSliderClamped === 100) {
      for (let i = 0; i < TARGET_USERS; i++) { ticketsPerUser[i] = MAX_TICKETS_PER_USER; }
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

    const provisionalUsers: UserSimData[] = [];
    for (let i = 0; i < TARGET_USERS; i++) {
      const tickets = ticketsPerUser[i];
      const keypair = Keypair.generate();
      const depositAmount = new BN(config.tauLamports).mul(new BN(tickets));
      const shardId = 1 + Math.floor(i / config.rosterShardCap);
      provisionalUsers.push({ keypair, tickets, depositAmount, shardId });
    }

    // --- Fund Users ---
    let users = provisionalUsers;
    const useAirdropForUsers = !!(simConfig as any).useAirdropForUsers;
    let cumulativeCost = 0;
    
    if (!useAirdropForUsers) {
        let currentAdminBalance = await provider.connection.getBalance(admin.publicKey);
        const feeBufferPerUser = 5000000;
        const affordableUsers = [];
        for (const user of users) {
            const cost = user.depositAmount.toNumber() + feeBufferPerUser;
            if (cumulativeCost + cost <= currentAdminBalance) {
                cumulativeCost += cost;
                affordableUsers.push(user);
            } else { break; }
        }
        context.userFundingCost += cumulativeCost;
        if (users.length !== affordableUsers.length) {
            addLog(`   -> Admin balance limited funding to ${affordableUsers.length} users.`);
            users = affordableUsers;
        }
        if (users.length === 0) throw new Error("Insufficient admin balance to fund users.");
    }

    context.users = users;
    const numUsersToSimulate = users.length;
    const fundingConcurrency = Math.min(200, numUsersToSimulate);
    addLog(useAirdropForUsers ? `   -> Funding (Airdrop)...` : `   -> Funding (Transfer)...`);
    
    if (useAirdropForUsers) {
      await airdropUsersParallel({ provider, users, concurrency: fundingConcurrency, addLog });
    } else {
      await fundUsersParallel({ provider, admin: admin.publicKey, users, concurrency: fundingConcurrency, addLog });
    }
    addLog("   -> All users funded.");

    // --- Execute Deposits ---
    const depositConcurrency = numUsersToSimulate > 5000 ? 100 : Math.min(200, numUsersToSimulate);
    addLog(`   -> Sending deposit transactions... (concurrency=${depositConcurrency})`);
    
    const depositResults = await depositUsersParallel({ sdk, launchPda: testLaunchState, users, concurrency: depositConcurrency, addLog });
    const successfulResults = depositResults.filter((r) => !!r) as Array<{ pubkey: PublicKey; shardId: number }>;
    
    const failedCount = depositResults.length - successfulResults.length;
    if (failedCount > 0) addLog(`   -> ${failedCount} deposits failed.`);

    for (const result of successfulResults) {
      const k = result.pubkey.toBase58();
      const user = users.find(u => u.keypair.publicKey.toBase58() === k)!;
      context.usersWithDeposits.set(k, {
        keypair: user.keypair,
        tickets: user.tickets,
        shardId: result.shardId,
        depositAmount: user.depositAmount,
      });
    }
    addLog("   -> All deposits completed.");
  }
}

