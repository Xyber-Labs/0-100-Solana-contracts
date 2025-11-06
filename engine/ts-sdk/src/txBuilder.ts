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
  private ammConfigIndex: number;

  constructor(program: Program<EngineIDL>, admin?: web3.Keypair) {
    this.program = program;
    this.seedRoot = Buffer.from(getConstant("seedRoot", program.idl as any));
    const constants: any[] = ((this.program as any).idl?.constants ?? []) as any[];
    const idxConst = constants.find((c: any) => c.name === "AMM_CONFIG_INDEX");
    this.ammConfigIndex = Number(idxConst?.value ?? 4);
  }

  private getRaydiumAmmConfigPda(): [web3.PublicKey, number] {
    const RAYDIUM_CLMM_PROGRAM_ID = new web3.PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");
    const indexBuffer = Buffer.alloc(2);
    indexBuffer.writeUInt16BE(Number.isFinite(this.ammConfigIndex) ? this.ammConfigIndex : 4, 0);
    return web3.PublicKey.findProgramAddressSync([Buffer.from("amm_config"), indexBuffer], RAYDIUM_CLMM_PROGRAM_ID);
  }

  private getIxMethod(primary: string, fallback: string) {
    const methods: any = (this.program as any).methods;
    return methods?.[primary] ?? methods?.[fallback];
  }

  getPda(seeds: (string | Buffer | web3.PublicKey | { publicKey?: web3.PublicKey } | Uint8Array)[]): [web3.PublicKey, number] {
    const toSeedBuffer = (seed: any): Buffer => {
      if (typeof seed === "string") return Buffer.from(seed);
      if (Buffer.isBuffer(seed)) return seed;
      if (seed instanceof Uint8Array) return Buffer.from(seed);
      if (seed && typeof seed.toBuffer === "function") return seed.toBuffer();
      if (seed && seed.publicKey && typeof seed.publicKey.toBuffer === "function") return seed.publicKey.toBuffer();
      throw new TypeError("Unsupported PDA seed type");
    };

    const seedBuffers = [this.seedRoot, ...seeds.map(toSeedBuffer)];

    return web3.PublicKey.findProgramAddressSync(seedBuffers, this.program.programId);
  }

  getRosterShardPda(launch: web3.PublicKey, shardId: number): [web3.PublicKey, number] {
    const le = Buffer.from(Uint8Array.of(shardId & 0xff, (shardId >> 8) & 0xff));
    return this.getPda(["roster_shard", launch, le]);
  }

  getTeamVestingPda(launch: web3.PublicKey): [web3.PublicKey, number] {
    return this.getPda(["team", launch]);
  }

  async initLaunchIx(params: {
    creator: web3.PublicKey;
    projectId: BN | number;
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
    creatorInitialDepositLamports: BN;
    creatorDailyLamportsLimit: BN;
    creatorClaimLockPeriodSec: BN;
    creatorMaxDepositLamports: BN;
    poolCreationGracePeriodSec?: number;
  }): Promise<{
    instruction: web3.TransactionInstruction;
    launchState: web3.PublicKey;
    escrowAuthority: web3.PublicKey;
    projectCounter: web3.PublicKey;
    creatorGrant: web3.PublicKey;
  }> {
    const projectIdLe = (() => {
      if (BN.isBN(params.projectId as any)) {
        const n = (params.projectId as BN).toArrayLike(Buffer, "le", 8);
        return n;
      }
      const n = BigInt(params.projectId as number);
      const buf = Buffer.alloc(8);
      buf.writeBigUInt64LE(n);
      return buf;
    })();
    const [launchState] = this.getPda(["launch", projectIdLe]);
    const [escrowAuthority] = this.getPda(["escrow_authority", launchState]);
    const [projectCounter] = this.getPda(["project_counter"]);
    const [creatorGrant] = this.getPda(["creator", launchState]);
    // No ATA creation at init stage

    const initParams: any = {
      hardCapLamports: params.hardCapLamports,
      minRaiseLamports: params.minRaiseLamports,
      perWalletCap: params.perWalletCap,
      tauLamports: params.tauLamports,
      baseTotalAllocation: params.baseTotalAllocation,
      baseSaleBasisPoints: params.baseSaleBasisPoints,
      fundingDurationSeconds: new BN(params.fundingDurationSeconds),
      saleStartTimeSec: new BN(params.saleStartTimeSec ?? 0),
      unlockTimeSec: new BN(params.unlockTimeSec ?? 0),
      rosterShardCap: params.rosterShardCap,
      creatorInitialDepositLamports: params.creatorInitialDepositLamports,
      creatorDailyLamportsLimit: params.creatorDailyLamportsLimit,
      creatorClaimLockPeriodSec: params.creatorClaimLockPeriodSec,
      creatorMaxDeposit: params.creatorMaxDepositLamports,
      poolCreationGracePeriodSec: new BN(params.poolCreationGracePeriodSec ?? 0),
    };

    const instruction = await (this.program.methods as any)
      .initLaunch(initParams, BN.isBN(params.projectId as any) ? params.projectId : new BN(params.projectId))
      .accountsStrict({
        creator: params.creator,
        launchState: launchState,
        escrowAuthority: escrowAuthority,
        projectCounter: projectCounter,
        creatorGrant: creatorGrant,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .instruction();

    return {
      instruction,
      launchState,
      escrowAuthority,
      projectCounter,
      creatorGrant,
    };
  }

  async initLaunchTx(params: {
    creator: web3.PublicKey;
    projectId: BN | number;
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
    creatorInitialDepositLamports: BN;
    creatorDailyLamportsLimit: BN;
    creatorClaimLockPeriodSec: BN;
    provider: any;
    creatorMaxDepositLamports: BN;
    poolCreationGracePeriodSec?: number;
  }): Promise<{
    initLaunchTx: web3.Transaction;
    launchState: web3.PublicKey;
    escrowAuthority: web3.PublicKey;
    creatorGrant: web3.PublicKey;
    signers: web3.Keypair[];
  }> {
    const {
      instruction: initLaunchIx,
      launchState,
      escrowAuthority,
      creatorGrant,
    } = await this.initLaunchIx({
      creator: params.creator,
      projectId: params.projectId,
      hardCapLamports: params.hardCapLamports,
      minRaiseLamports: params.minRaiseLamports,
      perWalletCap: params.perWalletCap,
      tauLamports: params.tauLamports,
      baseTotalAllocation: params.baseTotalAllocation,
      baseSaleBasisPoints: params.baseSaleBasisPoints,
      fundingDurationSeconds: params.fundingDurationSeconds,
      saleStartTimeSec: params.saleStartTimeSec ?? 0,
      unlockTimeSec: params.unlockTimeSec ?? 0,
      rosterShardCap: params.rosterShardCap,
      creatorInitialDepositLamports: params.creatorInitialDepositLamports,
      creatorDailyLamportsLimit: params.creatorDailyLamportsLimit,
      creatorClaimLockPeriodSec: params.creatorClaimLockPeriodSec,
      creatorMaxDepositLamports: params.creatorMaxDepositLamports,
      poolCreationGracePeriodSec: params.poolCreationGracePeriodSec,
    });

    const initLaunchTx = new web3.Transaction().add(initLaunchIx);

    return {
      initLaunchTx,
      launchState,
      escrowAuthority,
      creatorGrant,
      signers: [],
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
    // escrow removed; use only escrow_authority PDA
    const escrowAuthority = this.getPda(["escrow_authority", params.launch])[0];

    const instruction = await this.program.methods
      .deposit(params.amount)
      .accounts({
        user: params.user,
        launchState: params.launch,
        userContribution: userContribution,
        roster: roster,
        rosterShard,
        // escrow removed
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
    const escrowAuthority = this.getPda(["escrow_authority", params.launch])[0];

    const instruction = await this.program.methods
      .withdraw(params.amount)
      .accounts({
        user: params.user,
        launchState: params.launch,
        userContribution: userContribution,
        roster: roster,
        rosterShard,
        // escrow removed
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
        : (() => { throw new Error("Provide shardId or rosterShard for claimRefund"); })());
    // escrow removed

    const instruction = await this.program.methods
      .claimRefund()
      .accounts({
        user: params.user,
        launchState: params.launch,
        userContribution: userContribution,
        rosterShard,
        // escrow removed
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
    baseMint: web3.PublicKey;
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
    const [escrowAuthority] = this.getPda(["escrow_authority", params.launch]);
    const [poolState] = this.getPda(["pool", params.launch]);
    const userAta =
      params.userAta ??
      getAssociatedTokenAddressSync(params.baseMint, params.user, true);

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
              params.baseMint
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
            params.baseMint
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
        baseMint: params.baseMint,
        escrowAuthority,
        baseEscrowAta: getAssociatedTokenAddressSync(params.baseMint, escrowAuthority, true),
        userAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .remainingAccounts([
        { pubkey: poolState, isSigner: false, isWritable: false },
      ])
      .instruction();

    instructions.push(claimIx);

    return { instructions, userAta };
  }

  async claimTokensTx(params: {
    launch: web3.PublicKey;
    baseMint: web3.PublicKey;
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

  async initTeamVestingIx(params: { payer: web3.PublicKey; launch: web3.PublicKey }): Promise<{
    instruction: web3.TransactionInstruction;
    teamVesting: web3.PublicKey;
  }> {
    const [teamVesting] = this.getTeamVestingPda(params.launch);
    const method = this.getIxMethod("initTeamVesting", "init_team_vesting");
    if (!method) throw new Error("initTeamVesting method not found in program IDL");
    const instruction = await method()
      .accountsStrict({
        payer: params.payer,
        launchState: params.launch,
        teamVesting,
        systemProgram: web3.SystemProgram.programId,
      })
      .instruction();
    return { instruction, teamVesting };
  }

  async initTeamVestingTx(params: { payer: web3.PublicKey; launch: web3.PublicKey }): Promise<{
    transaction: web3.Transaction;
    teamVesting: web3.PublicKey;
  }> {
    const { instruction, teamVesting } = await this.initTeamVestingIx(params);
    const transaction = new web3.Transaction().add(instruction);
    return { transaction, teamVesting };
  }

  async claimTeamTokensTx(params: {
    launch: web3.PublicKey;
    baseMint: web3.PublicKey;
    creator: web3.PublicKey;
    creatorAta?: web3.PublicKey;
    createAtaIfMissing?: boolean;
    payer: web3.PublicKey;
  }): Promise<{ transaction: web3.Transaction; creatorAta: web3.PublicKey }> {
    const [poolState] = this.getPda(["pool", params.launch]);
    const [teamVesting] = this.getTeamVestingPda(params.launch);
    const [escrowAuthority] = this.getPda(["escrow_authority", params.launch]);
    const creatorAta = params.creatorAta ?? getAssociatedTokenAddressSync(params.baseMint, params.creator, true);

    const transaction = new web3.Transaction();

    if (params.createAtaIfMissing) {
      try {
        const ataInfo = await this.program.provider.connection.getAccountInfo(creatorAta);
        if (!ataInfo) {
          transaction.add(
            createAssociatedTokenAccountInstruction(
              params.payer,
              creatorAta,
              params.creator,
              params.baseMint
            )
          );
        }
      } catch (error) {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            params.payer,
            creatorAta,
            params.creator,
            params.baseMint
          )
        );
      }
    }

    const method = this.getIxMethod("claimTeamTokens", "claim_team_tokens");
    if (!method) throw new Error("claimTeamTokens method not found in program IDL");
    const ix = await method()
      .accounts({
        creator: params.creator,
        launchState: params.launch,
        poolState,
        teamVesting,
        baseMint: params.baseMint,
        escrowAuthority,
        baseEscrowAta: getAssociatedTokenAddressSync(params.baseMint, escrowAuthority, true),
        creatorAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .instruction();

    transaction.add(ix);

    return { transaction, creatorAta };
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

  // openClaimsIx removed; preparePoolCreation now handles finalization + claims opening

  async fetchUserContribution(launch: web3.PublicKey, user: web3.PublicKey) {
    const [pda] = this.getPda(["user", launch, user]);
    return this.program.account.userContribution.fetch(pda);
  }

  async fetchProjectCounter() {
    const [pda] = this.getPda(["project_counter"]);
    return this.program.account.projectCounter.fetch(pda);
  }

  async fetchTeamVesting(launch: web3.PublicKey) {
    const [pda] = this.getTeamVestingPda(launch);
    return this.program.account.teamVesting.fetch(pda);
  }

  async claimCreatorTokensTx(params: {
    launch: web3.PublicKey;
    baseMint: web3.PublicKey;
    creator: web3.PublicKey;
    creatorAta?: web3.PublicKey;
    createAtaIfMissing?: boolean;
    payer: web3.PublicKey;
  }): Promise<{ transaction: web3.Transaction; creatorAta: web3.PublicKey }> {
    const [creatorGrant] = this.getPda(["creator", params.launch]);
    const [escrowAuthority] = this.getPda(["escrow_authority", params.launch]);
    const [poolState] = this.getPda(["pool", params.launch]);
    const creatorAta =
      params.creatorAta ??
      getAssociatedTokenAddressSync(params.baseMint, params.creator, true);

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
              params.baseMint
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
            params.baseMint
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
        baseMint: params.baseMint,
        escrowAuthority,
        baseEscrowAta: getAssociatedTokenAddressSync(params.baseMint, escrowAuthority, true),
        creatorAta,
        poolState,
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
    const [escrowAuthority] = this.getPda(["escrow_authority", params.launch]);

    const transaction = new web3.Transaction();

    const claimIx = await this.program.methods
      .claimCreatorRefund()
      .accountsStrict({
        creator: params.creator,
        launchState: params.launch,
        creatorGrant,
        escrowAuthority,
        systemProgram: web3.SystemProgram.programId,
      })
      .instruction();

    transaction.add(claimIx);

    return { transaction };
  }

  async creatorDepositIx(params: { launch: web3.PublicKey; creator: web3.PublicKey; amount: BN }): Promise<{ instruction: web3.TransactionInstruction }> {
    const [escrowAuthority] = this.getPda(["escrow_authority", params.launch]);
    const [creatorGrant] = this.getPda(["creator", params.launch]);
    const instruction = await (this.program.methods as any)
      .creatorDeposit(params.amount)
      .accountsStrict({
        creator: params.creator,
        launchState: params.launch,
        escrowAuthority,
        creatorGrant,
        systemProgram: web3.SystemProgram.programId,
      })
      .instruction();
    return { instruction };
  }

  async creatorWithdrawIx(params: { launch: web3.PublicKey; creator: web3.PublicKey; amount: BN }): Promise<{ instruction: web3.TransactionInstruction }> {
    const [escrowAuthority] = this.getPda(["escrow_authority", params.launch]);
    const [creatorGrant] = this.getPda(["creator", params.launch]);
    const instruction = await (this.program.methods as any)
      .creatorWithdraw(params.amount)
      .accountsStrict({
        creator: params.creator,
        launchState: params.launch,
        escrowAuthority,
        creatorGrant,
        systemProgram: web3.SystemProgram.programId,
      })
      .instruction();
    return { instruction };
  }

  async fetchCreatorGrant(launch: web3.PublicKey) {
    const [creatorGrantPda] = this.getPda(["creator", launch]);
    return this.program.account.creatorGrant.fetch(creatorGrantPda);
  }



  async preparePoolCreationTx(params: {
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
      .preparePoolCreation()
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
    baseMint: web3.Keypair | web3.PublicKey; // create and initialize if Keypair provided
    ammConfig: web3.PublicKey;
    clmmProgram: web3.PublicKey;
    provider: any;
    preIxs?: web3.TransactionInstruction[];
  }): Promise<{
    transaction: web3.Transaction;
    signers: web3.Keypair[];
    baseMint: web3.PublicKey;
    baseTokenAta: web3.PublicKey;
    poolState: web3.PublicKey;
    tickArrayBitmap: web3.PublicKey;
  }> {
    const [escrowAuthority] = this.getPda(["escrow_authority", params.launch]);
    const [mintAuth] = this.getPda(["mint_auth", params.launch]);
    const isKeypair = !!((params as any).baseMint?.publicKey && typeof (params as any).baseMint.publicKey?.toBuffer === "function");
    const baseMint = (isKeypair
      ? (params.baseMint as any).publicKey
      : (params.baseMint as web3.PublicKey)
    );
    const maybeCreateMintIxs: web3.TransactionInstruction[] = [];
    if (isKeypair) {
      const existing = await this.program.provider.connection.getAccountInfo(baseMint);
      if (!existing) {
        const createMintAccountIx = web3.SystemProgram.createAccount({
          fromPubkey: params.payer,
          newAccountPubkey: baseMint,
          space: 82,
          lamports: await this.program.provider.connection.getMinimumBalanceForRentExemption(82),
          programId: TOKEN_PROGRAM_ID,
        });
        const initializeMintIx = createInitializeMintInstruction(
          baseMint,
          9,
          escrowAuthority,
          null
        );
        maybeCreateMintIxs.push(createMintAccountIx, initializeMintIx);
      }
    }

    const [mint0, mint1] = (() => {
      return params.quoteMint.toBuffer().compare(baseMint.toBuffer()) < 0
        ? [params.quoteMint, baseMint]
        : [baseMint, params.quoteMint];
    })();
    const ammConfigForPool = params.ammConfig ?? this.getRaydiumAmmConfigPda()[0];

    const [poolState] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), ammConfigForPool.toBuffer(), mint0.toBuffer(), mint1.toBuffer()],
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
        baseMint.toBuffer(),
      ],
      params.clmmProgram
    );

    const [tickArrayBitmap] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool_tick_array_bitmap_extension"), poolState.toBuffer()],
      params.clmmProgram
    );

    const baseTokenAta = getAssociatedTokenAddressSync(
      baseMint,
      escrowAuthority,
      true // allowOwnerOffCurve for PDA
    );


    const raydiumAmmConfig = params.ammConfig ?? this.getRaydiumAmmConfigPda()[0];

    const createClmmPoolIx = await (this.program.methods as any)
      .createClmmPool()
      .accountsStrict({
        payer: params.payer,
        launchState: params.launch,
        escrowAuthority: escrowAuthority,
        baseEscrowAta: baseTokenAta,
        baseMint: baseMint,
        quoteMint: params.quoteMint,
        raydiumAmmConfig,
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
      units: 1_400_000,
    });

    const transaction = new web3.Transaction();
    if (params.preIxs?.length) transaction.add(...params.preIxs);
    if (maybeCreateMintIxs.length) transaction.add(...maybeCreateMintIxs);
    transaction
      .add(computeBudgetIx)
      .add(createClmmPoolIx);

    return {
      transaction,
      signers: isKeypair && maybeCreateMintIxs.length ? [(params.baseMint as web3.Keypair)] : [],
      baseMint: baseMint,
      baseTokenAta,
      poolState,
      tickArrayBitmap,
    };
  }

  async mintForTestTx(params: {
    payer: web3.PublicKey;
    launch: web3.PublicKey;
    baseMint: web3.Keypair | web3.PublicKey; // create and initialize if Keypair provided
    preIxs?: web3.TransactionInstruction[];
  }): Promise<{
    transaction: web3.Transaction;
    signers: web3.Keypair[];
    baseMint: web3.PublicKey;
    baseTokenAta: web3.PublicKey;
  }> {
    const [escrowAuthority] = this.getPda(["escrow_authority", params.launch]);

    const isKeypair = !!((params as any).baseMint?.publicKey && typeof (params as any).baseMint.publicKey?.toBuffer === "function");
    const baseMint = (isKeypair
      ? (params.baseMint as any).publicKey
      : (params.baseMint as web3.PublicKey)
    );

    const maybeCreateMintIxs: web3.TransactionInstruction[] = [];
    if (isKeypair) {
      const existing = await this.program.provider.connection.getAccountInfo(baseMint);
      if (!existing) {
        const createMintAccountIx = web3.SystemProgram.createAccount({
          fromPubkey: params.payer,
          newAccountPubkey: baseMint,
          space: 82,
          lamports: await this.program.provider.connection.getMinimumBalanceForRentExemption(82),
          programId: TOKEN_PROGRAM_ID,
        });
        const initializeMintIx = createInitializeMintInstruction(
          baseMint,
          9,
          escrowAuthority,
          null
        );
        maybeCreateMintIxs.push(createMintAccountIx, initializeMintIx);
      }
    }

    const baseTokenAta = getAssociatedTokenAddressSync(
      baseMint,
      escrowAuthority,
      true
    );

    const ix = await (this.program.methods as any)
      .mintForTest()
      .accounts({
        payer: params.payer,
        launchState: params.launch,
        escrowAuthority: escrowAuthority,
        baseMint: baseMint,
        baseEscrowAta: baseTokenAta,
        baseTokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
      } as any)
      .instruction();

    const transaction = new web3.Transaction();
    if (params.preIxs?.length) transaction.add(...params.preIxs);
    if (maybeCreateMintIxs.length) transaction.add(...maybeCreateMintIxs);
    transaction.add(ix);

    return {
      transaction,
      signers: isKeypair && maybeCreateMintIxs.length ? [(params.baseMint as web3.Keypair)] : [],
      baseMint,
      baseTokenAta,
    };
  }

  async addClmmLiquidityTx(params: {
    payer: web3.PublicKey;
    launch: web3.PublicKey;
    quoteMint: web3.PublicKey;
    baseMint: web3.PublicKey; // ignored; use baseMint from launch
    baseTokenAta: web3.PublicKey;
    ammConfig?: web3.PublicKey;
    clmmProgram: web3.PublicKey;
    provider: any;
    baseAmount: BN;
    quoteAmount: BN;
    sqrtPriceLowerX64: BN;
  }): Promise<{
    transaction: web3.Transaction;
    signers: web3.Keypair[];
    quoteVault: web3.PublicKey;
    baseVault: web3.PublicKey;
    poolState: web3.PublicKey;
    positionNftMint: web3.PublicKey;
    positionNftAccount: web3.PublicKey;
    personalPosition: web3.PublicKey;
    protocolPosition: web3.PublicKey;
    quoteTokenAta: web3.PublicKey;
    ammConfig: web3.PublicKey;
    tickArrayLower: web3.PublicKey;
    tickArrayUpper: web3.PublicKey;
    bitmapExtension: web3.PublicKey;
    escrowAuthority: web3.PublicKey;
    tickArrayBitmap: web3.PublicKey;
  }> {
    const [escrow] = this.getPda(["escrow", params.launch]);
    const [escrowAuthority] = this.getPda(["escrow_authority", params.launch]);
    const launchState = await this.program.account.launchState.fetch(params.launch);
    const baseMint = launchState.baseMint as web3.PublicKey;

    const [mint0, mint1] = (() => {
      return params.quoteMint.toBuffer().compare(baseMint.toBuffer()) < 0
        ? [params.quoteMint, baseMint]
        : [baseMint, params.quoteMint];
    })();
    const ammConfigForAdd = params.ammConfig ?? this.getRaydiumAmmConfigPda()[0];

    const [raydiumPoolPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), ammConfigForAdd.toBuffer(), mint0.toBuffer(), mint1.toBuffer()],
      params.clmmProgram
    );

    const [bitmapExtension] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool_tick_array_bitmap_extension"), raydiumPoolPda.toBuffer()],
      params.clmmProgram
    );
    const [tickArrayBitmap] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("tick_array_bitmap"), raydiumPoolPda.toBuffer()],
      params.clmmProgram
    );

    const [quoteVault] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool_vault"),
        raydiumPoolPda.toBuffer(),
        params.quoteMint.toBuffer(),
      ],
      params.clmmProgram
    );

    const [baseVault] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool_vault"),
        raydiumPoolPda.toBuffer(),
        baseMint.toBuffer(),
      ],
      params.clmmProgram
    );

    const quoteTokenAta = getAssociatedTokenAddressSync(
      params.quoteMint,
      escrowAuthority,
      true
    );

    const positionNftMint = web3.Keypair.generate();
    const positionNftAccount = getAssociatedTokenAddressSync(
      positionNftMint.publicKey,
      escrowAuthority,
      true,
      TOKEN_2022_PROGRAM_ID
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

    const range = await this.getLiquidityRange({
      launch: params.launch,
      sqrtPriceLowerX64: params.sqrtPriceLowerX64,
    });
    const tickLowerIndex = range.tickArrayLower;
    const tickUpperIndex = range.tickArrayUpper;

    const tickLowerBuffer = Buffer.alloc(4);
    tickLowerBuffer.writeInt32BE(tickLowerIndex, 0);

    const tickUpperBuffer = Buffer.alloc(4);
    tickUpperBuffer.writeInt32BE(tickUpperIndex, 0);

    const [protocolPosition] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("protocol_position"),
        raydiumPoolPda.toBuffer(),
        tickLowerBuffer,
        tickUpperBuffer,
      ],
      params.clmmProgram
    );

    const tickArrayLowerStartIndex = range.tickArrayLowerStartIndex;
    const tickArrayUpperStartIndex = range.tickArrayUpperStartIndex;

    const tickArrayLowerBuffer = Buffer.alloc(4);
    tickArrayLowerBuffer.writeInt32BE(tickArrayLowerStartIndex, 0);

    const tickArrayUpperBuffer = Buffer.alloc(4);
    tickArrayUpperBuffer.writeInt32BE(tickArrayUpperStartIndex, 0);

    const [tickArrayLower] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("tick_array"),
        raydiumPoolPda.toBuffer(),
        tickArrayLowerBuffer,
      ],
      params.clmmProgram
    );

    const [tickArrayUpper] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("tick_array"),
        raydiumPoolPda.toBuffer(),
        tickArrayUpperBuffer,
      ],
      params.clmmProgram
    );

    const [poolState] = this.getPda(["pool", params.launch]);
    const addLiquidityIx = await this.program.methods
      .addClmmLiquidity(params.baseAmount, params.quoteAmount, params.sqrtPriceLowerX64)
      .accountsStrict({
        payer: params.payer,
        raydiumProgram: params.clmmProgram,
        launchState: params.launch,
        baseMint: baseMint,
        escrowAuthority: escrowAuthority,
        baseEscrowAta: params.baseTokenAta,
        quoteMint: params.quoteMint,
        raydiumAmmConfig: ammConfigForAdd,
        raydiumPoolState: raydiumPoolPda,
        raydiumQuoteVault: quoteVault,
        raydiumBaseVault: baseVault,
        raydiumPositionNftMint: positionNftMint.publicKey,
        raydiumPositionNftAccount: positionNftAccount,
        raydiumPersonalPosition: personalPosition,
        raydiumProtocolPosition: protocolPosition,
        raydiumTickArrayLower: tickArrayLower,
        raydiumTickArrayUpper: tickArrayUpper,
        quoteTokenAta: quoteTokenAta,
        token2022Program: TOKEN_2022_PROGRAM_ID,
        quoteTokenProgram: TOKEN_PROGRAM_ID,
        baseTokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .remainingAccounts([
        { pubkey: bitmapExtension, isSigner: false, isWritable: true },
      ])
      .instruction();

    const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({
      units: 1_400_000,
    });

    const transaction = new web3.Transaction()
      .add(computeBudgetIx)
      .add(addLiquidityIx);

    return {
      transaction,
      signers: [positionNftMint],
      quoteVault,
      baseVault,
      poolState: raydiumPoolPda,
      positionNftMint: positionNftMint.publicKey,
      positionNftAccount,
      personalPosition,
      protocolPosition,
      quoteTokenAta,
      ammConfig: ammConfigForAdd,
      tickArrayLower,
      tickArrayUpper,
      bitmapExtension,
      tickArrayBitmap,
      escrowAuthority,
    };
  }

  async getLiquidityRange(params: {
    launch: web3.PublicKey;
    sqrtPriceLowerX64: BN;
  }): Promise<{
    tickArrayLower: number;
    tickArrayUpper: number;
    tickArrayLowerStartIndex: number;
    tickArrayUpperStartIndex: number;
  }> {
    const [ammConfig] = this.getRaydiumAmmConfigPda();

    try {
      const res = await (this.program.methods as any)
        .getLiquidityRange(params.sqrtPriceLowerX64)
        .accountsStrict({
          launchState: params.launch,
          raydiumAmmConfig: ammConfig,
        })
        .view();
      return res as any;
    } catch (_) {
      const tx = await (this.program.methods as any)
        .getLiquidityRange(params.sqrtPriceLowerX64)
        .accountsStrict({
          launchState: params.launch,
          raydiumAmmConfig: ammConfig,
        })
        .transaction();

      tx.feePayer = (this.program.provider as any).publicKey;
      const { blockhash } = await this.program.provider.connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;

      const simulation = await this.program.provider.connection.simulateTransaction(tx);
      if (simulation.value.err) {
        throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
      }
      const returnData = simulation.value.returnData;
      if (!returnData || !returnData.data) {
        throw new Error("No return data from getLiquidityRange");
      }
      const [data, encoding] = returnData.data as [string, BufferEncoding];
      const buffer = Buffer.from(data, encoding);

      const tickArrayLower = buffer.readInt32LE(0);
      const tickArrayLowerStartIndex = buffer.readInt32LE(4);
      const tickArrayUpper = buffer.readInt32LE(8);
      const tickArrayUpperStartIndex = buffer.readInt32LE(12);

      return {
        tickArrayLower,
        tickArrayLowerStartIndex,
        tickArrayUpper,
        tickArrayUpperStartIndex,
      };
    }
  }
}
