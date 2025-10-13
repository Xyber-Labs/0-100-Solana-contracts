import { Program, BN } from "@coral-xyz/anchor";
import {
  Transaction,
  TransactionInstruction,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { Engine as EngineIDL } from "../idl/engine";
import {
  TOKEN_PROGRAM_ID,
  createInitializeMintInstruction,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import { getConstant } from "./utils";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

export class TxBuilder {
  private program: Program<EngineIDL>;
  private seedRoot: Buffer;

  constructor(program: Program<EngineIDL>, admin?: Keypair) {
    this.program = program;
    this.seedRoot = Buffer.from(getConstant("seedRoot", program.idl as any));
  }

  getPda(seeds: (string | Buffer | PublicKey)[]): [PublicKey, number] {
    const seedBuffers = [
      this.seedRoot,
      ...seeds.map((seed) => {
        if (typeof seed === "string") {
          return Buffer.from(seed);
        } else if (typeof seed === "object" && "toBuffer" in seed) {
          return seed.toBuffer();
        } else {
          return seed as Buffer;
        }
      }),
    ];

    return PublicKey.findProgramAddressSync(
      seedBuffers,
      this.program.programId
    );
  }

  getRosterShardPda(launch: PublicKey, shardId: number): [PublicKey, number] {
    const le = Buffer.from(Uint8Array.of(shardId & 0xff, (shardId >> 8) & 0xff));
    return this.getPda(["roster_shard", launch, le]);
  }

  async initLaunchIx(params: {
    creator: PublicKey;
    saleMint: PublicKey;
    hardCapLamports: BN;
    minRaiseLamports: BN;
    perWalletCap: BN;
    tauLamports: BN;
    saleAllocation: BN;
    lpAllocation: BN;
    fundingDurationSeconds: number;
    numBlocks: number;
    rosterShardCap: number;
    creatorInitialDepositLamports: BN;
    creatorDailyLamportsLimit: BN;
    creatorClaimLockPeriodSec: BN;
  }): Promise<{
    instruction: TransactionInstruction;
    launchState: PublicKey;
    escrow: PublicKey;
    projectCounter: PublicKey;
    creatorGrant: PublicKey;
  }> {
    const [launchState] = this.getPda(["launch", params.saleMint]);
    const [escrow] = this.getPda(["escrow", launchState]);
    const [projectCounter] = this.getPda(["project_counter"]);
    const [creatorGrant] = this.getPda(["creator", launchState]);

    const instruction = await this.program.methods
      .initLaunch({
        hardCapLamports: params.hardCapLamports,
        minRaiseLamports: params.minRaiseLamports,
        perWalletCap: params.perWalletCap,
        tauLamports: params.tauLamports,
        saleAllocation: params.saleAllocation,
        lpAllocation: params.lpAllocation,
        fundingDurationSeconds: new BN(params.fundingDurationSeconds),
        numBlocks: new BN(params.numBlocks),
        rosterShardCap: params.rosterShardCap,
        creatorInitialDepositLamports: params.creatorInitialDepositLamports,
        creatorDailyLamportsLimit: params.creatorDailyLamportsLimit,
        creatorClaimLockPeriodSec: params.creatorClaimLockPeriodSec,
      })
      .accountsStrict({
        creator: params.creator,
        launchState: launchState,
        saleMint: params.saleMint,
        escrow: escrow,
        projectCounter: projectCounter,
        creatorGrant: creatorGrant,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    return {
      instruction,
      launchState,
      escrow,
      projectCounter,
      creatorGrant,
    };
  }

  async initLaunchTx(params: {
    creator: PublicKey;
    saleMint: Keypair;
    hardCapLamports: BN;
    minRaiseLamports: BN;
    perWalletCap: BN;
    tauLamports: BN;
    saleAllocation: BN;
    lpAllocation: BN;
    fundingDurationSeconds: number;
    rosterShardCap: number;
    creatorInitialDepositLamports: BN;
    creatorDailyLamportsLimit: BN;
    creatorClaimLockPeriodSec: BN;
    provider: any;
  }): Promise<{
    transaction: Transaction;
    launchState: PublicKey;
    escrow: PublicKey;
    creatorGrant: PublicKey;
    signers: Keypair[];
  }> {
    const createMintAccountIx = SystemProgram.createAccount({
      fromPubkey: params.creator,
      newAccountPubkey: params.saleMint.publicKey,
      space: 82,
      lamports: 2039280, // Fixed rent exemption for 82 bytes
      programId: TOKEN_PROGRAM_ID,
    });

    const initializeMintIx = createInitializeMintInstruction(
      params.saleMint.publicKey,
      6,
      params.creator,
      params.creator
    );

    const {
      instruction: initLaunchIx,
      launchState,
      escrow,
      creatorGrant,
    } = await this.initLaunchIx({
      creator: params.creator,
      saleMint: params.saleMint.publicKey,
      hardCapLamports: params.hardCapLamports,
      minRaiseLamports: params.minRaiseLamports,
      perWalletCap: params.perWalletCap,
      tauLamports: params.tauLamports,
      saleAllocation: params.saleAllocation,
      lpAllocation: params.lpAllocation,
      fundingDurationSeconds: 15, // Default to 30 seconds for tx builder
      numBlocks: 0, // Default to 0, will be set to DEFAULT_N on-chain
      rosterShardCap: params.rosterShardCap,
      creatorInitialDepositLamports: params.creatorInitialDepositLamports,
      creatorDailyLamportsLimit: params.creatorDailyLamportsLimit,
      creatorClaimLockPeriodSec: params.creatorClaimLockPeriodSec,
    });

    const transaction = new Transaction()
      .add(createMintAccountIx)
      .add(initializeMintIx)
      .add(initLaunchIx);

    return {
      transaction,
      launchState,
      escrow,
      creatorGrant,
      signers: [params.saleMint],
    };
  }

  async initRosterIx(params: {
    launch: PublicKey;
    payer: PublicKey;
  }): Promise<{ instruction: TransactionInstruction; rosterPda: PublicKey }> {
    const [rosterPda] = this.getPda(["roster", params.launch]);

    const instruction = await this.program.methods
      .initRoster()
      .accountsStrict({
        payer: params.payer,
        launchState: params.launch,
        roster: rosterPda,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    return { instruction, rosterPda };
  }

  async initRosterTx(params: {
    launch: PublicKey;
    payer: PublicKey;
  }): Promise<{ transaction: Transaction; rosterPda: PublicKey }> {
    const { instruction, rosterPda } = await this.initRosterIx(params);
    const transaction = new Transaction().add(instruction);
    return { transaction, rosterPda };
  }

  async initRosterShardIx(params: {
    launch: PublicKey;
    payer: PublicKey;
    shardId: number;
  }): Promise<{ instruction: TransactionInstruction; rosterShard: PublicKey }> {
    const [rosterShard] = this.getRosterShardPda(params.launch, params.shardId);
    const instruction = await (this.program.methods as any)
      .initRosterShard(params.shardId)
      .accounts({
        payer: params.payer,
        launchState: params.launch,
        rosterShard,
        systemProgram: SystemProgram.programId,
      } as any)
      .instruction();
    return { instruction, rosterShard };
  }

  async setSeedIx(params: { launch: PublicKey; payer: PublicKey }): Promise<{
    instruction: TransactionInstruction;
    selectionPda: PublicKey;
  }> {
    const [selectionPda] = this.getPda(["selection", params.launch]);

    const instruction = await this.program.methods
      .setSeed()
      .accountsStrict({
        payer: params.payer,
        launchState: params.launch,
        slotHashes: anchor.web3.SYSVAR_SLOT_HASHES_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    return { instruction, selectionPda };
  }

  async setSeedTx(params: {
    launch: PublicKey;
    payer: PublicKey;
  }): Promise<{ transaction: Transaction; selectionPda: PublicKey }> {
    const { instruction, selectionPda } = await this.setSeedIx(params);
    const transaction = new Transaction().add(instruction);
    return { transaction, selectionPda };
  }

  async depositIx(params: {
    launch: PublicKey;
    user: PublicKey;
    amount: BN;
    roster?: PublicKey;
    rosterShard?: PublicKey;
    shardId?: number; // if rosterShard not provided
    escrow?: PublicKey;
  }): Promise<{
    instruction: TransactionInstruction;
    userContribution: PublicKey;
  }> {
    const [userContribution] = this.getPda([
      "user",
      params.launch,
      params.user,
    ]);
    const roster = params.roster ?? this.getPda(["roster", params.launch])[0];
    const rosterShard =
      params.rosterShard ??
      this.getRosterShardPda(params.launch, params.shardId ?? 0)[0];
    const escrow = params.escrow ?? this.getPda(["escrow", params.launch])[0];

    const instruction = await this.program.methods
      .deposit(params.amount)
      .accounts({
        user: params.user,
        launchState: params.launch,
        userContribution: userContribution,
        roster: roster,
        rosterShard,
        escrow: escrow,
        launch: params.launch,
        systemProgram: SystemProgram.programId,
      } as any)
      .instruction();

    return { instruction, userContribution };
  }

  async depositTx(params: {
    launch: PublicKey;
    user: PublicKey;
    amount: BN;
    roster?: PublicKey;
    escrow?: PublicKey;
  }): Promise<{ transaction: Transaction; userContribution: PublicKey }> {
    const { instruction, userContribution } = await this.depositIx(params);
    const transaction = new Transaction().add(instruction);
    return { transaction, userContribution };
  }

  async withdrawIx(params: {
    launch: PublicKey;
    user: PublicKey;
    amount: BN;
    roster?: PublicKey;
    rosterShard?: PublicKey;
    shardId?: number;
    escrow?: PublicKey;
  }): Promise<{
    instruction: TransactionInstruction;
    userContribution: PublicKey;
  }> {
    const [userContribution] = this.getPda([
      "user",
      params.launch,
      params.user,
    ]);
    const roster = params.roster ?? this.getPda(["roster", params.launch])[0];
    const rosterShard =
      params.rosterShard ??
      this.getRosterShardPda(params.launch, params.shardId ?? 0)[0];
    const escrow = params.escrow ?? this.getPda(["escrow", params.launch])[0];

    const instruction = await this.program.methods
      .withdraw(params.amount)
      .accounts({
        user: params.user,
        launchState: params.launch,
        userContribution: userContribution,
        roster: roster,
        rosterShard,
        escrow: escrow,
        launch: params.launch,
        systemProgram: SystemProgram.programId,
      } as any)
      .instruction();

    return { instruction, userContribution };
  }

  async withdrawTx(params: {
    launch: PublicKey;
    user: PublicKey;
    amount: BN;
    roster?: PublicKey;
    escrow?: PublicKey;
  }): Promise<{ transaction: Transaction; userContribution: PublicKey }> {
    const { instruction, userContribution } = await this.withdrawIx(params);
    const transaction = new Transaction().add(instruction);
    return { transaction, userContribution };
  }

  async claimRefundIx(params: {
    launch: PublicKey;
    user: PublicKey;
    rosterShard?: PublicKey;
    shardId?: number;
    escrow?: PublicKey;
  }): Promise<{
    instruction: TransactionInstruction;
    userContribution: PublicKey;
  }> {
    const [userContribution] = this.getPda([
      "user",
      params.launch,
      params.user,
    ]);
    const rosterShard =
      params.rosterShard ??
      (params.shardId !== undefined
        ? this.getRosterShardPda(params.launch, params.shardId)[0]
        : (() => { throw new Error("Provide shardId or rosterShard for claimRefund"); })());
    const escrow = params.escrow ?? this.getPda(["escrow", params.launch])[0];

    const instruction = await this.program.methods
      .claimRefund()
      .accounts({
        user: params.user,
        launchState: params.launch,
        userContribution: userContribution,
        rosterShard,
        escrow,
      } as any)
      .instruction();

    return { instruction, userContribution };
  }

  async claimRefundTx(params: {
    launch: PublicKey;
    user: PublicKey;
    selection?: PublicKey;
    escrow?: PublicKey;
  }): Promise<{ transaction: Transaction; userContribution: PublicKey }> {
    const { instruction, userContribution } = await this.claimRefundIx(params);
    const transaction = new Transaction().add(instruction);
    return { transaction, userContribution };
  }

  async claimTokensIx(params: {
    launch: PublicKey;
    saleMint: PublicKey;
    user: PublicKey;
    rosterShard?: PublicKey;
    shardId?: number;
    userAta?: PublicKey;
    createAtaIfMissing?: boolean;
    payer: PublicKey;
  }): Promise<{ instructions: TransactionInstruction[]; userAta: PublicKey }> {
    const [userContribution] = this.getPda([
      "user",
      params.launch,
      params.user,
    ]);
    const rosterShard =
      params.rosterShard ??
      (params.shardId !== undefined
        ? this.getRosterShardPda(params.launch, params.shardId)[0]
        : (() => { throw new Error("Provide shardId or rosterShard for claimTokens"); })());
    const [mintAuth] = this.getPda(["mint_auth", params.launch]);
    const userAta =
      params.userAta ??
      getAssociatedTokenAddressSync(params.saleMint, params.user, true);

    const instructions: TransactionInstruction[] = [];

    if (params.createAtaIfMissing) {
      // In LiteSVM, connection.getAccountInfo may not work, so always create ATA
      try {
        const ataInfo = await this.program.provider.connection.getAccountInfo(
          userAta
        );
        if (!ataInfo) {
          instructions.push(
            createAssociatedTokenAccountInstruction(
              params.payer,
              userAta,
              params.user,
              params.saleMint
            )
          );
        }
      } catch (error) {
        // If connection.getAccountInfo fails (e.g., in LiteSVM), always create ATA
        instructions.push(
          createAssociatedTokenAccountInstruction(
            params.payer,
            userAta,
            params.user,
            params.saleMint
          )
        );
      }
    }

    const claimIx = await this.program.methods
      .claimTokens()
      .accounts({
        user: params.user,
        launchState: params.launch,
        userContribution,
        rosterShard,
        saleMint: params.saleMint,
        mintAuth,
        userAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .instruction();

    instructions.push(claimIx);

    return { instructions, userAta };
  }

  async claimTokensTx(params: {
    launch: PublicKey;
    saleMint: PublicKey;
    user: PublicKey;
    selection?: PublicKey;
    userAta?: PublicKey;
    createAtaIfMissing?: boolean;
    payer: PublicKey;
  }): Promise<{ transaction: Transaction; userAta: PublicKey }> {
    const { instructions, userAta } = await this.claimTokensIx(params);
    const transaction = new Transaction().add(...instructions);
    return { transaction, userAta };
  }

  private ensure32Bytes(seed: Uint8Array | number[] | Buffer): Buffer {
    const buf = Buffer.from(seed);
    if (buf.length !== 32) throw new Error("seed must be 32 bytes");
    return buf;
  }

  async fetchLaunch(launch: PublicKey) {
    return this.program.account.launchState.fetch(launch);
  }

  async fetchRoster(launch: PublicKey) {
    const [pda] = this.getPda(["roster", launch]);
    return this.program.account.roster.fetch(pda);
  }


  async finalizeRosterShardIx(params: {
    launch: PublicKey;
    payer: PublicKey;
    shardId: number;
  }): Promise<{ instruction: TransactionInstruction; rosterShard: PublicKey }> {
    const [rosterShard] = this.getRosterShardPda(params.launch, params.shardId);
    const instruction = await (this.program.methods as any)
      .finalizeRosterShard(params.shardId)
      .accounts({
        payer: params.payer,
        launchState: params.launch,
        rosterShard,
      } as any)
      .instruction();
    return { instruction, rosterShard };
  }

  async openClaimsIx(params: {
    launch: PublicKey;
    payer: PublicKey;
  }): Promise<TransactionInstruction> {
    return (this.program.methods as any)
      .openClaims()
      .accounts({
        payer: params.payer,
        launchState: params.launch,
      } as any)
      .instruction();
  }

  async fetchUserContribution(launch: PublicKey, user: PublicKey) {
    const [pda] = this.getPda(["user", launch, user]);
    return this.program.account.userContribution.fetch(pda);
  }

  async fetchProjectCounter() {
    const [pda] = this.getPda(["project_counter"]);
    return this.program.account.projectCounter.fetch(pda);
  }

  async claimCreatorTokensTx(params: {
    launch: PublicKey;
    saleMint: PublicKey;
    creator: PublicKey;
    creatorAta?: PublicKey;
    createAtaIfMissing?: boolean;
    payer: PublicKey;
  }): Promise<{ transaction: Transaction; creatorAta: PublicKey }> {
    const [creatorGrant] = this.getPda(["creator", params.launch]);
    const [mintAuth] = this.getPda(["mint_auth", params.launch]);
    const creatorAta =
      params.creatorAta ??
      getAssociatedTokenAddressSync(params.saleMint, params.creator, true);

    const transaction = new Transaction();

    if (params.createAtaIfMissing) {
      // In LiteSVM, connection.getAccountInfo may not work, so always create ATA
      try {
        const ataInfo = await this.program.provider.connection.getAccountInfo(
          creatorAta
        );
        if (!ataInfo) {
          transaction.add(
            createAssociatedTokenAccountInstruction(
              params.payer,
              creatorAta,
              params.creator,
              params.saleMint
            )
          );
        }
      } catch (error) {
        // If connection.getAccountInfo fails (e.g., in LiteSVM), always create ATA
        transaction.add(
          createAssociatedTokenAccountInstruction(
            params.payer,
            creatorAta,
            params.creator,
            params.saleMint
          )
        );
      }
    }

    const claimIx = await this.program.methods
      .claimCreatorTokens()
      .accountsStrict({
        creator: params.creator,
        launchState: params.launch,
        creatorGrant,
        saleMint: params.saleMint,
        mintAuth,
        creatorAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    transaction.add(claimIx);

    return { transaction, creatorAta };
  }

  async claimCreatorRefundTx(params: {
    launch: PublicKey;
    creator: PublicKey;
  }): Promise<{ transaction: Transaction }> {
    const [creatorGrant] = this.getPda(["creator", params.launch]);
    const [escrow] = this.getPda(["escrow", params.launch]);

    const transaction = new Transaction();

    const claimIx = await this.program.methods
      .claimCreatorRefund()
      .accountsStrict({
        creator: params.creator,
        launchState: params.launch,
        creatorGrant,
        escrow,
      })
      .instruction();

    transaction.add(claimIx);

    return { transaction };
  }

  async fetchCreatorGrant(launch: PublicKey) {
    const [creatorGrantPda] = this.getPda(["creator", launch]);
    return this.program.account.creatorGrant.fetch(creatorGrantPda);
  }
}
