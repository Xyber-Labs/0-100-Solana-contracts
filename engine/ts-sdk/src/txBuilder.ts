import { BN, Program, web3 } from "@coral-xyz/anchor";
import type { Engine as EngineIDL } from "../idl/engine";
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
const WSOL_MINT = new web3.PublicKey("So11111111111111111111111111111111111111112");

export class TxBuilder {
  private program: Program<EngineIDL>;
  private seedRoot: Buffer;
  private ammConfigIndex: number;

  constructor(program: Program<EngineIDL>, _admin?: web3.Keypair) {
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

  getConfigPda(): [web3.PublicKey, number] {
    return this.getPda(["config"]);
  }

  async getSqrtPriceLowerX64ForPool(params: {
    launch: web3.PublicKey;
    priceBumpMultiplier?: number; // e.g. 1.15
    lowerRangePow10?: number; // e.g. -5
  }): Promise<BN> {
    const launchState: any = await this.program.account.launchState.fetch(params.launch);
    const baseMint: web3.PublicKey = launchState.baseMint as web3.PublicKey;
    const straight = baseMint.toBuffer().compare(WSOL_MINT.toBuffer()) < 0;

    const priceRatio = 7.16e-7; // same constant as on-chain calc
    const basePrice = straight ? priceRatio : 1 / priceRatio;
    const priceBump = params.priceBumpMultiplier ?? 1.15;
    const lowerPow = params.lowerRangePow10 ?? -5;
    const targetPriceLower = basePrice * priceBump * Math.pow(10, lowerPow);
    const Q64 = Math.pow(2, 64);
    const sqrtLower = Math.sqrt(targetPriceLower) * Q64;
    // Convert potentially-large float to integer string safely (without exceeding JS safe integer)
    const expStr = sqrtLower.toExponential(20); // mantissa with 20 digits
    const [mantissaStr, eStr] = expStr.split("e");
    const exp = parseInt(eStr, 10);
    const [intPart, fracPartRaw] = mantissaStr.split(".");
    const fracPart = (fracPartRaw ?? "").replace(/[^0-9]/g, "");
    const digits = (intPart + fracPart).replace(/^0+/, "") || "0";
    const k = exp - (fracPart.length);
    let integerStr: string;
    if (k >= 0) {
      integerStr = digits + "0".repeat(k);
    } else {
      const cut = digits.length + k;
      integerStr = cut > 0 ? digits.slice(0, cut) : "0";
    }
    // Floor to integer by construction
    return new BN(integerStr === "" ? "0" : integerStr);
  }

  async estimateQuoteForBase(params: { launch: web3.PublicKey; baseAmount: BN; safetyBumpBps?: number }): Promise<BN> {
    const baseTokens = BigInt(params.baseAmount.toString()); // base tokens (no decimals)
    const bumpBps = BigInt((params.safetyBumpBps ?? 10200).toString()); // default +2%
    // Economic price: 7.16e-7 SOL per base token → 716 lamports per base token
    let quoteLamports = baseTokens * 716n;
    quoteLamports = (quoteLamports * bumpBps) / 10000n;
    return new BN(quoteLamports.toString());
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

  getLaunchPresetPda(id: number): [web3.PublicKey, number] {
    const one = Buffer.from(Uint8Array.of(id & 0xff));
    return this.getPda(["preset", one]);
  }

  getTokenMetadataConfigPda(launch: web3.PublicKey): [web3.PublicKey, number] {
    return this.getPda(["token_metadata", launch]);
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
    rosterShardsTotal: number;
    creatorInitialDepositLamports: BN;
    creatorDailyLamportsLimit: BN;
    creatorClaimLockPeriodSec: BN;
    creatorMaxDepositLamports: BN;
    poolCreationGracePeriodSec?: number;
    xyberMint: web3.PublicKey;
    name: string;
    symbol: string;
    uri: string;
    isMutable?: boolean;
    sellerFeeBasisPoints?: number;
    teamVestingDurationSec?: number;
    teamAllocationBasisPoints?: number;
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
      teamAllocationBasisPoints: new BN(
        typeof params.teamAllocationBasisPoints === "number"
          ? params.teamAllocationBasisPoints
          : 1000
      ),
      fundingDurationSeconds: new BN(params.fundingDurationSeconds),
      saleStartTimeSec: new BN(params.saleStartTimeSec ?? 0),
      unlockTimeSec: new BN(params.unlockTimeSec ?? 0),
      rosterShardCap: params.rosterShardCap,
      rosterShardsTotal: params.rosterShardsTotal,
      creatorInitialDepositLamports: params.creatorInitialDepositLamports,
      creatorDailyLamportsLimit: params.creatorDailyLamportsLimit,
      creatorClaimLockPeriodSec: params.creatorClaimLockPeriodSec,
      creatorMaxDeposit: params.creatorMaxDepositLamports,
      poolCreationGracePeriodSec: new BN(params.poolCreationGracePeriodSec ?? 0),
      teamVestingDurationSec: new BN(params.teamVestingDurationSec ?? 365 * 24 * 60 * 60),
      name: params.name,
      symbol: params.symbol,
      uri: params.uri,
      isMutable: typeof params.isMutable === "boolean" ? params.isMutable : true,
      sellerFeeBasisPoints: typeof params.sellerFeeBasisPoints === "number" ? params.sellerFeeBasisPoints : 0,
    };

    const [engineConfig] = this.getPda(["config"]);
    let treasury: web3.PublicKey | undefined;
    try {
      const cfg: any = (await (this.program.account as any).engineConfig.fetch(engineConfig)) as any;
      treasury = (cfg?.treasury as web3.PublicKey) ?? undefined;
    } catch {}
    // Fallback to creator as treasury owner if config fetch fails on some clusters
    const treasuryOwner = treasury ?? params.creator;
    const creatorXyberAta = getAssociatedTokenAddressSync(params.xyberMint, params.creator, true);
    const treasuryXyberAta = getAssociatedTokenAddressSync(params.xyberMint, treasuryOwner, true);

    const instruction = await (this.program.methods as any)
      .initLaunch(initParams, BN.isBN(params.projectId as any) ? params.projectId : new BN(params.projectId))
      .accountsStrict({
        creator: params.creator,
        launchState: launchState,
        escrowAuthority: escrowAuthority,
        projectCounter: projectCounter,
        creatorGrant: creatorGrant,
        engineConfig,
        creatorXyberAta,
        treasuryXyberAta,
        tokenMetadataConfig: this.getTokenMetadataConfigPda(launchState)[0],
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

  async initLaunchFromPresetIx(params: {
    creator: web3.PublicKey;
    presetId: number;
    projectId: BN | number;
    name: string;
    symbol: string;
    uri: string;
    isMutable?: boolean;
    sellerFeeBasisPoints?: number;
    xyberMint?: web3.PublicKey;
  }): Promise<{
    instruction: web3.TransactionInstruction;
    launchState: web3.PublicKey;
    escrowAuthority: web3.PublicKey;
    projectCounter: web3.PublicKey;
    creatorGrant: web3.PublicKey;
    tokenMetadataConfig: web3.PublicKey;
    launchPreset: web3.PublicKey;
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
    const [tokenMetadataConfig] = this.getTokenMetadataConfigPda(launchState);
    const [engineConfig] = this.getPda(["config"]);
    const [launchPreset] = this.getLaunchPresetPda(params.presetId);

    // Fetch config to get xyberMint and treasury owner
    const cfg: any = await (this.program.account as any).engineConfig.fetch(engineConfig);
    const xyberMint = params.xyberMint ?? (cfg?.xyberMint as web3.PublicKey);
    const treasuryOwner = cfg?.treasury as web3.PublicKey;
    const creatorXyberAta = getAssociatedTokenAddressSync(xyberMint, params.creator, true);
    const treasuryXyberAta = getAssociatedTokenAddressSync(xyberMint, treasuryOwner, true);

    const metaArg = {
      name: params.name,
      symbol: params.symbol,
      uri: params.uri,
      isMutable: typeof params.isMutable === "boolean" ? params.isMutable : true,
      sellerFeeBasisPoints: typeof params.sellerFeeBasisPoints === "number" ? params.sellerFeeBasisPoints : 0,
    };
    const instruction = await (this.program.methods as any)
      .initLaunchFromPreset(
        new BN(params.presetId),
        BN.isBN(params.projectId as any) ? params.projectId : new BN(params.projectId),
        metaArg
      )
      .accountsStrict({
        creator: params.creator,
        projectCounter,
        launchState,
        escrowAuthority,
        creatorGrant,
        tokenMetadataConfig,
        engineConfig,
        creatorXyberAta,
        treasuryXyberAta,
        launchPreset,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    return {
      instruction,
      launchState,
      escrowAuthority,
      projectCounter,
      creatorGrant,
      tokenMetadataConfig,
      launchPreset,
    };
  }

  async initLaunchPresetIx(params: {
    payer: web3.PublicKey;
    id: number;
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
    creatorMaxDepositLamports: BN;
    poolCreationGracePeriodSec?: number;
    teamVestingDurationSec?: number;
    teamAllocationBasisPoints?: number;
    signerAdmins: web3.PublicKey[];
  }): Promise<{ instruction: web3.TransactionInstruction; launchPreset: web3.PublicKey; engineConfig: web3.PublicKey }> {
    const [engineConfig] = this.getPda(["config"]);
    const [launchPreset] = this.getLaunchPresetPda(params.id);

    const initParams: any = {
      hardCapLamports: params.hardCapLamports,
      minRaiseLamports: params.minRaiseLamports,
      perWalletCap: params.perWalletCap,
      tauLamports: params.tauLamports,
      baseTotalAllocation: params.baseTotalAllocation,
      baseSaleBasisPoints: params.baseSaleBasisPoints,
      teamAllocationBasisPoints: new BN(
        typeof params.teamAllocationBasisPoints === "number"
          ? params.teamAllocationBasisPoints
          : 1000
      ),
      fundingDurationSeconds: new BN(params.fundingDurationSeconds),
      saleStartTimeSec: new BN(params.saleStartTimeSec ?? 0),
      unlockTimeSec: new BN(params.unlockTimeSec ?? 0),
      rosterShardCap: params.rosterShardCap,
      rosterShardsTotal: params.rosterShardsTotal,
      creatorInitialDepositLamports: params.creatorInitialDepositLamports,
      creatorDailyLamportsLimit: params.creatorDailyLamportsLimit,
      creatorClaimLockPeriodSec: params.creatorClaimLockPeriodSec,
      creatorMaxDeposit: params.creatorMaxDepositLamports,
      poolCreationGracePeriodSec: new BN(params.poolCreationGracePeriodSec ?? 0),
      teamVestingDurationSec: new BN(params.teamVestingDurationSec ?? 365 * 24 * 60 * 60),
    };

    const method = this.getIxMethod("initLaunchPreset", "init_launch_preset");
    if (!method) throw new Error("initLaunchPreset method not found in program IDL");
    const instruction = await method(new BN(params.id), initParams)
      .accountsStrict({
        payer: params.payer,
        engineConfig,
        launchPreset,
        systemProgram: web3.SystemProgram.programId,
      })
      .remainingAccounts(
        params.signerAdmins.map((pubkey) => ({ pubkey, isSigner: true, isWritable: false }))
      )
      .instruction();
    return { instruction, launchPreset, engineConfig };
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
    rosterShardsTotal: number;
    creatorInitialDepositLamports: BN;
    creatorDailyLamportsLimit: BN;
    creatorClaimLockPeriodSec: BN;
    provider: any;
    creatorMaxDepositLamports: BN;
    poolCreationGracePeriodSec?: number;
    xyberMint: web3.PublicKey;
    name: string;
    symbol: string;
    uri: string;
    isMutable?: boolean;
    sellerFeeBasisPoints?: number;
    // Missing optional fields to be forwarded to initLaunchIx:
    teamVestingDurationSec?: number;
    teamAllocationBasisPoints?: number;
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
      rosterShardsTotal: params.rosterShardsTotal,
      creatorInitialDepositLamports: params.creatorInitialDepositLamports,
      creatorDailyLamportsLimit: params.creatorDailyLamportsLimit,
      creatorClaimLockPeriodSec: params.creatorClaimLockPeriodSec,
      creatorMaxDepositLamports: params.creatorMaxDepositLamports,
      poolCreationGracePeriodSec: params.poolCreationGracePeriodSec,
      xyberMint: params.xyberMint,
      name: params.name,
      symbol: params.symbol,
      uri: params.uri,
      isMutable: params.isMutable,
      sellerFeeBasisPoints: params.sellerFeeBasisPoints,
      // Forward team vesting config so we don't silently fall back to 1y default
      teamAllocationBasisPoints: params.teamAllocationBasisPoints,
      teamVestingDurationSec: params.teamVestingDurationSec,
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

  async initEngineConfigIx(params: {
    payer: web3.PublicKey;
    treasury: web3.PublicKey;
    creationFee: BN;
    xyberMint: web3.PublicKey;
    admins: [web3.PublicKey, web3.PublicKey, web3.PublicKey];
    threshold: number;
    signerAdmins: web3.PublicKey[];
  }): Promise<{ instruction: web3.TransactionInstruction; engineConfig: web3.PublicKey }> {
    const [engineConfig] = this.getConfigPda();
    const method = this.getIxMethod("initEngineConfig", "init_engine_config");
    if (!method) throw new Error("initEngineConfig method not found in program IDL");
    const ix = await method({
      treasury: params.treasury,
      creationFee: params.creationFee,
      xyberMint: params.xyberMint,
      admins: params.admins,
      threshold: params.threshold,
    })
      .accountsStrict({
        payer: params.payer,
        engineConfig,
        systemProgram: web3.SystemProgram.programId,
      })
      .remainingAccounts(
        params.admins.map((pubkey) => ({ pubkey, isSigner: params.signerAdmins.some((s) => s.equals(pubkey)), isWritable: false }))
      )
      .instruction();
    return { instruction: ix, engineConfig };
  }

  async updateEngineConfigIx(params: {
    payer: web3.PublicKey;
    newTreasury?: web3.PublicKey;
    newCreationFee?: BN;
    newXyberMint?: web3.PublicKey;
    newAdmins?: [web3.PublicKey, web3.PublicKey, web3.PublicKey];
    newThreshold?: number;
    signerAdmins: web3.PublicKey[];
  }): Promise<{ instruction: web3.TransactionInstruction; engineConfig: web3.PublicKey }> {
    const [engineConfig] = this.getConfigPda();
    const method = this.getIxMethod("updateEngineConfig", "update_engine_config");
    if (!method) throw new Error("updateEngineConfig method not found in program IDL");
    const ix = await method({
      newTreasury: params.newTreasury ?? null,
      newCreationFee: params.newCreationFee ?? null,
      newXyberMint: params.newXyberMint ?? null,
      newAdmins: params.newAdmins ?? null,
      newThreshold: typeof params.newThreshold === "number" ? params.newThreshold : null,
    })
      .accountsStrict({
        payer: params.payer,
        engineConfig,
      })
      .remainingAccounts(
        params.signerAdmins.map((pubkey) => ({ pubkey, isSigner: true, isWritable: false }))
      )
      .instruction();
    return { instruction: ix, engineConfig };
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

  // metadata is set during initLaunch; no extra instruction needed

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
    const rosterShard = params.rosterShard; // do not auto-fill or fallback; omit when not provided
    // escrow removed

    const [escrowAuthority] = this.getPda(["escrow_authority", params.launch]);
    const method = this.program.methods.claimRefund();
    const acct: any = {
      user: params.user,
      launchState: params.launch,
      userContribution,
      escrowAuthority,
      systemProgram: web3.SystemProgram.programId,
    };
    // Optional account must be present for accountsStrict; pass null when absent
    acct.rosterShard = rosterShard ?? null;
    const instruction = await (method as any).accountsStrict(acct).instruction();

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
    const rosterShard = params.rosterShard; // do not auto-fill; omit when not provided
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

    const method = this.program.methods.claimTokens();
    const accts: any = {
      user: params.user,
      launchState: params.launch,
      userContribution,
      poolState,
      baseMint: params.baseMint,
      escrowAuthority,
      baseEscrowAta: getAssociatedTokenAddressSync(params.baseMint, escrowAuthority, true),
      userAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    };
    // Optional account must be present for accountsStrict; pass null when absent
    accts.rosterShard = rosterShard ?? null;
    const claimIx = await (method as any).accountsStrict(accts).instruction();

    instructions.push(claimIx);

    return { instructions, userAta };
  }

  async sealRosterShardIx(params: {
    payer: web3.PublicKey;
    launch: web3.PublicKey;
    shardId: number;
    from: number;
    max: number;
    walletsSlice: web3.PublicKey[]; // wallets[from..end] in exact order
  }): Promise<{ instruction: web3.TransactionInstruction; rosterShard: web3.PublicKey }> {
    const [rosterShard] = this.getRosterShardPda(params.launch, params.shardId);
    const method = (this.program.methods as any).sealRosterShard(params.shardId, params.from, params.max);
    const ixBuilder = method.accounts({
      payer: params.payer,
      systemProgram: web3.SystemProgram.programId,
      launchState: params.launch,
      rosterShard,
    });
    const remaining = params.walletsSlice.map((w) => {
      const [userPda] = this.getPda(["user", params.launch, w]);
      return { pubkey: userPda, isSigner: false, isWritable: true };
    });
    const instruction = await ixBuilder.remainingAccounts(remaining).instruction();
    return { instruction, rosterShard };
  }

  async closeRosterShardIx(params: {
    payer: web3.PublicKey;
    launch: web3.PublicKey;
    shardId: number;
  }): Promise<{ instruction: web3.TransactionInstruction; rosterShard: web3.PublicKey }> {
    const [rosterShard] = this.getRosterShardPda(params.launch, params.shardId);
    const method = (this.program.methods as any).closeRosterShard(params.shardId);
    const instruction = await method
      .accounts({
        payer: params.payer,
        launchState: params.launch,
        rosterShard,
        systemProgram: web3.SystemProgram.programId,
      } as any)
      .instruction();
    return { instruction, rosterShard };
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
    const [creatorGrant] = this.getPda(["creator", params.launch]);
    const SLOT_HASHES_SYSVAR = new web3.PublicKey("SysvarS1otHashes111111111111111111111111111");

    const ix = await this.program.methods
      .preparePoolCreation()
      .accountsStrict({
        payer: params.payer,
        launchState: params.launch,
        creatorGrant,
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
    
    const isKeypair = !!((params as any).baseMint?.publicKey && typeof (params as any).baseMint.publicKey?.toBuffer === "function");
    const baseMint = (isKeypair
      ? (params.baseMint as any).publicKey
      : (params.baseMint as web3.PublicKey)
    );
    const maybeCreateMintIxs: web3.TransactionInstruction[] = [];
    if (isKeypair) {
      let existing: any = null;
      try {
        existing = await this.program.provider.connection.getAccountInfo(baseMint);
      } catch (_) {
        existing = null; // LiteSVM throws if account missing
      }
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

    const [raydiumPoolState] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), ammConfigForPool.toBuffer(), mint0.toBuffer(), mint1.toBuffer()],
      params.clmmProgram
    );

    const [observationState] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("observation"), raydiumPoolState.toBuffer()],
      params.clmmProgram
    );

    const [quoteVault] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool_vault"),
        raydiumPoolState.toBuffer(),
        params.quoteMint.toBuffer(),
      ],
      params.clmmProgram
    );

    const [baseVault] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool_vault"),
        raydiumPoolState.toBuffer(),
        baseMint.toBuffer(),
      ],
      params.clmmProgram
    );

    const [tickArrayBitmap] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool_tick_array_bitmap_extension"), raydiumPoolState.toBuffer()],
      params.clmmProgram
    );

    const baseTokenAta = getAssociatedTokenAddressSync(
      baseMint,
      escrowAuthority,
      true // allowOwnerOffCurve for PDA
    );


    const raydiumAmmConfig = params.ammConfig ?? this.getRaydiumAmmConfigPda()[0];
    const [enginePoolState] = this.getPda(["pool", params.launch]);

    const createClmmPoolIx = await (this.program.methods as any)
      .createClmmPool()
      .accountsStrict({
        payer: params.payer,
        launchState: params.launch,
        poolState: enginePoolState,
        escrowAuthority: escrowAuthority,
        baseEscrowAta: baseTokenAta,
        baseMint: baseMint,
        quoteMint: params.quoteMint,
        raydiumAmmConfig,
        raydiumPoolState,
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
        metadataAccount: web3.PublicKey.findProgramAddressSync([
          Buffer.from("metadata"),
          METADATA_PROGRAM_ID.toBuffer(),
          baseMint.toBuffer(),
        ], METADATA_PROGRAM_ID)[0],
        tokenMetadataConfig: this.getTokenMetadataConfigPda(params.launch)[0],
        tokenMetadataProgram: METADATA_PROGRAM_ID,
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
      poolState: raydiumPoolState,
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
      let existing: any = null;
      try {
        existing = await this.program.provider.connection.getAccountInfo(baseMint);
      } catch (_) {
        existing = null; // LiteSVM throws if account missing
      }
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
        poolState: poolState,
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

    try {
      transaction.partialSign(positionNftMint);
    } catch {}

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

      const providerAny: any = this.program.provider as any;
      const walletPayerPubkey = providerAny?.wallet?.payer?.publicKey;
      if (!walletPayerPubkey) throw new Error("LiteSVM: missing wallet.payer for feePayer");
      tx.feePayer = walletPayerPubkey;
      const conn: any = providerAny.connection;
      let blockhash: string | undefined;
      if (conn && typeof conn.getLatestBlockhash === "function") {
        const res = await conn.getLatestBlockhash();
        blockhash = res?.blockhash ?? res;
      } else if (conn && typeof conn.getRecentBlockhash === "function") {
        const res = await conn.getRecentBlockhash();
        blockhash = res?.blockhash ?? res;
      } else if (conn && typeof conn.latestBlockhash === "function") {
        blockhash = await conn.latestBlockhash();
      } else if (typeof providerAny.latestBlockhash === "function") {
        blockhash = await providerAny.latestBlockhash();
      }
      if (blockhash) tx.recentBlockhash = blockhash as string;

      // Ensure the tx is signed before simulation (LiteSVM requires signatures)
      try {
        tx.partialSign(providerAny.wallet.payer);
      } catch (_) {}

      let simulation: any;
      if (conn && typeof conn.simulateTransaction === "function") {
        try {
          simulation = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true } as any);
        } catch (_) {
          simulation = await conn.simulateTransaction(tx);
        }
      } else if (typeof providerAny.simulate === "function") {
        simulation = await providerAny.simulate(tx);
      } else {
        throw new Error("Simulation not supported by provider");
      }
      if (simulation.value.err) {
        throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
      }
      const returnData = simulation.value?.returnData ?? simulation.returnData;
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
