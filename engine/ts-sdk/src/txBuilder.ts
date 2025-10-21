import { BN, Program, web3 } from "@coral-xyz/anchor";
import { Engine as EngineIDL } from "../idl/engine";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import { getConstant } from "./utils";

const METADATA_PROGRAM_ID = new web3.PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

export class TxBuilder {
  private program: Program<EngineIDL>;
  private seedRoot: Buffer;

  constructor(program: Program<EngineIDL>, admin?: web3.Keypair) {
    this.program = program;
    this.seedRoot = Buffer.from(getConstant("seedRoot", program.idl as any));
  }
  async wrapEscrowWsolIx(params: {
    payer: web3.PublicKey;
    launch: web3.PublicKey;
    amount?: BN | number; // unused if on-chain method takes no args
  }): Promise<web3.TransactionInstruction> {
    const [escrow] = this.getPda(["escrow", params.launch]);
    const [feePayerPda] = this.getPda(["fee_payer", params.launch]);
    const quoteMint = new web3.PublicKey("So11111111111111111111111111111111111111112");
    // Derive ATA for a PDA owner: allowOwnerOffCurve must be true
    const wsolEscrowAta = getAssociatedTokenAddressSync(quoteMint, escrow, true);
    
    const ix = await (this.program.methods as any)
      .wrapEscrowWsol()
      .accounts({
        payer: params.payer,
        launchState: params.launch,
        escrow,
        quoteMint,
        wsolEscrowAta,
        feePayerPda,
        quoteTokenProgram: TOKEN_PROGRAM_ID,
        baseTokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
      })
      .instruction();
    return ix;
  }

  async createFeePayerPdaIx(params: {
    payer: web3.PublicKey;
    launch: web3.PublicKey;
    lamports: BN | number;
  }): Promise<web3.TransactionInstruction> {
    const [escrow] = this.getPda(["escrow", params.launch]);
    const [feePayerPda] = this.getPda(["fee_payer", params.launch]);
    const ix = await (this.program.methods as any)
      .createFeePayerPda(new BN(params.lamports as any))
      .accounts({
        payer: params.payer,
        launchState: params.launch,
        escrow,
        feePayerPda,
        systemProgram: web3.SystemProgram.programId,
      })
      .instruction();
    return ix;
  }

  async topUpFeePayerIx(params: {
    payer: web3.PublicKey;
    launch: web3.PublicKey;
    amountLamports: BN | number;
  }): Promise<web3.TransactionInstruction> {
    const [escrow] = this.getPda(["escrow", params.launch]);
    const [feePayerPda] = this.getPda(["fee_payer", params.launch]);
    const ix = await (this.program.methods as any)
      .topUpFeePayer(new BN(params.amountLamports as any))
      .accounts({
        payer: params.payer,
        launchState: params.launch,
        escrow,
        feePayerPda,
        systemProgram: web3.SystemProgram.programId,
      })
      .instruction();
    return ix;
  }

  async unwrapAndTransferSolIx(params: {
    payer: web3.PublicKey;
    launch: web3.PublicKey;
    recipient: web3.PublicKey;
    amountLamports: BN | number;
  }): Promise<web3.TransactionInstruction> {
    const [escrow] = this.getPda(["escrow", params.launch]);
    const ix = await (this.program.methods as any)
      .unwrapAndTransferSol(new BN(params.amountLamports as any))
      .accounts({
        payer: params.payer,
        launchState: params.launch,
        escrow,
        quoteMint: new web3.PublicKey("So11111111111111111111111111111111111111112"),
        wsolEscrowAta: getAssociatedTokenAddressSync(
          new web3.PublicKey("So11111111111111111111111111111111111111112"),
          escrow,
          true
        ),
        recipientSystem: params.recipient,
        quoteTokenProgram: TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
      })
      .instruction();
    return ix;
  }

  getPda(seeds: (string | Buffer | web3.PublicKey)[]): [web3.PublicKey, number] {
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

    return web3.PublicKey.findProgramAddressSync(
      seedBuffers,
      this.program.programId
    );
  }

  getRosterShardPda(launch: web3.PublicKey, shardId: number): [web3.PublicKey, number] {
    const le = Buffer.from(Uint8Array.of(shardId & 0xff, (shardId >> 8) & 0xff));
    return this.getPda(["roster_shard", launch, le]);
  }

