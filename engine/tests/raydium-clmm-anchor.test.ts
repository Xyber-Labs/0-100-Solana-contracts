import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { assert } from "chai";

import { Engine } from "../target/types/engine";
import EngineSDK from "../ts-sdk/src/engine";

function getExplorerUrl(provider: any, signature: string) {
  const ep = provider.connection.rpcEndpoint;
  const cluster = ep.includes("devnet")
    ? "devnet"
    : ep.includes("testnet")
      ? "testnet"
      : ep.includes("localhost") || ep.includes("127.0.0.1")
        ? "custom&customUrl=" + encodeURIComponent(ep)
        : "mainnet-beta";
  return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
}

describe("engine anchor - raydium clmm", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.engine as Program<Engine>;
  const admin = provider.wallet as any;
  const adminKeypair = (provider.wallet as any).payer as anchor.web3.Keypair;
  const sdk = EngineSDK.create(provider as any, program as any, adminKeypair);

  let clmmLaunchState: anchor.web3.PublicKey;
  let baseMintKeypair: anchor.web3.Keypair;
  const WSOL_MINT = new anchor.web3.PublicKey("So11111111111111111111111111111111111111112");

  const HARD_CAP_LAMPORTS = new anchor.BN(500 * anchor.web3.LAMPORTS_PER_SOL);
  const MIN_RAISE_LAMPORTS = new anchor.BN(10 * anchor.web3.LAMPORTS_PER_SOL);
  const PER_WALLET_CAP = new anchor.BN(5 * anchor.web3.LAMPORTS_PER_SOL);
  const TAU_LAMPORTS = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);
  const ROSTER_SHARD_CAP = 100;
  const SALE_ALLOCATION = new anchor.BN(540_540_000);
  const LP_ALLOCATION = new anchor.BN(459_460_000);
  const BASE_TOTAL = SALE_ALLOCATION.add(LP_ALLOCATION);
  const SALE_BPS = new anchor.BN(Math.floor((SALE_ALLOCATION.toNumber() * 10000) / BASE_TOTAL.toNumber()));

  it("Initializes launch (no deposits here)", async () => {
    const nextId = await sdk.getNextProjectId();
    const { initLaunchTx, signers, launchState } = await sdk.initLaunchTx({
      creator: admin.publicKey,
      projectId: nextId,
      hardCapLamports: HARD_CAP_LAMPORTS,
      minRaiseLamports: MIN_RAISE_LAMPORTS,
      perWalletCap: PER_WALLET_CAP,
      tauLamports: TAU_LAMPORTS,
      baseTotalAllocation: BASE_TOTAL,
      baseSaleBasisPoints: SALE_BPS,
      fundingDurationSeconds: 5,
      rosterShardCap: ROSTER_SHARD_CAP,
      creatorInitialDepositLamports: new anchor.BN(0),
      creatorDailyLamportsLimit: new anchor.BN(0),
      creatorClaimLockPeriodSec: new anchor.BN(2),
      creatorMaxDepositLamports: new anchor.BN(0),
      provider,
    } as any);

    const sig = await provider.sendAndConfirm(initLaunchTx, [adminKeypair, ...signers]);
    console.log("✅ Launch initialized:", sig);
    clmmLaunchState = launchState;

    await sdk.initRoster({ launch: clmmLaunchState });
    await sdk.initRosterShard({ launch: clmmLaunchState, shardId: 0 });
  });

  it("Creates CLMM pool and adds liquidity in separate transactions", async () => {
    console.log("=== Creating CLMM Pool and Adding Liquidity (Separate Transactions) ===");

    // Precondition: reach min raise and finalize selection for our on-chain checks
    {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const user1 = anchor.web3.Keypair.generate();
      const user2 = anchor.web3.Keypair.generate();
      const airdrop = async (to: anchor.web3.PublicKey, lamports: number) => {
        const sig = await provider.connection.requestAirdrop(to, lamports);
        await provider.connection.confirmTransaction(sig, "confirmed");
      };
      // fund users
      await airdrop(user1.publicKey, 6 * anchor.web3.LAMPORTS_PER_SOL);
      await airdrop(user2.publicKey, 6 * anchor.web3.LAMPORTS_PER_SOL);

      const depositAmount = PER_WALLET_CAP; // 5 SOL
      // user1 deposit
      await (program.methods as any)
        .deposit(depositAmount)
        .accounts({
          user: user1.publicKey,
          launchState: clmmLaunchState,
          userContribution: sdk.getUserContributionPda(clmmLaunchState, user1.publicKey)[0],
          rosterShard: sdk.getRosterShardPda(clmmLaunchState, 0)[0],
          escrowAuthority: sdk.getEscrowAuthorityPda(clmmLaunchState)[0],
          launch: clmmLaunchState,
          systemProgram: anchor.web3.SystemProgram.programId,
        } as any)
        .signers([user1])
        .rpc();

      // user2 deposit
      await (program.methods as any)
        .deposit(depositAmount)
        .accounts({
          user: user2.publicKey,
          launchState: clmmLaunchState,
          userContribution: sdk.getUserContributionPda(clmmLaunchState, user2.publicKey)[0],
          rosterShard: sdk.getRosterShardPda(clmmLaunchState, 0)[0],
          escrowAuthority: sdk.getEscrowAuthorityPda(clmmLaunchState)[0],
          launch: clmmLaunchState,
          systemProgram: anchor.web3.SystemProgram.programId,
        } as any)
        .signers([user2])
        .rpc();

      // wait until funding period ends
      await sleep(6000);
      // set seed and finalize shard (selection_finalized happens in preparePoolCreation)
      await sdk.setSeed({ launch: clmmLaunchState });
      await sdk.finalizeRosterShard({ launch: clmmLaunchState, shardId: 0 });
      // finalize selection + record blockhash window
      try {
        await sdk.preparePoolCreation({ launch: clmmLaunchState, computeUnits: 2_000_000 });
      } catch (e) {
        console.log("preparePoolCreation failed (expected on localnet without configured SlotHashes range):", String((e as any)?.message || e));
      }
    }

    baseMintKeypair = anchor.web3.Keypair.generate();

    // Skip CLMM part on localnet if Raydium program is not deployed
    const raydiumProgramId = new anchor.web3.PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");
    const raydiumInfo = await provider.connection.getAccountInfo(raydiumProgramId);
    if (!raydiumInfo) {
      console.log("Raydium CLMM program not found on current cluster. Skipping CLMM part.");
      return;
    }

    const createPool = await sdk.createClmmPoolTx({
      payer: admin.publicKey,
      launch: clmmLaunchState,
      quoteMint: WSOL_MINT,
      baseMint: baseMintKeypair,
      // ammConfig omitted -> derived in SDK
      clmmProgram: raydiumProgramId,
      provider,
    } as any);

    console.log("tickArrayBitmap:", createPool.tickArrayBitmap.toString());
    let createPoolSig: string | undefined;
    try {
      createPoolSig = await provider.sendAndConfirm(createPool.transaction, [adminKeypair, ...createPool.signers]);
      console.log("✅ Pool created:", createPoolSig);
      console.log("Explorer:", getExplorerUrl(provider, createPoolSig));
    } catch (e) {
      console.log("Create pool failed, simulating for logs...");
      try { console.log("Preflight logs:", (e as any)?.logs); } catch {}
      const tx = createPool.transaction;
      try {
        const { blockhash } = await provider.connection.getLatestBlockhash();
        tx.feePayer = admin.publicKey;
        tx.recentBlockhash = blockhash;
        try { tx.partialSign(adminKeypair); } catch {}
        try { createPool.signers.forEach((s: any) => tx.partialSign(s)); } catch {}
        const sim = await (provider as any).simulate(tx, [adminKeypair, ...createPool.signers]);
        console.log("Simulation logs:", sim?.logs ?? sim?.value?.logs);
        console.log("Simulation err:", sim?.err ?? sim?.value?.err);
      } catch (e2) {
        try {
          const sim2 = await provider.connection.simulateTransaction(tx as any, { sigVerify: false, replaceRecentBlockhash: true } as any);
          console.log("Simulation logs:", sim2?.value?.logs);
          console.log("Simulation err:", sim2?.value?.err);
        } catch (e3) {
          console.log("Create pool simulation failed:", String((e3 as any)?.message || e3));
        }
      }
      throw e;
    }

    const sqrtLower = new anchor.BN(5);
    const range = await sdk.getLiquidityRange({ launch: clmmLaunchState, sqrtPriceLowerX64: sqrtLower });
    console.log(`Liquidity range: lower=${range.tickArrayLower}, upper=${range.tickArrayUpper}`);

    const [escrowAuthority] = sdk.getEscrowAuthorityPda(clmmLaunchState);
    const quoteAmountLamports = new anchor.BN(350_000_000_000);
    const totalLamports = quoteAmountLamports.toNumber() + 300_000_000; // +0.3 SOL buffer
    const fundTx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({ fromPubkey: adminKeypair.publicKey, toPubkey: escrowAuthority, lamports: totalLamports })
    );
    await provider.sendAndConfirm(fundTx, [adminKeypair]);

    const baseAmount = LP_ALLOCATION; // amounts expected in mint base units on-chain

    const addLiq = await sdk.addClmmLiquidityTx({
      payer: admin.publicKey,
      launch: clmmLaunchState,
      quoteMint: WSOL_MINT,
      baseMint: baseMintKeypair.publicKey,
      baseTokenAta: createPool.baseTokenAta,
      // ammConfig optional
      clmmProgram: new anchor.web3.PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"),
      provider,
      baseAmount,
      quoteAmount: quoteAmountLamports,
      sqrtPriceLowerX64: sqrtLower,
    } as any);

    console.log("\n=== Debug addresses for add-liquidity ===");
    console.log("launch:", clmmLaunchState.toString());
    console.log("poolState:", addLiq.poolState.toString());
    console.log("baseMint:", baseMintKeypair.publicKey.toString());
    console.log("quoteMint:", WSOL_MINT.toString());
    console.log("quoteVault:", addLiq.quoteVault.toString());
    console.log("baseVault:", addLiq.baseVault.toString());
    console.log("positionNftMint:", addLiq.positionNftMint.toString());
    console.log("positionNftAccount:", (addLiq as any).positionNftAccount?.toString?.() ?? "");
    console.log("personalPosition:", (addLiq as any).personalPosition?.toString?.() ?? "");
    console.log("protocolPosition:", (addLiq as any).protocolPosition?.toString?.() ?? "");
    console.log("ammConfig:", (addLiq as any).ammConfig?.toString?.() ?? "");
    console.log("tickArrayLower:", (addLiq as any).tickArrayLower?.toString?.() ?? "");
    console.log("tickArrayUpper:", (addLiq as any).tickArrayUpper?.toString?.() ?? "");
    console.log("bitmapExtension:", (addLiq as any).bitmapExtension?.toString?.() ?? "");
    console.log("escrowAuthority:", (addLiq as any).escrowAuthority?.toString?.() ?? "");
    console.log("quoteTokenAta:", addLiq.quoteTokenAta.toString());

    let addLiqSig: string | undefined;
    try {
      addLiqSig = await provider.sendAndConfirm(addLiq.transaction, [adminKeypair, ...addLiq.signers]);
      console.log("✅ Liquidity added:", addLiqSig);
    } catch (e) {
      console.log("Add liquidity failed, simulating for logs...");
      try { console.log("Preflight logs:", (e as any)?.logs); } catch { }
      const tx = addLiq.transaction;
      try {
        const { blockhash } = await provider.connection.getLatestBlockhash();
        tx.feePayer = admin.publicKey;
        tx.recentBlockhash = blockhash;
        try { tx.partialSign(adminKeypair); } catch { }
        try { addLiq.signers.forEach((s: any) => tx.partialSign(s)); } catch { }
        try {
          const sim = await (provider as any).simulate(tx, [adminKeypair, ...addLiq.signers]);
          console.log("Simulation logs:", sim?.logs ?? sim?.value?.logs);
          console.log("Simulation err:", sim?.err ?? sim?.value?.err);
        } catch (e1) {
          const sim2 = await provider.connection.simulateTransaction(tx as any, { sigVerify: false, replaceRecentBlockhash: true } as any);
          console.log("Simulation logs:", sim2?.value?.logs);
          console.log("Simulation err:", sim2?.value?.err);
        }
      } catch (e2) {
        console.log("Simulation setup failed:", String((e2 as any)?.message || e2));
      }
      throw e;
    }
    console.log("Explorer:", getExplorerUrl(provider, addLiqSig));

    const qAcc = await provider.connection.getAccountInfo(addLiq.quoteVault);
    assert.ok(qAcc, "Quote vault should exist");
    const qAmt = new anchor.BN(qAcc!.data.slice(64, 72), "le");
    console.log(`Quote vault: ${qAmt.toString()} lamports`);

    const bAcc = await provider.connection.getAccountInfo(addLiq.baseVault);
    assert.ok(bAcc, "Base vault should exist");
    const bAmt = new anchor.BN(bAcc!.data.slice(64, 72), "le");
    console.log(`Base vault: ${bAmt.toString()} tokens`);
  });
});
