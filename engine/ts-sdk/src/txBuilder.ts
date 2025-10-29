import { BN, Program, web3 } from "@coral-xyz/anchor";
import { Engine as EngineIDL } from "../idl/engine";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
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
    fundingDurationSeconds: number;
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
    fundingDurationSeconds: number;
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
    amount: BN;
    roster?: web3.PublicKey;
    rosterShard?: web3.PublicKey;
    shardId?: number; // if rosterShard not provided
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
    const roster = params.roster ?? this.getPda(["roster", params.launch])[0];
    const rosterShard =
      params.rosterShard ??
      this.getRosterShardPda(params.launch, params.shardId ?? 0)[0];
    const escrow = params.escrow ?? this.getPda(["escrow", params.launch])[0];
    const escrowAuthority = this.getPda(["escrow_authority", params.launch])[0];

    const instruction = await this.program.methods
      .deposit(params.amount)
      .accounts({
        user: params.user,
        launchState: params.launch,
        userContribution: userContribution,
        roster: roster,
        rosterShard,
        escrow: escrow,
        escrowAuthority: escrowAuthority,
        launch: params.launch,
        systemProgram: web3.SystemProgram.programId,
      } as any)
      .instruction();

    return { instruction, userContribution };
  }

  async depositTx(params: {
    launch: web3.PublicKey;
    user: web3.PublicKey;
    amount: BN;
    roster?: web3.PublicKey;
    escrow?: web3.PublicKey;
  }): Promise<{ transaction: web3.Transaction; userContribution: web3.PublicKey }> {
    const { instruction, userContribution } = await this.depositIx(params);
    const transaction = new web3.Transaction().add(instruction);
    return { transaction, userContribution };
  }

  async withdrawIx(params: {
    launch: web3.PublicKey;
    user: web3.PublicKey;
    amount: BN;
    roster?: web3.PublicKey;
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
    const roster = params.roster ?? this.getPda(["roster", params.launch])[0];
    const rosterShard =
      params.rosterShard ??
      this.getRosterShardPda(params.launch, params.shardId ?? 0)[0];
    const escrow = params.escrow ?? this.getPda(["escrow", params.launch])[0];

    const escrowAuthority = this.getPda(["escrow_authority", params.launch])[0];

    const instruction = await this.program.methods
      .withdraw(params.amount)
      .accounts({
        user: params.user,
        launchState: params.launch,
        userContribution: userContribution,
        roster: roster,
        rosterShard,
        escrow: escrow,
        escrowAuthority: escrowAuthority,
        launch: params.launch,
        systemProgram: web3.SystemProgram.programId,
      } as any)
      .instruction();

    return { instruction, userContribution };
  }

  async withdrawTx(params: {
    launch: web3.PublicKey;
    user: web3.PublicKey;
    amount: BN;
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
        : (() => {
          throw new Error("Provide shardId or rosterShard for claimRefund");
        })());
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
        : (() => {
          throw new Error("Provide shardId or rosterShard for claimTokens");
        })());
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


  async createPoolTx(params: {
    payer: web3.PublicKey;
    launch: web3.PublicKey;
    computeUnits?: number;
    computeUnitPriceMicroLamports?: number;
  }): Promise<{
    transaction: web3.Transaction;
    poolState: web3.PublicKey;
  }> {
    const [poolState] = this.getPda(["pool", params.launch]);
    const SLOT_HASHES_SYSVAR = new web3.PublicKey("SysvarS1otHashes111111111111111111111111111");

    const ix = await this.program.methods
      .createPool()
      .accountsStrict({
        payer: params.payer,
        launchState: params.launch,
        poolState,
        slotHashes: SLOT_HASHES_SYSVAR,
        systemProgram: web3.SystemProgram.programId,
      })
      .instruction();

    const preIxs: web3.TransactionInstruction[] = [];
    if (typeof params.computeUnits === "number") {
      preIxs.push(web3.ComputeBudgetProgram.setComputeUnitLimit({ units: params.computeUnits }));
    }
    if (typeof params.computeUnitPriceMicroLamports === "number") {
      preIxs.push(
        web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: params.computeUnitPriceMicroLamports })
      );
    }

    const transaction = new web3.Transaction();
    if (preIxs.length) transaction.add(...preIxs);
    transaction.add(ix);

    return { transaction, poolState };
  }

  async createClmmPoolTx(params: {
    payer: web3.PublicKey;
    launch: web3.PublicKey;
    quoteMint: web3.PublicKey;
    baseMint: web3.Keypair;
    ammConfig: web3.PublicKey;
    clmmProgram: web3.PublicKey;
    provider: any;
  }): Promise<{
    transaction: web3.Transaction;
    signers: web3.Keypair[];
    baseMint: web3.PublicKey;
    baseTokenAta: web3.PublicKey;
    poolState: web3.PublicKey;
  }> {
    const [escrow] = this.getPda(["escrow", params.launch]);
    const [escrowAuthority] = this.getPda(["escrow_authority", params.launch]);

    const [poolState] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool"),
        params.ammConfig.toBuffer(),
        params.quoteMint.toBuffer(),
        params.baseMint.publicKey.toBuffer(),
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
        params.quoteMint.toBuffer(),
      ],
      params.clmmProgram
    );

    const [baseVault] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool_vault"),
        poolState.toBuffer(),
        params.baseMint.publicKey.toBuffer(),
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
      params.baseMint.publicKey,
      escrowAuthority,
      true // allowOwnerOffCurve for PDA
    );


    const createClmmPoolIx = await this.program.methods
      .createClmmPool()
      .accountsStrict({
        payer: params.payer,
        launchState: params.launch,
        escrow: escrow,
        escrowAuthority: escrowAuthority,
        baseEscrowAta: baseTokenAta,
        baseMint: params.baseMint.publicKey,
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

    const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({
      units: 400_000,
    });

    const transaction = new web3.Transaction()
      .add(computeBudgetIx)
      .add(createClmmPoolIx);

    return {
      transaction,
      signers: [params.baseMint],
      baseMint: params.baseMint.publicKey,
      baseTokenAta,
      poolState,
    };
  }

  async calculateLiquidityRange(params: {
    launch: web3.PublicKey;
    baseAmount: BN;
    quoteAmount: BN;
  }): Promise<{
    tickLower: number;
    tickUpper: number;
    tickArrayLowerStartIndex: number;
    tickArrayUpperStartIndex: number;
    tickCurrent: number;
  }> {
    const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({
      units: 2_000_000,
    });

    const tx = await this.program.methods
      .calculateLiquidityRange(
        params.baseAmount,
        params.quoteAmount
      )
      .accountsStrict({
        launchState: params.launch
      })
      .preInstructions([computeBudgetIx])
      .transaction();

    const provider = this.program.provider as any;

    if (provider.client && provider.client.latestBlockhash) {
      const wallet = provider.wallet as any;
      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = provider.client.latestBlockhash();

      if (wallet.payer) {
        tx.sign(wallet.payer);
      } else {
        tx.sign(wallet);
      }

      let simulation;
      try {
        simulation = await provider.simulate(tx);
      } catch (error: any) {
        console.error("Simulation error:", error);
        throw new Error(`Simulation failed: ${error.message || JSON.stringify(error)}`);
      }

      if (!simulation || !simulation.returnData) {
        throw new Error("No return data from calculateLiquidityRange simulation");
      }

      let returnDataStr: string;
      if (typeof simulation.returnData === 'string') {
        returnDataStr = simulation.returnData;
      } else if (Array.isArray(simulation.returnData.data)) {
        returnDataStr = simulation.returnData.data[0];
      } else {
        returnDataStr = simulation.returnData.data || simulation.returnData;
      }

      const buffer = Buffer.from(returnDataStr, "base64");

      const tickLower = buffer.readInt32LE(0);
      const tickUpper = buffer.readInt32LE(4);
      const tickArrayLowerStartIndex = buffer.readInt32LE(8);
      const tickArrayUpperStartIndex = buffer.readInt32LE(12);
      const tickCurrent = buffer.readInt32LE(16);

      return {
        tickLower,
        tickUpper,
        tickArrayLowerStartIndex,
        tickArrayUpperStartIndex,
        tickCurrent,
      };
    }

    tx.feePayer = this.program.provider.publicKey;
    const { blockhash } = await this.program.provider.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;

    const simulation = await this.program.provider.connection.simulateTransaction(tx);

    if (simulation.value.err) {
      throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
    }

    const returnData = simulation.value.returnData;
    if (!returnData || !returnData.data) {
      throw new Error("No return data from calculateLiquidityRange");
    }

    const [data, encoding] = returnData.data;
    const decoded = this.program.coder.types.decode(
      "LiquidityRangeResult",
      Buffer.from(data, encoding as BufferEncoding)
    );

    return {
      tickLower: decoded.tickLower,
      tickUpper: decoded.tickUpper,
      tickArrayLowerStartIndex: decoded.tickArrayLowerStartIndex,
      tickArrayUpperStartIndex: decoded.tickArrayUpperStartIndex,
      tickCurrent: decoded.tickCurrent,
    };
  }

  async addClmmLiquidityIx(params: {
    payer: web3.PublicKey;
    launch: web3.PublicKey;
    quoteMint: web3.PublicKey;
    baseMint: web3.PublicKey;
    baseTokenAta: web3.PublicKey;
    ammConfig: web3.PublicKey;
    clmmProgram: web3.PublicKey;
    tickLowerIndex: number;
    tickUpperIndex: number;
    tickArrayLowerStartIndex: number;
    tickArrayUpperStartIndex: number;
    positionNftMint?: web3.Keypair;
  }): Promise<{
    instruction: web3.TransactionInstruction;
    signers: web3.Keypair[];
    quoteVault: web3.PublicKey;
    baseVault: web3.PublicKey;
    poolState: web3.PublicKey;
    positionNftMint: web3.PublicKey;
    quoteTokenAta: web3.PublicKey;
  }> {
    const [escrow] = this.getPda(["escrow", params.launch]);
    const [escrowAuthority] = this.getPda(["escrow_authority", params.launch]);

    const [poolState] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool"),
        params.ammConfig.toBuffer(),
        params.quoteMint.toBuffer(),
        params.baseMint.toBuffer(),
      ],
      params.clmmProgram
    );

    const [quoteVault] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool_vault"),
        poolState.toBuffer(),
        params.quoteMint.toBuffer(),
      ],
      params.clmmProgram
    );

    const [baseVault] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool_vault"),
        poolState.toBuffer(),
        params.baseMint.toBuffer(),
      ],
      params.clmmProgram
    );

    const quoteTokenAta = getAssociatedTokenAddressSync(
      params.quoteMint,
      escrowAuthority,
      true
    );

    const positionNftMint = params.positionNftMint ?? web3.Keypair.generate();
    const positionNftAccount = getAssociatedTokenAddressSync(
      positionNftMint.publicKey,
      escrowAuthority,
      true
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

    const tickLowerBuffer = Buffer.alloc(4);
    tickLowerBuffer.writeInt32BE(params.tickLowerIndex, 0);

    const tickUpperBuffer = Buffer.alloc(4);
    tickUpperBuffer.writeInt32BE(params.tickUpperIndex, 0);

    const [protocolPosition] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("protocol_position"),
        poolState.toBuffer(),
        tickLowerBuffer,
        tickUpperBuffer,
      ],
      params.clmmProgram
    );

    const tickArrayLowerBuffer = Buffer.alloc(4);
    tickArrayLowerBuffer.writeInt32BE(params.tickArrayLowerStartIndex, 0);

    const tickArrayUpperBuffer = Buffer.alloc(4);
    tickArrayUpperBuffer.writeInt32BE(params.tickArrayUpperStartIndex, 0);

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

    const addLiquidityIx = await this.program.methods
      .addClmmLiquidity(
        params.tickLowerIndex,
        params.tickUpperIndex,
        params.tickArrayLowerStartIndex,
        params.tickArrayUpperStartIndex
      )
      .accountsStrict({
        payer: params.payer,
        raydiumProgram: params.clmmProgram,
        launchState: params.launch,
        baseMint: params.baseMint,
        escrow: escrow,
        escrowAuthority: escrowAuthority,
        baseEscrowAta: params.baseTokenAta,
        quoteMint: params.quoteMint,
        raydiumPoolState: poolState,
        raydiumQuoteVault: quoteVault,
        raydiumBaseVault: baseVault,
        raydiumPositionNftMint: positionNftMint.publicKey,
        raydiumPositionNftAccount: positionNftAccount,
        raydiumMetadataAccount: metadataAccount,
        raydiumPersonalPosition: personalPosition,
        raydiumProtocolPosition: protocolPosition,
        raydiumTickArrayLower: tickArrayLower,
        raydiumTickArrayUpper: tickArrayUpper,
        quoteTokenAta: quoteTokenAta,
        metadataProgram: METADATA_PROGRAM_ID,
        token2022Program: TOKEN_2022_PROGRAM_ID,
        quoteTokenProgram: TOKEN_PROGRAM_ID,
        baseTokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .instruction();

    return {
      instruction: addLiquidityIx,
      signers: [positionNftMint],
      quoteVault,
      baseVault,
      poolState,
      positionNftMint: positionNftMint.publicKey,
      quoteTokenAta,
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
    tickLowerIndex: number;
    tickUpperIndex: number;
    tickArrayLowerStartIndex: number;
    tickArrayUpperStartIndex: number;
  }): Promise<{
    transaction: web3.Transaction;
    signers: web3.Keypair[];
    quoteVault: web3.PublicKey;
    baseVault: web3.PublicKey;
    positionNftMint: web3.PublicKey;
    quoteTokenAta: web3.PublicKey;
  }> {
    const { instruction, signers, quoteVault, baseVault, positionNftMint, quoteTokenAta } =
      await this.addClmmLiquidityIx(params);

    const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({
      units: 1_000_000,
    });

    const transaction = new web3.Transaction()
      .add(computeBudgetIx)
      .add(instruction);

    return {
      transaction,
      signers,
      quoteVault,
      baseVault,
      positionNftMint,
      quoteTokenAta,
    };
  }

  async getAddLiquidityInfo(params: {
    launch: web3.PublicKey;
    quoteMint: web3.PublicKey;
    baseMint: web3.PublicKey;
    baseTokenAta: web3.PublicKey;
    ammConfig: web3.PublicKey;
    clmmProgram: web3.PublicKey;
    payer: web3.PublicKey;
    tickLowerIndex: number;
    tickUpperIndex: number;
    tickArrayLowerStartIndex: number;
    tickArrayUpperStartIndex: number;
  }): Promise<{
    quoteTokenAtaAmount: BN;
    baseEscrowAtaAmount: BN;
    expectedQuoteAmount: BN;
    expectedBaseAmount: BN;
  }> {
    const positionNftMint = web3.Keypair.generate();
    const { instruction } = await this.addClmmLiquidityIx({
      ...params,
      positionNftMint,
    });

    const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({
      units: 400_000,
    });

    const tx = new web3.Transaction()
      .add(computeBudgetIx)
      .add(instruction);

    const provider = this.program.provider as any;

    if (provider.client && provider.client.latestBlockhash) {
      const wallet = provider.wallet as any;
      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = provider.client.latestBlockhash();

      if (wallet.payer) {
        tx.sign(wallet.payer);
      } else {
        tx.sign(wallet);
      }
      tx.partialSign(positionNftMint);

      let simulation;
      try {
        simulation = provider.client.simulateTransaction(tx);
      } catch (error: any) {
        console.error("Simulation error:", error);
        throw new Error(`Simulation failed: ${error.message || JSON.stringify(error)}`);
      }

      if (simulation.err) {
        const errorMsg = simulation.err();
        console.error("Transaction simulation failed:", errorMsg);
        throw new Error(`Simulation failed: ${errorMsg}`);
      }

      const returnData = simulation?.returnData;
      if (!returnData) {
        console.error("Full simulation:", simulation);
        throw new Error("No return data from addClmmLiquidity simulation");
      }

      let returnDataStr: string;
      if (typeof simulation.returnData === 'string') {
        returnDataStr = simulation.returnData;
      } else if (Array.isArray(simulation.returnData.data)) {
        returnDataStr = simulation.returnData.data[0];
      } else {
        returnDataStr = simulation.returnData.data || simulation.returnData;
      }

      const buffer = Buffer.from(returnDataStr, "base64");

      const quoteTokenAtaAmount = buffer.readBigUInt64LE(0);
      const baseEscrowAtaAmount = buffer.readBigUInt64LE(8);
      const expectedQuoteAmount = buffer.readBigUInt64LE(16);
      const expectedBaseAmount = buffer.readBigUInt64LE(24);

      return {
        quoteTokenAtaAmount: new BN(quoteTokenAtaAmount.toString()),
        baseEscrowAtaAmount: new BN(baseEscrowAtaAmount.toString()),
        expectedQuoteAmount: new BN(expectedQuoteAmount.toString()),
        expectedBaseAmount: new BN(expectedBaseAmount.toString()),
      };
    }

    throw new Error("Only litesvm provider supported for getAddLiquidityInfo");
  }
}