  async initLaunchIx(params: {
    creator: web3.PublicKey;
    saleMint: web3.PublicKey;
    hardCapLamports: BN;
    minRaiseLamports: BN;
    perWalletCap: BN;
    tauLamports: BN;
    saleAllocation: BN;
    lpAllocation: BN;
    fundingDurationSeconds: BN;
    numBlocks: number;
    rosterShardCap: number;
    creatorInitialDepositLamports: BN;
    creatorDailyLamportsLimit: BN;
    creatorClaimLockPeriodSec: BN;
  }): Promise<{
    instruction: web3.TransactionInstruction;
    launchState: web3.PublicKey;
    escrow: web3.PublicKey;
    projectCounter: web3.PublicKey;
    creatorGrant: web3.PublicKey;
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
        fundingDurationSeconds: params.fundingDurationSeconds,
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
        systemProgram: web3.SystemProgram.programId,
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
    creator: web3.PublicKey;
    saleMint: web3.Keypair;
    hardCapLamports: BN;
    minRaiseLamports: BN;
    perWalletCap: BN;
    tauLamports: BN;
    saleAllocation: BN;
    lpAllocation: BN;
    fundingDurationSeconds: BN;
    rosterShardCap: number;
    creatorInitialDepositLamports: BN;
    creatorDailyLamportsLimit: BN;
    creatorClaimLockPeriodSec: BN;
    provider: any;
  }): Promise<{
    initLaunchTx: web3.Transaction;
    launchState: web3.PublicKey;
    escrow: web3.PublicKey;
    creatorGrant: web3.PublicKey;
    signers: web3.Keypair[];
  }> {
    const createMintAccountIx = web3.SystemProgram.createAccount({
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
      fundingDurationSeconds: params.fundingDurationSeconds,
      numBlocks: 0, // Default to 0, will be set to DEFAULT_N on-chain
      rosterShardCap: params.rosterShardCap,
      creatorInitialDepositLamports: params.creatorInitialDepositLamports,
      creatorDailyLamportsLimit: params.creatorDailyLamportsLimit,
      creatorClaimLockPeriodSec: params.creatorClaimLockPeriodSec,
    });

    const initLaunchTx = new web3.Transaction()
      .add(createMintAccountIx)
      .add(initializeMintIx)
      .add(initLaunchIx);

    return {
      initLaunchTx,
      launchState,
      escrow,
      creatorGrant,
      signers: [params.saleMint],
    };
  }

  async initRosterIx(params: {
    launch: web3.PublicKey;
    payer: web3.PublicKey;
  }): Promise<{ instruction: web3.TransactionInstruction; rosterPda: web3.PublicKey }> {
    const [rosterPda] = this.getPda(["roster", params.launch]);

    const instruction = await this.program.methods
      .initRoster()
      .accountsStrict({
        payer: params.payer,
        launchState: params.launch,
        roster: rosterPda,
        systemProgram: web3.SystemProgram.programId,
      })
      .instruction();

    return { instruction, rosterPda };
  }

  async initRosterTx(params: {
    launch: web3.PublicKey;
    payer: web3.PublicKey;
  }): Promise<{ transaction: web3.Transaction; rosterPda: web3.PublicKey }> {
    const { instruction, rosterPda } = await this.initRosterIx(params);
    const transaction = new web3.Transaction().add(instruction);
    return { transaction, rosterPda };
  }

  async initRosterShardIx(params: {
    launch: web3.PublicKey;
    payer: web3.PublicKey;
    shardId: number;
  }): Promise<{ instruction: web3.TransactionInstruction; rosterShard: web3.PublicKey }> {
    const [rosterShard] = this.getRosterShardPda(params.launch, params.shardId);
    const instruction = await (this.program.methods as any)
      .initRosterShard(params.shardId)
      .accounts({
        payer: params.payer,
        launchState: params.launch,
        rosterShard,
        systemProgram: web3.SystemProgram.programId,
      } as any)
      .instruction();
    return { instruction, rosterShard };
  }

  async setSeedIx(params: { launch: web3.PublicKey; payer: web3.PublicKey }): Promise<{
    instruction: web3.TransactionInstruction;
    selectionPda: web3.PublicKey;
  }> {
    const [selectionPda] = this.getPda(["selection", params.launch]);

    const instruction = await this.program.methods
      .setSeed()
      .accountsStrict({
        payer: params.payer,
        launchState: params.launch,
        slotHashes: web3.SYSVAR_SLOT_HASHES_PUBKEY,
        systemProgram: web3.SystemProgram.programId,
      })
      .instruction();

    return { instruction, selectionPda };
  }

  async setSeedTx(params: {
    launch: web3.PublicKey;
    payer: web3.PublicKey;
  }): Promise<{ transaction: web3.Transaction; selectionPda: web3.PublicKey }> {
    const { instruction, selectionPda } = await this.setSeedIx(params);
    const transaction = new web3.Transaction().add(instruction);
    return { transaction, selectionPda };
  }

  async depositIx(params: {
    launch: web3.PublicKey;
    user: web3.PublicKey;
    amountLamports: BN;
    rosterShard: web3.PublicKey;
  }): Promise<{
    instruction: web3.TransactionInstruction;
    userContribution: web3.PublicKey;
  }> {
    const [userContribution] = this.getPda(["user", params.launch, params.user]);
    const rosterShard = params.rosterShard;
    const escrow = this.getPda(["escrow", params.launch])[0];

    const instruction = await this.program.methods
      .deposit(params.amountLamports)
      .accountsStrict({
        user: params.user,
        launchState: params.launch,
        userContribution: userContribution,
        rosterShard: rosterShard,
        escrow: escrow,
        launch: params.launch,
        systemProgram: web3.SystemProgram.programId,
      })
      .instruction();

    return { instruction, userContribution };
  }

  async depositTx(params: {
    launch: web3.PublicKey;
    user: web3.PublicKey;
    amountLamports: BN;
    rosterShard: web3.PublicKey;
  }): Promise<{ transaction: web3.Transaction; userContribution: web3.PublicKey }> {
    const { instruction, userContribution } = await this.depositIx(params);
    const transaction = new web3.Transaction().add(instruction);
    return { transaction, userContribution };
  }

  async withdrawIx(params: {
    launch: web3.PublicKey;
    user: web3.PublicKey;
    amountLamports: BN;
  }): Promise<{
    instruction: web3.TransactionInstruction;
    userContribution: web3.PublicKey;
  }> {
    const [userContribution] = this.getPda([
      "user",
      params.launch,
      params.user,
    ]);
    const rosterShard = this.getRosterShardPda(params.launch, 0)[0];
    const escrow = this.getPda(["escrow", params.launch])[0];

    const instruction = await this.program.methods
      .withdraw(params.amountLamports)
      .accountsStrict({
        user: params.user,
        launchState: params.launch,
        userContribution: userContribution,
        rosterShard: rosterShard,
        escrow: escrow,
        launch: params.launch,
        systemProgram: web3.SystemProgram.programId,
      })
      .instruction();

    return { instruction, userContribution };
  }

  async withdrawTx(params: {
    launch: web3.PublicKey;
    user: web3.PublicKey;
    amountLamports: BN;
    roster?: web3.PublicKey;
    escrow?: web3.PublicKey;
  }): Promise<{ transaction: web3.Transaction; userContribution: web3.PublicKey }> {
    const { instruction, userContribution } = await this.withdrawIx(params);
    const transaction = new web3.Transaction().add(instruction);
    return { transaction, userContribution };
  }

  async claimRefundIx(params: {
    launch: web3.PublicKey;
    user: web3.PublicKey;
    rosterShard?: web3.PublicKey;
    shardId?: number;
    escrow?: web3.PublicKey;
  }): Promise<{
    instruction: web3.TransactionInstruction;
    userContribution: web3.PublicKey;
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
    launch: web3.PublicKey;
    user: web3.PublicKey;
    selection?: web3.PublicKey;
    escrow?: web3.PublicKey;
  }): Promise<{ transaction: web3.Transaction; userContribution: web3.PublicKey }> {
    const { instruction, userContribution } = await this.claimRefundIx(params);
    const transaction = new web3.Transaction().add(instruction);
    return { transaction, userContribution };
  }

  async claimTokensIx(params: {
    launch: web3.PublicKey;
    saleMint: web3.PublicKey;
    user: web3.PublicKey;
    rosterShard?: web3.PublicKey;
    shardId?: number;
    userAta?: web3.PublicKey;
    createAtaIfMissing?: boolean;
    payer: web3.PublicKey;
  }): Promise<{ instructions: web3.TransactionInstruction[]; userAta: web3.PublicKey }> {
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

    const instructions: web3.TransactionInstruction[] = [];

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
    launch: web3.PublicKey;
    saleMint: web3.PublicKey;
    user: web3.PublicKey;
    selection?: web3.PublicKey;
    userAta?: web3.PublicKey;
    createAtaIfMissing?: boolean;
    payer: web3.PublicKey;
  }): Promise<{ transaction: web3.Transaction; userAta: web3.PublicKey }> {
    const { instructions, userAta } = await this.claimTokensIx(params);
    const transaction = new web3.Transaction().add(...instructions);
    return { transaction, userAta };
  }

  private ensure32Bytes(seed: Uint8Array | number[] | Buffer): Buffer {
    const buf = Buffer.from(seed);
    if (buf.length !== 32) throw new Error("seed must be 32 bytes");
    return buf;
  }

  async fetchLaunch(launch: web3.PublicKey) {
    return this.program.account.launchState.fetch(launch);
  }

  async fetchRoster(launch: web3.PublicKey) {
    const [pda] = this.getPda(["roster", launch]);
    return this.program.account.roster.fetch(pda);
  }

  async fetchRosterShard(
    launch: web3.PublicKey,
    shardId: number
  ): Promise<{
    account: any;
    pda: web3.PublicKey;
  } | null> {
    const [pda] = this.getRosterShardPda(launch, shardId);
    try {
      const account = await this.program.account.rosterShard.fetch(pda);
      return { account, pda };
    } catch (error) {
      // @ts-ignore
      if (error.message.includes("Account does not exist")) {
        return null;
      }
      throw error;
    }
  }


  async finalizeRosterShardIx(params: {
    launch: web3.PublicKey;
    payer: web3.PublicKey;
    shardId: number;
  }): Promise<{ instruction: web3.TransactionInstruction; rosterShard: web3.PublicKey }> {
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
    launch: web3.PublicKey;
    payer: web3.PublicKey;
  }): Promise<web3.TransactionInstruction> {
    const [creatorGrant] = this.getPda(["creator", params.launch]);
    return (this.program.methods as any)
      .openClaims()
      .accounts({
        payer: params.payer,
        launchState: params.launch,
        creatorGrant,
      } as any)
      .instruction();
  }

  async fetchUserContribution(launch: web3.PublicKey, user: web3.PublicKey) {
    const [pda] = this.getPda(["user", launch, user]);
    return this.program.account.userContribution.fetch(pda);
  }

  async fetchProjectCounter() {
    const [pda] = this.getPda(["project_counter"]);
    return this.program.account.projectCounter.fetch(pda);
  }

  async claimCreatorTokensTx(params: {
    launch: web3.PublicKey;
    saleMint: web3.PublicKey;
    creator: web3.PublicKey;
    creatorAta?: web3.PublicKey;
    createAtaIfMissing?: boolean;
    payer: web3.PublicKey;
  }): Promise<{ transaction: web3.Transaction; creatorAta: web3.PublicKey }> {
    const [creatorGrant] = this.getPda(["creator", params.launch]);
    const [mintAuth] = this.getPda(["mint_auth", params.launch]);
    const creatorAta =
      params.creatorAta ??
      getAssociatedTokenAddressSync(params.saleMint, params.creator, true);

    const transaction = new web3.Transaction();

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
    launch: web3.PublicKey;
    creator: web3.PublicKey;
  }): Promise<{ transaction: web3.Transaction }> {
    const [creatorGrant] = this.getPda(["creator", params.launch]);
    const [escrow] = this.getPda(["escrow", params.launch]);

    const transaction = new web3.Transaction();

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

  async fetchCreatorGrant(launch: web3.PublicKey) {
    const [creatorGrantPda] = this.getPda(["creator", launch]);
    return this.program.account.creatorGrant.fetch(creatorGrantPda);
  }



  async createClmmPoolTx(params: {
    payer: web3.PublicKey;
    launch: web3.PublicKey;
    quoteMint: web3.PublicKey;
    baseMint: web3.PublicKey;
    ammConfig: web3.PublicKey;
    clmmProgram: web3.PublicKey;
    provider: any;
  }): Promise<{
    transaction: web3.Transaction;
    signers: web3.Keypair[];
    baseMint: web3.PublicKey;
    baseTokenAta: web3.PublicKey;
  }> {
    const [escrow] = this.getPda(["escrow", params.launch]);
    
    const [mintA, mintB] = [params.quoteMint, params.baseMint].sort((a, b) => a.toBuffer().compare(b.toBuffer()));

    const [poolState] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool"),
        params.ammConfig.toBuffer(),
        mintA.toBuffer(),
        mintB.toBuffer(),
      ],
      params.clmmProgram
    );

    const [observationState] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("observation"), poolState.toBuffer()],
      params.clmmProgram
    );

    const [quoteVault] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool_vault"),
        poolState.toBuffer(),
        mintA.toBuffer(),
      ],
      params.clmmProgram
    );

    const [baseVault] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool_vault"),
        poolState.toBuffer(),
        mintB.toBuffer(),
      ],
      params.clmmProgram
    );

    const [tickArrayBitmap] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool_tick_array_bitmap_extension"),
        poolState.toBuffer(),
      ],
      params.clmmProgram
    );

    const baseTokenAta = getAssociatedTokenAddressSync(
      params.baseMint,
      escrow,
      true // allowOwnerOffCurve for PDA
    );


    const createClmmPoolIx = await this.program.methods
      .createClmmPool()
      .accountsStrict({
        payer: params.payer,
        launchState: params.launch,
        escrow: escrow,
        baseEscrowAta: baseTokenAta,
        baseMint: params.baseMint,
        quoteMint: params.quoteMint,
        raydiumAmmConfig: params.ammConfig,
        raydiumPoolState: poolState,
        raydiumBaseVault: baseVault,
        raydiumQuoteVault: quoteVault,
        raydiumObservationState: observationState,
        raydiumTickArrayBitmap: tickArrayBitmap,
        raydiumProgram: params.clmmProgram,
        quoteTokenProgram: TOKEN_PROGRAM_ID,
        baseTokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .instruction();

    const transaction = new web3.Transaction()
      .add(createClmmPoolIx);

    return {
      transaction,
      signers: [],
      baseMint: params.baseMint,
      baseTokenAta,
    };
  }

  async addClmmLiquidityTx(params: {
    payer: web3.PublicKey;
    launch: web3.PublicKey;
    quoteMint: web3.PublicKey;
    baseMint: web3.PublicKey;
    baseTokenAta: web3.PublicKey;
    ammConfig: web3.PublicKey;
    clmmProgram: web3.PublicKey;
    provider: any;
  }): Promise<{
    transaction: web3.Transaction;
    signers: web3.Keypair[];
  }> {
    const [escrow] = this.getPda(["escrow", params.launch]);

    // Derive Raydium pool PDA using sorted mint order (must match createClmmPoolTx)
    const [mintA, mintB] = [params.quoteMint, params.baseMint].sort((a, b) => a.toBuffer().compare(b.toBuffer()));
    const [poolState] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool"),
        params.ammConfig.toBuffer(),
        mintA.toBuffer(),
        mintB.toBuffer(),
      ],
      params.clmmProgram
    );

    const [quoteVault] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool_vault"),
        poolState.toBuffer(),
        mintA.toBuffer(),
      ],
      params.clmmProgram
    );

    const [baseVault] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool_vault"),
        poolState.toBuffer(),
        mintB.toBuffer(),
      ],
      params.clmmProgram
    );

    // Escrow's wSOL ATA (will be created on-chain if needed)
    const wsolEscrowAta = getAssociatedTokenAddressSync(
      params.quoteMint,
      escrow,
      true
    );

    // Fee payer PDA for system operations
    const [feePayerPda] = this.getPda(["fee_payer", params.launch]);

    // Derive payer user ATAs used during Raydium CPI
    const wsolUserAta = getAssociatedTokenAddressSync(
      params.quoteMint,
      params.payer,
      true
    );
    const baseUserAta = getAssociatedTokenAddressSync(
      params.baseMint,
      params.payer,
      true
    );

    const positionNftMint = web3.Keypair.generate();
    // Position NFT owner is PAYER on-chain; derive ATA for payer under Tokenkeg
    const positionNftAccount = getAssociatedTokenAddressSync(
      positionNftMint.publicKey,
      params.payer,
      false
    );

    const [metadataAccount] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        METADATA_PROGRAM_ID.toBuffer(),
        positionNftMint.publicKey.toBuffer(),
      ],
      METADATA_PROGRAM_ID
    );

    const [personalPosition] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("position"),
        positionNftMint.publicKey.toBuffer(),
      ],
      params.clmmProgram
    );

    const tickSpacing = 60;
    const tickLowerIndex = -443580;
    const tickUpperIndex = 443580;

    const tickLowerBuffer = Buffer.alloc(4);
    tickLowerBuffer.writeInt32BE(tickLowerIndex, 0);

    const tickUpperBuffer = Buffer.alloc(4);
    tickUpperBuffer.writeInt32BE(tickUpperIndex, 0);

    const [protocolPosition] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("protocol_position"),
        poolState.toBuffer(),
        tickLowerBuffer,
        tickUpperBuffer,
      ],
      params.clmmProgram
    );

    const TICK_ARRAY_SIZE = 60;
    const tickArrayLowerStartIndex = Math.floor(tickLowerIndex / (tickSpacing * TICK_ARRAY_SIZE)) * (tickSpacing * TICK_ARRAY_SIZE);
    const tickArrayUpperStartIndex = Math.floor(tickUpperIndex / (tickSpacing * TICK_ARRAY_SIZE)) * (tickSpacing * TICK_ARRAY_SIZE);

    const tickArrayLowerBuffer = Buffer.alloc(4);
    tickArrayLowerBuffer.writeInt32BE(tickArrayLowerStartIndex, 0);

    const tickArrayUpperBuffer = Buffer.alloc(4);
    tickArrayUpperBuffer.writeInt32BE(tickArrayUpperStartIndex, 0);

    const [tickArrayLower] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("tick_array"),
        poolState.toBuffer(),
        tickArrayLowerBuffer,
      ],
      params.clmmProgram
    );

    const [tickArrayUpper] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("tick_array"),
        poolState.toBuffer(),
        tickArrayUpperBuffer,
      ],
      params.clmmProgram
    );

    const addLiquidityIx = await (this.program.methods as any)
      .addClmmLiquidity()
      .accounts({
        payer: params.payer,
        raydiumProgram: params.clmmProgram,
        launchState: params.launch,
        baseMint: params.baseMint,
        escrow: escrow,
        feePayerPda: feePayerPda,
        baseEscrowAta: params.baseTokenAta,
        quoteMint: params.quoteMint,
        wsolEscrowAta: wsolEscrowAta,
        baseUserAta,
        wsolUserAta,
        token2022Program: TOKEN_2022_PROGRAM_ID,
        quoteTokenProgram: TOKEN_PROGRAM_ID,
        baseTokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .remainingAccounts([
        // Order must match on-chain expectation in invoke_raydium_cpi
        { pubkey: poolState, isSigner: false, isWritable: true },
        { pubkey: quoteVault, isSigner: false, isWritable: true },
        { pubkey: baseVault, isSigner: false, isWritable: true },
        { pubkey: positionNftMint.publicKey, isSigner: true, isWritable: true },
        { pubkey: positionNftAccount, isSigner: false, isWritable: true },
        { pubkey: metadataAccount, isSigner: false, isWritable: true },
        { pubkey: personalPosition, isSigner: false, isWritable: true },
        { pubkey: protocolPosition, isSigner: false, isWritable: true },
        { pubkey: tickArrayLower, isSigner: false, isWritable: true },
        { pubkey: tickArrayUpper, isSigner: false, isWritable: true },
        { pubkey: METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
      ])
      .instruction();

    const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({
      units: 400_000,
    });

    const transaction = new web3.Transaction()
      .add(computeBudgetIx)
      .add(addLiquidityIx);

    return {
      transaction,
      signers: [positionNftMint],
    };
  }
}
