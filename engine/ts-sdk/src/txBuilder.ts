import { Program, BN } from "@coral-xyz/anchor";
import { Transaction, TransactionInstruction, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { Engine as EngineIDL } from "../idl/engine";
import { TOKEN_PROGRAM_ID, createInitializeMintInstruction } from "@solana/spl-token";

type LaunchState = Extract<EngineIDL["accounts"][number], { name: "launchState" }>["type"];
type UserContribution = Extract<EngineIDL["accounts"][number], { name: "userContribution" }>["type"];  
type RosterAccount = Extract<EngineIDL["accounts"][number], { name: "rosterAccount" }>["type"];
type SelectionState = Extract<EngineIDL["accounts"][number], { name: "selectionState" }>["type"];

export class TxBuilder {
  private program: Program<EngineIDL>;

  constructor(program: Program<EngineIDL>) {
    this.program = program;
  }

  async fetchAccount<T>(
    accountType: string,
    address: PublicKey,
    provider: any
  ): Promise<T> {
    const accountInfo = await provider.connection.getAccountInfo(address);
    if (!accountInfo) {
      throw new Error(`${accountType} account not found at ${address.toString()}`);
    }
    
    return this.program.coder.accounts.decode(accountType, accountInfo.data);
  }

  async fetchLaunchState(address: PublicKey, provider: any): Promise<LaunchState> {
    return this.fetchAccount<LaunchState>("launchState", address, provider);
  }

  async fetchUserContribution(address: PublicKey, provider: any): Promise<UserContribution> {
    return this.fetchAccount<UserContribution>("userContribution", address, provider);
  }

  async fetchRosterAccount(address: PublicKey, provider: any): Promise<RosterAccount> {
    return this.fetchAccount<RosterAccount>("rosterAccount", address, provider);
  }

  async fetchSelectionState(address: PublicKey, provider: any): Promise<SelectionState> {
    return this.fetchAccount<SelectionState>("selectionState", address, provider);
  }

  async fetchUserContribution(address: PublicKey, provider: any): Promise<UserContribution> {
    return this.fetchAccount<UserContribution>("userContribution", address, provider);
  }

  getPda(seeds: (string | Buffer | PublicKey)[]): [PublicKey, number] {
    const seedBuffers = seeds.map(seed => {
      if (typeof seed === 'string') {
        return Buffer.from(seed);
      } else if (seed instanceof PublicKey) {
        return seed.toBuffer();
      } else {
        return seed;
      }
    });
    
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
        params.lpAllocation
      )
      .accounts({
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
    provider: any;
  }): Promise<{
    transaction: Transaction;
    launchState: PublicKey;
    escrow: PublicKey;
    signers: Keypair[];
  }> {
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
      params.admin,
      params.admin
    );

    const { instruction: initLaunchIx, launchState, escrow } = await this.initLaunchIx({
      admin: params.admin,
      saleMint: params.saleMint.publicKey,
      hardCapLamports: params.hardCapLamports,
      minRaiseLamports: params.minRaiseLamports,
      perWalletCap: params.perWalletCap,
      tauLamports: params.tauLamports,
      saleAllocation: params.saleAllocation,
      lpAllocation: params.lpAllocation,
    });

    const transaction = new Transaction()
      .add(createMintAccountIx)
      .add(initializeMintIx)
      .add(initLaunchIx);

    return {
      transaction,
      launchState,
      escrow,
      signers: [params.saleMint],
    };
  }

  async openFundingIx(params: {
    launch: PublicKey;
    admin: PublicKey;
  }): Promise<TransactionInstruction> {
    return await this.program.methods
      .openFunding()
      .accounts({
        admin: params.admin,
        launchState: params.launch,
      })
      .instruction();
  }

  async openFundingTx(params: {
    launch: PublicKey;
    admin: PublicKey;
  }): Promise<Transaction> {
    const ix = await this.openFundingIx(params);
    return new Transaction().add(ix);
  }

  async initRosterIx(params: {
    launch: PublicKey;
    admin: PublicKey;
  }): Promise<{ instruction: TransactionInstruction; rosterPda: PublicKey }> {
    const [rosterPda] = this.getPda(["roster", params.launch]);

    const instruction = await this.program.methods
      .initRoster()
      .accounts({
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

  async closeDepositsIx(params: {
    launch: PublicKey;
    admin: PublicKey;
    roster?: PublicKey;
  }): Promise<TransactionInstruction> {
    const roster = params.roster ?? this.getPda(["roster", params.launch])[0];

    return await this.program.methods
      .closeDeposits()
      .accounts({
        admin: params.admin,
        launchState: params.launch,
        roster: roster,
        launch: params.launch,
      })
      .instruction();
  }

  async closeDepositsTx(params: {
    launch: PublicKey;
    admin: PublicKey;
    roster?: PublicKey;
  }): Promise<Transaction> {
    const ix = await this.closeDepositsIx(params);
    return new Transaction().add(ix);
  }

  async setSeedIx(params: {
    launch: PublicKey;
    admin: PublicKey;
    seed: Uint8Array | number[] | Buffer;
  }): Promise<{ instruction: TransactionInstruction; selectionPda: PublicKey }> {
    const [selectionPda] = this.getPda(["selection", params.launch]);
    
    const seed32 = this.ensure32Bytes(params.seed);

    const instruction = await this.program.methods
      .setSeed(seed32)
      .accounts({
        admin: params.admin,
        launchState: params.launch,
        selectionState: selectionPda,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    return { instruction, selectionPda };
  }

  async setSeedTx(params: {
    launch: PublicKey;
    admin: PublicKey;
    seed: Uint8Array | number[] | Buffer;
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
      .accounts({
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

  private ensure32Bytes(seed: Uint8Array | number[] | Buffer): Buffer {
    const buf = Buffer.from(seed);
    if (buf.length !== 32) throw new Error("seed must be 32 bytes");
    return buf;
  }
}