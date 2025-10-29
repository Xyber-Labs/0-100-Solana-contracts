import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

// ---- IDL ----
import type { Engine as EngineIDL } from "../idl/engine";
import { TxBuilder } from "./txBuilder";

// Import IDL as a dynamic import to avoid require
let idl: any;
const loadIdl = async () => {
  if (!idl) {
    const idlModule = await import("../idl/engine.json");
    idl = idlModule.default;
  }
  return idl;
};

const EngineSDK = {
  idlJson: null, // Will be loaded dynamically
  loadIdl,
  idlType: null as unknown as EngineIDL, // type‑only reference

  /**
   * Creates an SDK on top of an already configured anchor.Program.
   * @param provider Anchor provider (payer = admin/user)
   * @param program Program<EngineIDL> on ENGINE_PROGRAM_ID
   * @param admin Optional admin keypair (defaults to provider wallet)
   */
  create(
    provider: anchor.Provider,
    program: Program<EngineIDL>,
    admin?: anchor.web3.Keypair
  ) {
    const payer = admin?.publicKey ?? provider.publicKey!;
    const adminKeypair = admin;
    const txBuilder = new TxBuilder(program, admin);

    // -------------- PDA helpers --------------
    function getLaunchPda(saleMint: anchor.web3.PublicKey): [anchor.web3.PublicKey, number] {
      return txBuilder.getPda(["launch", saleMint]);
    }

    function getEscrowPda(launch: anchor.web3.PublicKey): [anchor.web3.PublicKey, number] {
      return txBuilder.getPda(["escrow", launch]);
    }

    function getEscrowAuthorityPda(launch: anchor.web3.PublicKey): [anchor.web3.PublicKey, number] {
      return txBuilder.getPda(["escrow_authority", launch]);
    }

    function getRosterPda(launch: anchor.web3.PublicKey): [anchor.web3.PublicKey, number] {
      return txBuilder.getPda(["roster", launch]);
    }

    function getRosterShardPda(launch: anchor.web3.PublicKey, shardId: number): [anchor.web3.PublicKey, number] {
      return txBuilder.getRosterShardPda(launch, shardId);
    }

    function getUserContributionPda(
      launch: anchor.web3.PublicKey,
      user: anchor.web3.PublicKey
    ): [anchor.web3.PublicKey, number] {
      return txBuilder.getPda(["user", launch, user]);
    }

    function getMintAuthPda(launch: anchor.web3.PublicKey): [anchor.web3.PublicKey, number] {
      return txBuilder.getPda(["mint_auth", launch]);
    }

    function getProjectCounterPda(): [anchor.web3.PublicKey, number] {
      return txBuilder.getPda(["project_counter"]);
    }

    function getPoolPda(launch: anchor.web3.PublicKey): [anchor.web3.PublicKey, number] {
      return txBuilder.getPda(["pool", launch]);
    }

    function getCreatorGrantPda(launch: anchor.web3.PublicKey): [anchor.web3.PublicKey, number] {
      return txBuilder.getPda(["creator", launch]);
    }

    // -------------- Utility --------------
    function getUserAta(mint: anchor.web3.PublicKey, owner: anchor.web3.PublicKey): anchor.web3.PublicKey {
      return getAssociatedTokenAddressSync(mint, owner, true);
    }

    function buildCreateAtaIx(args: {
      payer: anchor.web3.PublicKey;
      owner: anchor.web3.PublicKey;
      mint: anchor.web3.PublicKey;
    }): { ata: anchor.web3.PublicKey; ix: anchor.web3.TransactionInstruction } {
      const ata = getUserAta(args.mint, args.owner);
      const ix = createAssociatedTokenAccountInstruction(
        args.payer,
        ata,
        args.owner,
        args.mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      return { ata, ix };
    }

    // =============================
    //          TX methods
    // =============================

    /**
     * IMPORTANT: For claimTokens to work, the mint authority of saleMint
     * must be PDA ["mint_auth", launch_state]. This can be computed in advance,
     * because launch = PDA(["launch", saleMint]).
     */
    async function initLaunch(args: {
      saleMint: anchor.web3.PublicKey;
      hardCapLamports: BN;
      minRaiseLamports: BN;
      perWalletCap: BN;
      tauLamports: BN;
      saleAllocation: BN;
      lpAllocation: BN;
      fundingDurationSeconds: number;
      numBlocks?: number;
      rosterShardCap: number;
      creatorInitialDepositLamports: BN;
      creatorDailyLamportsLimit: BN;
      creatorClaimLockPeriodSec: BN;
      // In tests you can pass preInstructions to create/init mint
      preInstructions?: anchor.web3.TransactionInstruction[];
      signers?: anchor.web3.Keypair[]; // if payer != provider.wallet
      creator?: anchor.web3.Keypair;
    }): Promise<{
      launchPda: anchor.web3.PublicKey;
      escrowPda: anchor.web3.PublicKey;
      signature: string;
    }> {
      const creatorPayer = args.creator?.publicKey ?? payer;
      const { instruction, launchState, escrow } = await txBuilder.initLaunchIx(
        {
          creator: creatorPayer,
          saleMint: args.saleMint,
          hardCapLamports: args.hardCapLamports,
          minRaiseLamports: args.minRaiseLamports,
          perWalletCap: args.perWalletCap,
          tauLamports: args.tauLamports,
          saleAllocation: args.saleAllocation,
          lpAllocation: args.lpAllocation,
          fundingDurationSeconds: args.fundingDurationSeconds,
          numBlocks: args.numBlocks ?? 0,
          rosterShardCap: args.rosterShardCap,
          creatorInitialDepositLamports: args.creatorInitialDepositLamports,
          creatorDailyLamportsLimit: args.creatorDailyLamportsLimit,
          creatorClaimLockPeriodSec: args.creatorClaimLockPeriodSec,
        }
      );

      const tx = new anchor.web3.Transaction();

      if (args.preInstructions && args.preInstructions.length) {
        tx.add(...args.preInstructions);
      }

      tx.add(instruction);

      const signers = args.signers || [];
      if (args.creator) {
        signers.push(args.creator);
      }

      if (!provider.sendAndConfirm) {
        throw new Error("Provider does not support sendAndConfirm");
      }
      const signature = await provider.sendAndConfirm(tx, signers);
      return { launchPda: launchState, escrowPda: escrow, signature };
    }

    async function initRoster(args: {
      launch: anchor.web3.PublicKey;
    }): Promise<{ rosterPda: anchor.web3.PublicKey; signature: string }> {
      const [rosterPda] = getRosterPda(args.launch);

      const rpc = program.methods.initRoster().accountsStrict({
        payer: payer,
        launchState: args.launch,
        roster: rosterPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      });
      const signature = await rpc.rpc();
      return { rosterPda, signature };
    }

    async function setSeed(args: {
      launch: anchor.web3.PublicKey;
      payerKeypair?: anchor.web3.Keypair; // if payer is not provider.wallet
    }): Promise<{ selectionPda: anchor.web3.PublicKey; signature: string }> {
      const [selectionPda] = txBuilder.getPda(["selection", args.launch]);
      const payerPubkey = args.payerKeypair?.publicKey ?? payer;

      const rpc = program.methods.setSeed().accountsStrict({
        payer: payerPubkey,
        launchState: args.launch,
        slotHashes: anchor.web3.SYSVAR_SLOT_HASHES_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
      });
      if (args.payerKeypair) rpc.signers([args.payerKeypair]);
      return { selectionPda, signature: await rpc.rpc() };
    }

    // processBatch deprecated in on-chain program; keep for compatibility but will fail
    async function processBatch(_: any): Promise<{ signature: string }> {
      throw new Error("processBatch deprecated; use finalizeRosterShard + openClaims");
    }

    async function deposit(args: {
      launch: anchor.web3.PublicKey;
      amountLamports: BN;
      userKeypair?: anchor.web3.Keypair;
      roster?: anchor.web3.PublicKey;
      rosterShard?: anchor.web3.PublicKey;
      shardId?: number;
      escrow?: anchor.web3.PublicKey;
    }): Promise<{ userPda: anchor.web3.PublicKey; signature: string }> {
      const userPubkey = args.userKeypair?.publicKey ?? payer;
      const { instruction, userContribution } = await txBuilder.depositIx({
        launch: args.launch,
        user: userPubkey,
        amount: args.amountLamports,
        roster: args.roster,
        rosterShard: args.rosterShard,
        shardId: args.shardId,
        escrow: args.escrow,
      });

      const tx = new anchor.web3.Transaction().add(instruction);
      const signers = args.userKeypair ? [args.userKeypair] : [];
      if (!provider.sendAndConfirm) {
        throw new Error("Provider does not support sendAndConfirm");
      }
      const signature = await provider.sendAndConfirm(tx, signers);
      return { userPda: userContribution, signature };
    }

    async function withdraw(args: {
      launch: anchor.web3.PublicKey;
      amountLamports: BN;
      userKeypair?: anchor.web3.Keypair;
      roster?: anchor.web3.PublicKey;
      rosterShard?: anchor.web3.PublicKey;
      shardId?: number;
      escrow?: anchor.web3.PublicKey;
    }): Promise<{ signature: string }> {
      const userPubkey = args.userKeypair?.publicKey ?? payer;
      const { transaction } = await txBuilder.withdrawTx({
        launch: args.launch,
        user: userPubkey,
        amount: args.amountLamports,
        roster: args.roster,
        // @ts-ignore pass-through for updated builder
        rosterShard: args.rosterShard,
        // @ts-ignore pass-through for updated builder
        shardId: args.shardId,
        escrow: args.escrow,
      } as any);
      const signers = args.userKeypair ? [args.userKeypair] : [];
      if (!provider.sendAndConfirm) {
        throw new Error("Provider does not support sendAndConfirm");
      }
      const signature = await provider.sendAndConfirm(transaction, signers);
      return { signature };
    }

    async function withdrawTx(args: {
      launch: anchor.web3.PublicKey;
      amountLamports: BN;
      userPubkey?: anchor.web3.PublicKey;
      roster?: anchor.web3.PublicKey;
      rosterShard?: anchor.web3.PublicKey;
      shardId?: number;
      escrow?: anchor.web3.PublicKey;
    }): Promise<{ transaction: anchor.web3.Transaction; userContribution: anchor.web3.PublicKey }> {
      const user = args.userPubkey ?? payer;
      return txBuilder.withdrawTx({
        launch: args.launch,
        user,
        amount: args.amountLamports,
        roster: args.roster,
        // @ts-ignore
        rosterShard: args.rosterShard,
        // @ts-ignore
        shardId: args.shardId,
        escrow: args.escrow,
      } as any);
    }

    async function withdrawIx(args: {
      launch: anchor.web3.PublicKey;
      amountLamports: BN;
      userPubkey?: anchor.web3.PublicKey;
      roster?: anchor.web3.PublicKey;
      rosterShard?: anchor.web3.PublicKey;
      shardId?: number;
      escrow?: anchor.web3.PublicKey;
    }): Promise<{
      instruction: anchor.web3.TransactionInstruction;
      userContribution: anchor.web3.PublicKey;
    }> {
      const user = args.userPubkey ?? payer;
      return txBuilder.withdrawIx({
        launch: args.launch,
        user,
        amount: args.amountLamports,
        roster: args.roster,
        // @ts-ignore
        rosterShard: args.rosterShard,
        // @ts-ignore
        shardId: args.shardId,
        escrow: args.escrow,
      } as any);
    }

    async function depositTx(args: {
      launch: anchor.web3.PublicKey;
      amountLamports: BN;
      userPubkey?: anchor.web3.PublicKey;
      roster?: anchor.web3.PublicKey;
      rosterShard?: anchor.web3.PublicKey;
      shardId?: number;
      escrow?: anchor.web3.PublicKey;
    }): Promise<{ transaction: anchor.web3.Transaction; userContribution: anchor.web3.PublicKey }> {
      const user = args.userPubkey ?? payer;
      return txBuilder.depositTx({
        launch: args.launch,
        user,
        amount: args.amountLamports,
        roster: args.roster,
        // @ts-ignore
        rosterShard: args.rosterShard,
        // @ts-ignore
        shardId: args.shardId,
        escrow: args.escrow,
      } as any);
    }

    async function depositIx(args: {
      launch: anchor.web3.PublicKey;
      amountLamports: BN;
      userPubkey?: anchor.web3.PublicKey;
      roster?: anchor.web3.PublicKey;
      rosterShard?: anchor.web3.PublicKey;
      shardId?: number;
      escrow?: anchor.web3.PublicKey;
    }): Promise<{
      instruction: anchor.web3.TransactionInstruction;
      userContribution: anchor.web3.PublicKey;
    }> {
      const user = args.userPubkey ?? payer;
      return txBuilder.depositIx({
        launch: args.launch,
        user,
        amount: args.amountLamports,
        roster: args.roster,
        // @ts-ignore
        rosterShard: args.rosterShard,
        // @ts-ignore
        shardId: args.shardId,
        escrow: args.escrow,
      } as any);
    }

    async function claimRefund(args: {
      launch: anchor.web3.PublicKey;
      userKeypair?: anchor.web3.Keypair;
      rosterShard?: anchor.web3.PublicKey;
      shardId?: number;
      escrow?: anchor.web3.PublicKey;
    }): Promise<{ signature: string }> {
      const userPubkey = args.userKeypair?.publicKey ?? payer;
      const { transaction } = await txBuilder.claimRefundTx({
        launch: args.launch,
        user: userPubkey,
        // @ts-ignore
        rosterShard: args.rosterShard,
        // @ts-ignore
        shardId: args.shardId,
        escrow: args.escrow,
      } as any);
      const signers = args.userKeypair ? [args.userKeypair] : [];
      if (!provider.sendAndConfirm) {
        throw new Error("Provider does not support sendAndConfirm");
      }
      const signature = await provider.sendAndConfirm(transaction, signers);
      return { signature };
    }

    async function claimRefundTx(args: {
      launch: anchor.web3.PublicKey;
      userPubkey: anchor.web3.PublicKey;
      rosterShard?: anchor.web3.PublicKey;
      shardId?: number;
      escrow?: anchor.web3.PublicKey;
    }): Promise<{ transaction: anchor.web3.Transaction; userContribution: anchor.web3.PublicKey }> {
      return txBuilder.claimRefundTx({
        launch: args.launch,
        user: args.userPubkey,
        // @ts-ignore
        rosterShard: args.rosterShard,
        // @ts-ignore
        shardId: args.shardId,
        escrow: args.escrow,
      } as any);
    }

    /**
     * Important:
     * 1) saleMint must have mintAuthority = PDA ["mint_auth", launch].
     * 2) userAta (user's ATA for saleMint) must exist. If
     *    createAtaIfMissing = true, the SDK will add an ix for creation.
     */
    async function createPool(args: {
      launch: anchor.web3.PublicKey;
      payerKeypair?: anchor.web3.Keypair;
      useTestMode?: boolean;
      computeUnits?: number;
      computeUnitPriceMicroLamports?: number;
    }): Promise<{ signature: string }> {
      const payerPubkey = args.payerKeypair?.publicKey ?? payer;
      const { transaction } = await txBuilder.createPoolTx({
        payer: payerPubkey,
        launch: args.launch,
        computeUnits: args.computeUnits,
        computeUnitPriceMicroLamports: args.computeUnitPriceMicroLamports,
      });
      if (!provider.sendAndConfirm) {
        throw new Error("Provider does not support sendAndConfirm");
      }
      const signers = args.payerKeypair ? [args.payerKeypair] : [];
      const signature = await provider.sendAndConfirm(transaction, signers);
      return { signature };
    }

    async function createClmmPool(args: {
      launch: anchor.web3.PublicKey;
      quoteMint: anchor.web3.PublicKey;
      baseMint?: anchor.web3.Keypair;
      ammConfig: anchor.web3.PublicKey;
      clmmProgram: anchor.web3.PublicKey;
    }): Promise<{
      signature: string;
      baseMint: anchor.web3.PublicKey;
      baseTokenAta: anchor.web3.PublicKey;
    }> {
      const baseMint = args.baseMint ?? anchor.web3.Keypair.generate();

      const result = await txBuilder.createClmmPoolTx({
        payer,
        launch: args.launch,
        quoteMint: args.quoteMint,
        baseMint,
        ammConfig: args.ammConfig,
        clmmProgram: args.clmmProgram,
        provider,
      });

      if (!provider.sendAndConfirm) {
        throw new Error("Provider does not support sendAndConfirm");
      }
      // Note: observationKeypair is NOT a signer, it's just a writable account
      const signature = await provider.sendAndConfirm(result.transaction, result.signers);
      return {
        signature,
        baseMint: result.baseMint,
        baseTokenAta: result.baseTokenAta,
      };
    }

    async function claimTokens(args: {
      launch: anchor.web3.PublicKey;
      saleMint: anchor.web3.PublicKey;
      userKeypair?: anchor.web3.Keypair;
      rosterShard?: anchor.web3.PublicKey;
      shardId?: number;
      userAta?: anchor.web3.PublicKey;
      createAtaIfMissing?: boolean;
    }): Promise<{ signature: string; userAta: anchor.web3.PublicKey }> {
      const userPubkey = args.userKeypair?.publicKey ?? payer;
      const { transaction, userAta } = await txBuilder.claimTokensTx({
        launch: args.launch,
        saleMint: args.saleMint,
        user: userPubkey,
        // @ts-ignore
        rosterShard: args.rosterShard,
        // @ts-ignore
        shardId: args.shardId,
        userAta: args.userAta,
        createAtaIfMissing: args.createAtaIfMissing,
        payer: payer,
      } as any);

      const signers = args.userKeypair ? [args.userKeypair] : [];
      if (!provider.sendAndConfirm) {
        throw new Error("Provider does not support sendAndConfirm");
      }
      const signature = await provider.sendAndConfirm(transaction, signers);
      return { signature, userAta };
    }

    async function claimTokensTx(args: {
      launch: anchor.web3.PublicKey;
      saleMint: anchor.web3.PublicKey;
      userPubkey: anchor.web3.PublicKey;
      rosterShard?: anchor.web3.PublicKey;
      shardId?: number;
      userAta?: anchor.web3.PublicKey;
      createAtaIfMissing?: boolean;
    }): Promise<{ transaction: anchor.web3.Transaction; userAta: anchor.web3.PublicKey }> {
      return txBuilder.claimTokensTx({
        launch: args.launch,
        saleMint: args.saleMint,
        user: args.userPubkey,
        // @ts-ignore
        rosterShard: args.rosterShard,
        // @ts-ignore
        shardId: args.shardId,
        userAta: args.userAta,
        createAtaIfMissing: args.createAtaIfMissing,
        payer: payer,
      } as any);
    }

    async function initRosterShard(args: { launch: anchor.web3.PublicKey; shardId: number }): Promise<{
      rosterShard: anchor.web3.PublicKey;
      signature: string
    }> {
      const { instruction, rosterShard } = await txBuilder.initRosterShardIx({
        launch: args.launch,
        payer,
        shardId: args.shardId,
      });
      const tx = new anchor.web3.Transaction().add(instruction);
      tx.feePayer = payer;
      const signers = adminKeypair ? [adminKeypair] : [];
      if (!provider.sendAndConfirm) {
        throw new Error("Provider does not support sendAndConfirm");
      }
      const signature = await provider.sendAndConfirm(tx, signers);
      return { rosterShard, signature };
    }

    async function finalizeRosterShard(args: { launch: anchor.web3.PublicKey; shardId: number }): Promise<{
      signature: string
    }> {
      const { instruction } = await txBuilder.finalizeRosterShardIx({
        launch: args.launch,
        payer,
        shardId: args.shardId,
      });
      const tx = new anchor.web3.Transaction().add(instruction);
      tx.feePayer = payer;
      const signers = adminKeypair ? [adminKeypair] : [];
      if (!provider.sendAndConfirm) {
        throw new Error("Provider does not support sendAndConfirm");
      }
      const signature = await provider.sendAndConfirm(tx, signers);
      return { signature };
    }

    async function openClaims(args: { launch: anchor.web3.PublicKey }): Promise<{ signature: string }> {
      const ix = await txBuilder.openClaimsIx({ launch: args.launch, payer });
      const tx = new anchor.web3.Transaction().add(ix);
      tx.feePayer = payer;
      const signers = adminKeypair ? [adminKeypair] : [];
      if (!provider.sendAndConfirm) {
        throw new Error("Provider does not support sendAndConfirm");
      }
      const signature = await provider.sendAndConfirm(tx, signers);
      return { signature };
    }

    async function claimCreatorTokens(args: {
      launch: anchor.web3.PublicKey;
      saleMint: anchor.web3.PublicKey;
      creatorKeypair?: anchor.web3.Keypair;
      creatorAta?: anchor.web3.PublicKey;
      createAtaIfMissing?: boolean;
    }): Promise<{ signature: string; creatorAta: anchor.web3.PublicKey }> {
      const creatorPubkey = args.creatorKeypair?.publicKey ?? payer;
      const { transaction, creatorAta } = await txBuilder.claimCreatorTokensTx({
        launch: args.launch,
        saleMint: args.saleMint,
        creator: creatorPubkey,
        creatorAta: args.creatorAta,
        createAtaIfMissing: args.createAtaIfMissing,
        payer: payer,
      });

      const signers = args.creatorKeypair ? [args.creatorKeypair] : [];
      if (!provider.sendAndConfirm) {
        throw new Error("Provider does not support sendAndConfirm");
      }
      const signature = await provider.sendAndConfirm(transaction, signers);
      return { signature, creatorAta };
    }

    async function claimCreatorTokensTx(args: {
      launch: anchor.web3.PublicKey;
      saleMint: anchor.web3.PublicKey;
      creator: anchor.web3.PublicKey;
      creatorAta?: anchor.web3.PublicKey;
      createAtaIfMissing?: boolean;
    }): Promise<{ transaction: anchor.web3.Transaction; creatorAta: anchor.web3.PublicKey }> {
      return txBuilder.claimCreatorTokensTx({
        launch: args.launch,
        saleMint: args.saleMint,
        creator: args.creator,
        creatorAta: args.creatorAta,
        createAtaIfMissing: args.createAtaIfMissing,
        payer: payer,
      });
    }

    async function claimCreatorRefund(args: {
      launch: anchor.web3.PublicKey;
      creatorKeypair?: anchor.web3.Keypair;
    }): Promise<{ signature: string }> {
      const creatorPubkey = args.creatorKeypair?.publicKey ?? payer;
      const { transaction } = await txBuilder.claimCreatorRefundTx({
        launch: args.launch,
        creator: creatorPubkey,
      });

      const signers = args.creatorKeypair ? [args.creatorKeypair] : [];
      if (!provider.sendAndConfirm) {
        throw new Error("Provider does not support sendAndConfirm");
      }
      const signature = await provider.sendAndConfirm(transaction, signers);
      return { signature };
    }

    async function claimCreatorRefundTx(args: {
      launch: anchor.web3.PublicKey;
      creator: anchor.web3.PublicKey;
    }): Promise<{ transaction: anchor.web3.Transaction }> {
      return txBuilder.claimCreatorRefundTx({
        launch: args.launch,
        creator: args.creator,
      });
    }

    // =============================
    //         FETCH helpers
    // =============================

    async function fetchLaunch(launch: anchor.web3.PublicKey) {
      return txBuilder.fetchLaunch(launch);
    }

    async function fetchRoster(launch: anchor.web3.PublicKey) {
      return txBuilder.fetchRoster(launch);
    }


    async function fetchUserContribution(launch: anchor.web3.PublicKey, user: anchor.web3.PublicKey) {
      return txBuilder.fetchUserContribution(launch, user);
    }

    async function fetchCreatorGrant(launch: anchor.web3.PublicKey) {
      return txBuilder.fetchCreatorGrant(launch);
    }

    async function fetchProjectCounter() {
      return txBuilder.fetchProjectCounter();
    }

    async function fetchPoolState(launch: anchor.web3.PublicKey) {
      const [pda] = getPoolPda(launch);
      return program.account.poolState.fetch(pda);
    }

    // Get all launch states (projects) from the blockchain
    async function fetchAllProjects() {
      try {
        console.log("Fetching all launch states from blockchain...");
        const allLaunchStates = await program.account.launchState.all();
        console.log(`Found ${allLaunchStates.length} launch states`);

        const projects = allLaunchStates
          .map((account) => {
            const projectId = account.account.projectId.toNumber();
            console.log(
              `Project #${projectId}: Launch PDA = ${account.publicKey.toString()}`
            );
            return {
              projectId,
              launchPda: account.publicKey,
              account: account.account,
              // Try to derive sale mint from launch PDA
              saleMint: account.account.saleMint,
            };
          })
          .sort((a, b) => a.projectId - b.projectId);

        console.log(
          `Sorted projects:`,
          projects.map((p) => `#${p.projectId}`)
        );
        return projects;
      } catch (error) {
        console.error("Error fetching all projects:", error);
        return [];
      }
    }

    // Find project by project ID
    async function findProjectById(projectId: number) {
      try {
        const allProjects = await fetchAllProjects();
        return (
          allProjects.find((project) => project.projectId === projectId) || null
        );
      } catch (error) {
        console.error("Error finding project by ID:", error);
        return null;
      }
    }

    // Get project by launch PDA
    async function getProjectByLaunchPda(launchPda: anchor.web3.PublicKey) {
      try {
        const launchData = await fetchLaunch(launchPda);
        return {
          projectId: launchData.projectId.toNumber(),
          launchPda,
          account: launchData,
          saleMint: launchData.saleMint,
        };
      } catch (error) {
        console.error("Error getting project by launch PDA:", error);
        return null;
      }
    }

    // =============================
    //        HIGH-LEVEL flows
    // =============================

    /** Returns all PDAs for a given saleMint. Convenient for initialization. */
    function deriveAllPdas(saleMint: anchor.web3.PublicKey) {
      const [launch] = getLaunchPda(saleMint);
      const [escrow] = getEscrowPda(launch);
      const [roster] = getRosterPda(launch);
      const [mintAuth] = getMintAuthPda(launch);
      const [projectCounter] = getProjectCounterPda();
      return { launch, escrow, roster, mintAuth, projectCounter };
    }

    // ---- Returned API ----
    return {
      // IDL
      idl,
      program,

      // PDAs
      getLaunchPda,
      getEscrowPda,
      getEscrowAuthorityPda,
      getRosterPda,
      getRosterShardPda,
      getUserContributionPda,
      getMintAuthPda,
      getProjectCounterPda,
      getPoolPda,
      getCreatorGrantPda,
      deriveAllPdas,

      // Utils
      getUserAta,
      buildCreateAtaIx,

      initLaunch,
      initRoster,
      setSeed,
      processBatch,
      deposit,
      withdraw,
      claimRefund,
      claimTokens,
      initRosterShard,
      finalizeRosterShard,
      openClaims,
      claimRefundTx,
      claimTokensTx,
      claimCreatorTokens,
      claimCreatorTokensTx,
      claimCreatorRefund,
      claimCreatorRefundTx,
      createPool,
      createClmmPool,

      initLaunchTx: txBuilder.initLaunchTx.bind(txBuilder),
      initLaunchIx: txBuilder.initLaunchIx.bind(txBuilder),
      initRosterTx: txBuilder.initRosterTx.bind(txBuilder),
      initRosterIx: txBuilder.initRosterIx.bind(txBuilder),
      setSeedTx: txBuilder.setSeedTx.bind(txBuilder),
      setSeedIx: txBuilder.setSeedIx.bind(txBuilder),
      depositTx,
      depositIx,
      withdrawTx,
      withdrawIx,
      createClmmPoolTx: txBuilder.createClmmPoolTx.bind(txBuilder),
      createPoolTx: txBuilder.createPoolTx.bind(txBuilder),
      addClmmLiquidityTx: txBuilder.addClmmLiquidityTx.bind(txBuilder),
      calculateLiquidityRange: txBuilder.calculateLiquidityRange.bind(txBuilder),
      getAddLiquidityInfo: txBuilder.getAddLiquidityInfo.bind(txBuilder),

      fetchLaunch,
      fetchRoster,
      fetchUserContribution,
      fetchCreatorGrant,
      fetchProjectCounter,
      fetchPoolState,
      fetchAllProjects,
      findProjectById,
      getProjectByLaunchPda,
    };
  },
};

export default EngineSDK;
export type { EngineIDL };
