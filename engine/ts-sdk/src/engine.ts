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
    function getLaunchPda(baseMint: anchor.web3.PublicKey): [anchor.web3.PublicKey, number] {
      return txBuilder.getPda(["launch", baseMint]);
    }

    function getLaunchPdaByProjectId(projectId: number | BN): [anchor.web3.PublicKey, number] {
      const le = BN.isBN(projectId)
        ? (projectId as BN).toArrayLike(Buffer, "le", 8)
        : (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(projectId)); return b; })();
      return txBuilder.getPda(["launch", le]);
    }

    function getEscrowPda(launch: anchor.web3.PublicKey): [anchor.web3.PublicKey, number] {
      return txBuilder.getPda(["escrow_authority", launch]);
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
      user: anchor.web3.PublicKey | { publicKey?: anchor.web3.PublicKey }
    ): [anchor.web3.PublicKey, number] {
      const userSeed = (user as any)?.publicKey && typeof (user as any).publicKey?.toBuffer === "function"
        ? (user as any).publicKey
        : (user as anchor.web3.PublicKey);
      return txBuilder.getPda(["user", launch, userSeed]);
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
     * Initialize a launch by sequential projectId. The base mint will be created later during pool setup.
     */
    async function initLaunch(args: {
      projectId?: BN | number; // optional for backward compatibility; will be auto-filled
      hardCapLamports: BN;
      minRaiseLamports: BN;
      perWalletCap: BN;
      tauLamports: BN;
      baseTotalAllocation: BN;
      baseSaleBasisPoints: BN;
      fundingDurationSeconds: number;
      saleStartTimeSec?: number;
      unlockTimeSec?: number;
      rosterShardCap: number;
      rosterShardsTotal: number;
      creatorInitialDepositLamports: BN;
      creatorDailyLamportsLimit: BN;
      creatorClaimLockPeriodSec: BN;
      // In tests you can pass preInstructions to create/init mint
      preInstructions?: anchor.web3.TransactionInstruction[];
      signers?: anchor.web3.Keypair[]; // if payer != provider.wallet
      creator?: anchor.web3.Keypair;
      creatorMaxDepositLamports: BN;
      poolCreationGracePeriodSec?: number;
      xyberMint?: anchor.web3.PublicKey;
      name: string;
      symbol: string;
      uri: string;
      isMutable?: boolean;
      sellerFeeBasisPoints?: number;
    }): Promise<{
      launchPda: anchor.web3.PublicKey;
      escrowPda: anchor.web3.PublicKey;
      signature: string;
    }> {
      const creatorPayer = args.creator?.publicKey ?? payer;
      const projectId = args.projectId ?? (await getNextProjectId());
      const metaName = args.name;
      const metaSymbol = args.symbol;
      const metaUri = args.uri;
      const metaMutable = typeof args.isMutable === "boolean" ? args.isMutable : false;
      const metaSellerFeeBps = typeof args.sellerFeeBasisPoints === "number" ? args.sellerFeeBasisPoints : 0;
      const xyberMintPk = args.xyberMint ?? (await (async () => {
        try {
          const [engineConfig] = (txBuilder as any).getConfigPda ? (txBuilder as any).getConfigPda() : txBuilder.getPda(["config"]);
          const cfg: any = await (program.account as any).engineConfig.fetch(engineConfig);
          if (!cfg?.xyberMint) throw new Error("missing xyberMint in EngineConfig");
          return cfg.xyberMint as anchor.web3.PublicKey;
        } catch (e) {
          throw new Error("xyberMint not provided and EngineConfig.xyberMint not set");
        }
      })());
      const { instruction, launchState, escrowAuthority } = await txBuilder.initLaunchIx(
        {
          creator: creatorPayer,
          projectId,
          hardCapLamports: args.hardCapLamports,
          minRaiseLamports: args.minRaiseLamports,
          perWalletCap: args.perWalletCap,
          tauLamports: args.tauLamports,
          baseTotalAllocation: args.baseTotalAllocation,
          baseSaleBasisPoints: args.baseSaleBasisPoints,
          fundingDurationSeconds: args.fundingDurationSeconds,
          saleStartTimeSec: args.saleStartTimeSec ?? 0,
          unlockTimeSec: args.unlockTimeSec ?? 0,
          rosterShardCap: args.rosterShardCap,
          rosterShardsTotal: args.rosterShardsTotal,
          creatorInitialDepositLamports: args.creatorInitialDepositLamports,
          creatorDailyLamportsLimit: args.creatorDailyLamportsLimit,
          creatorClaimLockPeriodSec: args.creatorClaimLockPeriodSec,
          creatorMaxDepositLamports: args.creatorMaxDepositLamports,
          poolCreationGracePeriodSec: args.poolCreationGracePeriodSec,
          xyberMint: xyberMintPk,
          name: metaName,
          symbol: metaSymbol,
          uri: metaUri,
          isMutable: metaMutable,
          sellerFeeBasisPoints: metaSellerFeeBps,
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
      return { launchPda: launchState, escrowPda: escrowAuthority, signature };
    }

    // Convenience: fetch next projectId and initialize launch in one call
    async function initLaunchAuto(args: {
      hardCapLamports: BN;
      minRaiseLamports: BN;
      perWalletCap: BN;
      tauLamports: BN;
      baseTotalAllocation: BN;
      baseSaleBasisPoints: BN;
      fundingDurationSeconds: number;
      saleStartTimeSec?: number;
      unlockTimeSec?: number;
      rosterShardCap: number;
      rosterShardsTotal: number;
      creatorInitialDepositLamports: BN;
      creatorDailyLamportsLimit: BN;
      creatorClaimLockPeriodSec: BN;
      preInstructions?: anchor.web3.TransactionInstruction[];
      signers?: anchor.web3.Keypair[];
      creator?: anchor.web3.Keypair;
      creatorMaxDepositLamports: BN;
      poolCreationGracePeriodSec?: number;
      xyberMint?: anchor.web3.PublicKey;
      name: string;
      symbol: string;
      uri: string;
      isMutable?: boolean;
      sellerFeeBasisPoints?: number;
    }): Promise<{
      projectId: BN;
      launchPda: anchor.web3.PublicKey;
      escrowPda: anchor.web3.PublicKey;
      signature: string;
    }> {
      const projectId = await getNextProjectId();
      const res = await initLaunch({
        ...args,
        projectId,
        name: args.name,
        symbol: args.symbol,
        uri: args.uri,
        isMutable: args.isMutable,
        sellerFeeBasisPoints: args.sellerFeeBasisPoints,
      });
      return { projectId, ...res };
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
      throw new Error("processBatch deprecated; use finalizeRosterShard + preparePoolCreation");
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
     * 1) baseMint must have mintAuthority = PDA ["mint_auth", launch].
     * 2) userAta (user's ATA for baseMint) must exist. If
     *    createAtaIfMissing = true, the SDK will add an ix for creation.
     */
    async function preparePoolCreation(args: {
      launch: anchor.web3.PublicKey;
      payerKeypair?: anchor.web3.Keypair;
      useTestMode?: boolean;
      computeUnits?: number;
      computeUnitPriceMicroLamports?: number;
    }): Promise<{ signature: string }> {
      const payerPubkey = args.payerKeypair?.publicKey ?? payer;
      const { transaction } = await txBuilder.preparePoolCreationTx({
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

    async function mintForTest(args: {
      launch: anchor.web3.PublicKey;
      baseMint?: anchor.web3.Keypair;
    }): Promise<{
      signature: string;
      baseMint: anchor.web3.PublicKey;
      baseTokenAta: anchor.web3.PublicKey;
    }> {
      const baseMint = args.baseMint ?? anchor.web3.Keypair.generate();

      const result = await txBuilder.mintForTestTx({
        payer,
        launch: args.launch,
        baseMint,
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
      baseMint: anchor.web3.PublicKey;
      userKeypair?: anchor.web3.Keypair;
      rosterShard?: anchor.web3.PublicKey;
      shardId?: number;
      userAta?: anchor.web3.PublicKey;
      createAtaIfMissing?: boolean;
    }): Promise<{ signature: string; userAta: anchor.web3.PublicKey }> {
      const userPubkey = args.userKeypair?.publicKey ?? payer;
      const { transaction, userAta } = await txBuilder.claimTokensTx({
        launch: args.launch,
        baseMint: args.baseMint,
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
      baseMint: anchor.web3.PublicKey;
      userPubkey: anchor.web3.PublicKey;
      rosterShard?: anchor.web3.PublicKey;
      shardId?: number;
      userAta?: anchor.web3.PublicKey;
      createAtaIfMissing?: boolean;
    }): Promise<{ transaction: anchor.web3.Transaction; userAta: anchor.web3.PublicKey }> {
      return txBuilder.claimTokensTx({
        launch: args.launch,
        baseMint: args.baseMint,
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

    // openClaims removed; preparePoolCreation now finalizes and opens claims

    async function claimCreatorTokens(args: {
      launch: anchor.web3.PublicKey;
      baseMint: anchor.web3.PublicKey;
      creatorKeypair?: anchor.web3.Keypair;
      creatorAta?: anchor.web3.PublicKey;
      createAtaIfMissing?: boolean;
    }): Promise<{ signature: string; creatorAta: anchor.web3.PublicKey }> {
      const creatorPubkey = args.creatorKeypair?.publicKey ?? payer;
      const { transaction, creatorAta } = await txBuilder.claimCreatorTokensTx({
        launch: args.launch,
        baseMint: args.baseMint,
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
      baseMint: anchor.web3.PublicKey;
      creator: anchor.web3.PublicKey;
      creatorAta?: anchor.web3.PublicKey;
      createAtaIfMissing?: boolean;
    }): Promise<{ transaction: anchor.web3.Transaction; creatorAta: anchor.web3.PublicKey }> {
      return txBuilder.claimCreatorTokensTx({
        launch: args.launch,
        baseMint: args.baseMint,
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

    async function initTeamVesting(args: { launch: anchor.web3.PublicKey; payerKeypair?: anchor.web3.Keypair }): Promise<{ signature: string }> {
      const payerPubkey = args.payerKeypair?.publicKey ?? payer;
      const { transaction } = await txBuilder.initTeamVestingTx({ payer: payerPubkey, launch: args.launch });
      const signers = args.payerKeypair ? [args.payerKeypair] : [];
      if (!provider.sendAndConfirm) throw new Error("Provider does not support sendAndConfirm");
      const signature = await provider.sendAndConfirm(transaction, signers);
      return { signature };
    }

    async function initTeamVestingTx(args: { launch: anchor.web3.PublicKey; payerPubkey?: anchor.web3.PublicKey }): Promise<{ transaction: anchor.web3.Transaction }> {
      const payerPubkey = args.payerPubkey ?? payer;
      const { transaction } = await txBuilder.initTeamVestingTx({ payer: payerPubkey, launch: args.launch });
      return { transaction };
    }

    async function initEngineConfig(args: {
      treasury: anchor.web3.PublicKey;
      creationFee: BN;
      xyberMint: anchor.web3.PublicKey;
      admins: [anchor.web3.PublicKey, anchor.web3.PublicKey, anchor.web3.PublicKey];
      threshold: number;
      adminKeypairs?: anchor.web3.Keypair[];
    }): Promise<{ engineConfig: anchor.web3.PublicKey; signature: string }> {
      const { instruction, engineConfig } = await txBuilder.initEngineConfigIx({
        payer,
        treasury: args.treasury,
        creationFee: args.creationFee,
        xyberMint: args.xyberMint,
        admins: args.admins,
        threshold: args.threshold,
        signerAdmins: (args.adminKeypairs ?? []).map((k) => k.publicKey),
      });
      const tx = new anchor.web3.Transaction().add(instruction);
      const signers = args.adminKeypairs ?? [];
      if (!provider.sendAndConfirm) throw new Error("Provider does not support sendAndConfirm");
      const signature = await provider.sendAndConfirm(tx, signers);
      return { engineConfig, signature };
    }

    async function updateEngineConfig(args: {
      newTreasury?: anchor.web3.PublicKey;
      newCreationFee?: BN;
      newXyberMint?: anchor.web3.PublicKey;
      newAdmins?: [anchor.web3.PublicKey, anchor.web3.PublicKey, anchor.web3.PublicKey];
      newThreshold?: number;
      signerAdmins: anchor.web3.Keypair[];
    }): Promise<{ engineConfig: anchor.web3.PublicKey; signature: string }> {
      const { instruction, engineConfig } = await txBuilder.updateEngineConfigIx({
        payer,
        newTreasury: args.newTreasury,
        newCreationFee: args.newCreationFee,
        newXyberMint: args.newXyberMint,
        newAdmins: args.newAdmins,
        newThreshold: args.newThreshold,
        signerAdmins: args.signerAdmins.map((k) => k.publicKey),
      });
      const tx = new anchor.web3.Transaction().add(instruction);
      const signers = args.signerAdmins ?? [];
      if (!provider.sendAndConfirm) throw new Error("Provider does not support sendAndConfirm");
      const signature = await provider.sendAndConfirm(tx, signers);
      return { engineConfig, signature };
    }

    async function claimTeamTokens(args: {
      launch: anchor.web3.PublicKey;
      baseMint: anchor.web3.PublicKey;
      creatorKeypair?: anchor.web3.Keypair;
      creatorAta?: anchor.web3.PublicKey;
      createAtaIfMissing?: boolean;
    }): Promise<{ signature: string; creatorAta: anchor.web3.PublicKey }> {
      const creatorPubkey = args.creatorKeypair?.publicKey ?? payer;
      const { transaction, creatorAta } = await txBuilder.claimTeamTokensTx({
        launch: args.launch,
        baseMint: args.baseMint,
        creator: creatorPubkey,
        creatorAta: args.creatorAta,
        createAtaIfMissing: args.createAtaIfMissing,
        payer,
      });
      const signers = args.creatorKeypair ? [args.creatorKeypair] : [];
      if (!provider.sendAndConfirm) throw new Error("Provider does not support sendAndConfirm");
      const signature = await provider.sendAndConfirm(transaction, signers);
      return { signature, creatorAta };
    }

    async function claimTeamTokensTx(args: {
      launch: anchor.web3.PublicKey;
      baseMint: anchor.web3.PublicKey;
      creator: anchor.web3.PublicKey;
      creatorAta?: anchor.web3.PublicKey;
      createAtaIfMissing?: boolean;
    }): Promise<{ transaction: anchor.web3.Transaction; creatorAta: anchor.web3.PublicKey }> {
      return txBuilder.claimTeamTokensTx({
        launch: args.launch,
        baseMint: args.baseMint,
        creator: args.creator,
        creatorAta: args.creatorAta,
        createAtaIfMissing: args.createAtaIfMissing,
        payer,
      });
    }

    async function getLiquidityRange(args: { launch: anchor.web3.PublicKey; sqrtPriceLowerX64: BN }) {
      return txBuilder.getLiquidityRange({ launch: args.launch, sqrtPriceLowerX64: args.sqrtPriceLowerX64 });
    }

    async function getSqrtPriceLowerX64ForPool(args: { launch: anchor.web3.PublicKey; priceBumpMultiplier?: number; lowerRangePow10?: number }) {
      return txBuilder.getSqrtPriceLowerX64ForPool({ launch: args.launch, priceBumpMultiplier: args.priceBumpMultiplier, lowerRangePow10: args.lowerRangePow10 });
    }

    async function estimateQuoteForBase(args: { launch: anchor.web3.PublicKey; baseAmount: BN; safetyBumpBps?: number }) {
      return txBuilder.estimateQuoteForBase({ launch: args.launch, baseAmount: args.baseAmount, safetyBumpBps: args.safetyBumpBps });
    }

    async function creatorDeposit(args: { launch: anchor.web3.PublicKey; amountLamports: BN; creatorKeypair?: anchor.web3.Keypair }): Promise<{ signature: string }> {
      const creatorPubkey = args.creatorKeypair?.publicKey ?? payer;
      const { instruction } = await txBuilder.creatorDepositIx({ launch: args.launch, creator: creatorPubkey, amount: args.amountLamports });
      const tx = new anchor.web3.Transaction().add(instruction);
      const signers = args.creatorKeypair ? [args.creatorKeypair] : [];
      if (!provider.sendAndConfirm) throw new Error("Provider does not support sendAndConfirm");
      const signature = await provider.sendAndConfirm(tx, signers);
      return { signature };
    }

    async function creatorWithdraw(args: { launch: anchor.web3.PublicKey; amountLamports: BN; creatorKeypair?: anchor.web3.Keypair }): Promise<{ signature: string }> {
      const creatorPubkey = args.creatorKeypair?.publicKey ?? payer;
      const { instruction } = await txBuilder.creatorWithdrawIx({ launch: args.launch, creator: creatorPubkey, amount: args.amountLamports });
      const tx = new anchor.web3.Transaction().add(instruction);
      const signers = args.creatorKeypair ? [args.creatorKeypair] : [];
      if (!provider.sendAndConfirm) throw new Error("Provider does not support sendAndConfirm");
      const signature = await provider.sendAndConfirm(tx, signers);
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

    async function fetchTeamVesting(launch: anchor.web3.PublicKey) {
      return txBuilder.fetchTeamVesting(launch);
    }

    async function getNextProjectId(): Promise<BN> {
      try {
        const counter: any = await fetchProjectCounter();
        const last: BN = counter?.lastProjectId ?? new BN(0);
        return last.add(new BN(1));
      } catch (_) {
        return new BN(1);
      }
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
              baseMint: account.account.baseMint,
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

    // Fetch projects created by a specific creator (on-chain memcmp filter)
    async function fetchProjectsByCreator(creator: anchor.web3.PublicKey) {
      try {
        const filters = [
          {
            memcmp: {
              // 8 (discriminator) + 8 (project_id) = 16
              offset: 16,
              bytes: creator.toBase58(),
            },
          },
        ];
        const accounts = await program.account.launchState.all(filters as any);
        return accounts
          .map((a) => ({
            projectId: a.account.projectId.toNumber(),
            launchPda: a.publicKey,
            account: a.account,
            baseMint: a.account.baseMint,
          }))
          .sort((a, b) => a.projectId - b.projectId);
      } catch (error) {
        console.error("Error fetching projects by creator:", error);
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
          baseMint: launchData.baseMint,
        };
      } catch (error) {
        console.error("Error getting project by launch PDA:", error);
        return null;
      }
    }

    // =============================
    //        HIGH-LEVEL flows
    // =============================

    /** Returns all PDAs for a given projectId. Convenient for initialization. */
    function deriveAllPdasByProjectId(projectId: number | BN) {
      const [launch] = getLaunchPdaByProjectId(projectId);
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
      getLaunchPdaByProjectId,
      getEscrowPda,
      getEscrowAuthorityPda,
      getRosterPda,
      getRosterShardPda,
      getUserContributionPda,
      getMintAuthPda,
      getProjectCounterPda,
      getPoolPda,
      getCreatorGrantPda,
      getTeamVestingPda: txBuilder.getTeamVestingPda.bind(txBuilder),
      deriveAllPdas: deriveAllPdasByProjectId,

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
      initLaunchAuto,
      claimTokens,
      initRosterShard,
      finalizeRosterShard,
      claimRefundTx,
      claimTokensTx,
      claimCreatorTokens,
      claimCreatorTokensTx,
      claimCreatorRefund,
      creatorDeposit,
      creatorWithdraw,
      claimCreatorRefundTx,
      initTeamVesting,
      initTeamVestingTx,
      claimTeamTokens,
      claimTeamTokensTx,
      preparePoolCreation,
      createClmmPool,
      mintForTest,
      getLiquidityRange,
      getSqrtPriceLowerX64ForPool,
      estimateQuoteForBase,

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
      preparePoolCreationTx: txBuilder.preparePoolCreationTx.bind(txBuilder),
      addClmmLiquidityTx: txBuilder.addClmmLiquidityTx.bind(txBuilder),

      fetchLaunch,
      fetchRoster,
      fetchUserContribution,
      fetchCreatorGrant,
      fetchTeamVesting,
      fetchProjectCounter,
      fetchPoolState,
      getNextProjectId,
      fetchAllProjects,
      fetchProjectsByCreator,
      findProjectById,
      getProjectByLaunchPda,
      getConfigPda: (txBuilder as any).getConfigPda?.bind(txBuilder) ?? (() => txBuilder.getPda(["config"])),

      initEngineConfig,
      updateEngineConfig,
      initEngineConfigIx: txBuilder.initEngineConfigIx.bind(txBuilder),
      updateEngineConfigIx: txBuilder.updateEngineConfigIx.bind(txBuilder),
      initRosterShardIx: txBuilder.initRosterShardIx.bind(txBuilder),
    };
  },
};

export default EngineSDK;
export type { EngineIDL };
