import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { Engine as EngineIDL } from "../idl/engine";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createInitializeMintInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import { getConstant } from "./utils";

const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

export class TxBuilder {
  private program: Program<EngineIDL>;
  private seedRoot: Buffer;

  constructor(program: Program<EngineIDL>) {
    this.program = program;
    this.seedRoot = Buffer.from(getConstant("seedRoot", program.idl as any));
  }

  getPda(seeds: (string | Buffer | PublicKey)[]): [PublicKey, number] {
    const seedBuffers = [this.seedRoot, ...seeds.map(seed => {
      if (typeof seed === 'string') {
        return Buffer.from(seed);
      } else if (typeof seed === 'object' && 'toBuffer' in seed) {
        return seed.toBuffer();
      } else {
        return seed as Buffer;
      }
    })];

    return PublicKey.findProgramAddressSync(seedBuffers, this.program.programId);
  }

  async initLaunchIx(params: {
    admin: PublicKey;
    saleMint: PublicKey;
    hardCapLamports: BN;
    minRaiseLamports: BN;
    perWalletCap: BN;
    tauLamports: BN;
    saleAllocation: BN;
    lpAllocation: BN;
    fundingDurationSec: BN;
  }): Promise<{
    instruction: TransactionInstruction;
    launchState: PublicKey;
    escrow: PublicKey;
    projectCounter: PublicKey;
  }> {
    const [launchState] = this.getPda(["launch", params.saleMint]);
    const [escrow] = this.getPda(["escrow", launchState]);
    const [projectCounter] = this.getPda(["project_counter"]);

    const instruction = await this.program.methods
      .initLaunch(
        params.hardCapLamports,
        params.minRaiseLamports,
        params.perWalletCap,
        params.tauLamports,
        params.saleAllocation,
        params.lpAllocation,
        params.fundingDurationSec
      )
      .accountsStrict({
        admin: params.admin,
        launchState: launchState,
        saleMint: params.saleMint,
        escrow: escrow,
        projectCounter: projectCounter,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    return {
      instruction,
      launchState,
      escrow,
      projectCounter,
    };
  }

  async initLaunchTx(params: {
    admin: PublicKey;
    saleMint: Keypair;
    hardCapLamports: BN;
    minRaiseLamports: BN;
    perWalletCap: BN;
    tauLamports: BN;
    saleAllocation: BN;
    lpAllocation: BN;
    fundingDurationSec: BN;
    provider: any;
  }): Promise<{
    initLaunchTx: Transaction;
    launchState: PublicKey;
    escrow: PublicKey;
    signers: Keypair[];
  }> {
    const [launchState] = this.getPda(["launch", params.saleMint.publicKey]);
    const [mintAuth] = this.getPda(["mint_authority", launchState]);

    const createMintAccountIx = SystemProgram.createAccount({
      fromPubkey: params.admin,
      newAccountPubkey: params.saleMint.publicKey,
      space: 82,
      lamports: await params.provider.connection.getMinimumBalanceForRentExemption(82),
      programId: TOKEN_PROGRAM_ID,
    });

    const initializeMintIx = createInitializeMintInstruction(
      params.saleMint.publicKey,
      6,
      mintAuth,
      params.admin
    );

    const { instruction: initLaunchIx, launchState: launchPda, escrow } = await this.initLaunchIx({
      admin: params.admin,
      saleMint: params.saleMint.publicKey,
      hardCapLamports: params.hardCapLamports,
      minRaiseLamports: params.minRaiseLamports,
      perWalletCap: params.perWalletCap,
      tauLamports: params.tauLamports,
      saleAllocation: params.saleAllocation,
      lpAllocation: params.lpAllocation,
      fundingDurationSec: params.fundingDurationSec
    });

    const initLaunchTx = new Transaction()
      .add(createMintAccountIx)
      .add(initializeMintIx)
      .add(initLaunchIx);

    return {
      initLaunchTx,
      launchState,
      escrow,
      signers: [params.saleMint],
    };
  }


  async initRosterIx(params: {
    launch: PublicKey;
    admin: PublicKey;
  }): Promise<{ instruction: TransactionInstruction; rosterPda: PublicKey }> {
    const [rosterPda] = this.getPda(["roster", params.launch]);

    const instruction = await this.program.methods
      .initRoster()
      .accountsStrict({
        admin: params.admin,
        launchState: params.launch,
        roster: rosterPda,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    return { instruction, rosterPda };
  }

  async initRosterTx(params: {
    launch: PublicKey;
    admin: PublicKey;
  }): Promise<{ transaction: Transaction; rosterPda: PublicKey }> {
    const { instruction, rosterPda } = await this.initRosterIx(params);
    const transaction = new Transaction().add(instruction);
    return { transaction, rosterPda };
  }

  async setSeedIx(params: {
    launch: PublicKey;
    admin: PublicKey;
  }): Promise<{ instruction: TransactionInstruction; selectionPda: PublicKey }> {
    const [selectionPda] = this.getPda(["selection", params.launch]);

    const instruction = await this.program.methods
      .setSeed()
      .accountsStrict({
        payer: params.admin,
        launchState: params.launch,
        selectionState: selectionPda,
        slotHashes: anchor.web3.SYSVAR_SLOT_HASHES_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    return { instruction, selectionPda };
  }

  async setSeedTx(params: {
    launch: PublicKey;
    admin: PublicKey;
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
    escrow?: PublicKey;
  }): Promise<{ instruction: TransactionInstruction; userContribution: PublicKey }> {
    const [userContribution] = this.getPda(["user", params.launch, params.user]);
    const roster = params.roster ?? this.getPda(["roster", params.launch])[0];
    const escrow = params.escrow ?? this.getPda(["escrow", params.launch])[0];

    const instruction = await this.program.methods
      .deposit(params.amount)
      .accountsStrict({
        user: params.user,
        launchState: params.launch,
        userContribution: userContribution,
        roster: roster,
        escrow: escrow,
        launch: params.launch,
        systemProgram: SystemProgram.programId,
      })
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
    escrow?: PublicKey;
  }): Promise<{ instruction: TransactionInstruction; userContribution: PublicKey }> {
    const [userContribution] = this.getPda(["user", params.launch, params.user]);
    const roster = params.roster ?? this.getPda(["roster", params.launch])[0];
    const escrow = params.escrow ?? this.getPda(["escrow", params.launch])[0];

    const instruction = await this.program.methods
      .withdraw(params.amount)
      .accountsStrict({
        user: params.user,
        launchState: params.launch,
        userContribution: userContribution,
        roster: roster,
        escrow: escrow,
        launch: params.launch,
        systemProgram: SystemProgram.programId,
      })
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

  async fetchSelection(launch: PublicKey) {
    const [pda] = this.getPda(["selection", launch]);
    return this.program.account.selectionState.fetch(pda);
  }

  async fetchUserContribution(launch: PublicKey, user: PublicKey) {
    const [pda] = this.getPda(["user", launch, user]);
    return this.program.account.userContribution.fetch(pda);
  }

  async fetchProjectCounter() {
    const [pda] = this.getPda(["project_counter"]);
    return this.program.account.projectCounter.fetch(pda);
  }

  async createClmmPoolTx(params: {
    payer: PublicKey;
    launch: PublicKey;
    quoteMint: PublicKey;
    baseMint: Keypair;
    ammConfig: PublicKey;
    clmmProgram: PublicKey;
    provider: any;
  }): Promise<{
    transaction: Transaction;
    signers: Keypair[];
    baseMint: PublicKey;
    baseTokenAta: PublicKey;
  }> {
    const [escrow] = this.getPda(["escrow", params.launch]);

    const [poolState] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool"),
        params.ammConfig.toBuffer(),
        params.quoteMint.toBuffer(),
        params.baseMint.publicKey.toBuffer(),
      ],
      params.clmmProgram
    );

    const [observationState] = PublicKey.findProgramAddressSync(
      [Buffer.from("observation"), poolState.toBuffer()],
      params.clmmProgram
    );

    const [quoteVault] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool_vault"),
        poolState.toBuffer(),
        params.quoteMint.toBuffer(),
      ],
      params.clmmProgram
    );

    const [baseVault] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool_vault"),
        poolState.toBuffer(),
        params.baseMint.publicKey.toBuffer(),
      ],
      params.clmmProgram
    );

    const [tickArrayBitmap] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool_tick_array_bitmap_extension"),
        poolState.toBuffer(),
      ],
      params.clmmProgram
    );

    const baseTokenAta = getAssociatedTokenAddressSync(
      params.baseMint.publicKey,
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
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .instruction();

    const transaction = new Transaction()
      .add(createClmmPoolIx);

    return {
      transaction,
      signers: [params.baseMint],
      baseMint: params.baseMint.publicKey,
      baseTokenAta,
    };
  }

  async addClmmLiquidityTx(params: {
    payer: PublicKey;
    launch: PublicKey;
    quoteMint: PublicKey;
    baseMint: PublicKey;
    baseTokenAta: PublicKey;
    ammConfig: PublicKey;
    clmmProgram: PublicKey;
    provider: any;
  }): Promise<{
    transaction: Transaction;
    signers: Keypair[];
  }> {
    const [escrow] = this.getPda(["escrow", params.launch]);

    const [poolState] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool"),
        params.ammConfig.toBuffer(),
        params.quoteMint.toBuffer(),
        params.baseMint.toBuffer(),
      ],
      params.clmmProgram
    );

    const [quoteVault] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool_vault"),
        poolState.toBuffer(),
        params.quoteMint.toBuffer(),
      ],
      params.clmmProgram
    );

    const [baseVault] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool_vault"),
        poolState.toBuffer(),
        params.baseMint.toBuffer(),
      ],
      params.clmmProgram
    );

    const quoteTokenAccount = getAssociatedTokenAddressSync(
      params.quoteMint,
      params.payer
    );

    const positionNftMint = anchor.web3.Keypair.generate();
    const positionNftAccount = getAssociatedTokenAddressSync(
      positionNftMint.publicKey,
      params.payer
    );

    const [metadataAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        METADATA_PROGRAM_ID.toBuffer(),
        positionNftMint.publicKey.toBuffer(),
      ],
      METADATA_PROGRAM_ID
    );

    const [personalPosition] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("position"),
        positionNftMint.publicKey.toBuffer(),
      ],
      params.clmmProgram
    );

    const tickSpacing = 60;
    const tickLowerIndex = 0;
    const tickUpperIndex = 443580;

    const tickLowerBuffer = Buffer.alloc(4);
    tickLowerBuffer.writeInt32BE(tickLowerIndex, 0);

    const tickUpperBuffer = Buffer.alloc(4);
    tickUpperBuffer.writeInt32BE(tickUpperIndex, 0);

    const [protocolPosition] = PublicKey.findProgramAddressSync(
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

    const [tickArrayLower] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("tick_array"),
        poolState.toBuffer(),
        tickArrayLowerBuffer,
      ],
      params.clmmProgram
    );

    const [tickArrayUpper] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("tick_array"),
        poolState.toBuffer(),
        tickArrayUpperBuffer,
      ],
      params.clmmProgram
    );

    const addLiquidityIx = await this.program.methods
      .addClmmLiquidity()
      .accountsStrict({
        creator: params.payer,
        raydiumProgram: params.clmmProgram,
        launchState: params.launch,
        baseMint: params.baseMint,
        escrow: escrow,
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
        quoteTokenAccount: quoteTokenAccount,
        metadataProgram: METADATA_PROGRAM_ID,
        token2022Program: TOKEN_2022_PROGRAM_ID,
        quoteTokenProgram: TOKEN_PROGRAM_ID,
        baseTokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .instruction();

    const computeBudgetIx = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({
      units: 400_000,
    });

    const transaction = new Transaction()
      .add(computeBudgetIx)
      .add(addLiquidityIx);

    return {
      transaction,
      signers: [positionNftMint],
    };
  }
}