import { BN, Program, web3 } from "@coral-xyz/anchor";
import type { Engine as EngineIDL } from "../../idl/engine";
import EngineIDLJson from "../../idl/engine.json";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import { getConstant, getConstantRaw } from "../utils";

const METADATA_PROGRAM_ID = new web3.PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const WSOL_MINT = new web3.PublicKey("So11111111111111111111111111111111111111112");
const INCOME_DISPATCHER_PROGRAM_ID = new web3.PublicKey(getConstantRaw("INCOME_DISPATCHER_PROGRAM_ID", EngineIDLJson as any));
const INCOME_DISPATCHER_SEED_ROOT = Buffer.from(getConstant("DISPATCHER_SEED_ROOT", EngineIDLJson as any));

export class TxBuilder {
  private program: Program<EngineIDL>;
  private seedRoot: Buffer;
  private ammConfigIndex: number;
  private raydiumClmmProgramId: web3.PublicKey;

  constructor(program: Program<EngineIDL>, _admin?: web3.Keypair) {
    this.program = program;
    this.seedRoot = Buffer.from(getConstant("seedRoot", program.idl as any));
    this.ammConfigIndex = Number(getConstantRaw("ammConfigIndex", program.idl as any));
    this.raydiumClmmProgramId = new web3.PublicKey(getConstantRaw("raydiumClmmProgramId", program.idl as any));
  }

  getAmmConfigIndex(): number {
    return this.ammConfigIndex;
  }

  getRaydiumClmmProgramId(): web3.PublicKey {
    return this.raydiumClmmProgramId;
  }

  getRaydiumAmmConfigPda(): [web3.PublicKey, number] {
    const indexBuffer = Buffer.alloc(2);
    indexBuffer.writeUInt16BE(this.ammConfigIndex, 0);
    return web3.PublicKey.findProgramAddressSync([Buffer.from("amm_config"), indexBuffer], this.raydiumClmmProgramId);
  }

  getRaydiumPoolPda(quoteMint: web3.PublicKey, baseMint: web3.PublicKey): [web3.PublicKey, number] {
    const ammConfig = this.getRaydiumAmmConfigPda()[0];
    const [mint0, mint1] = quoteMint.toBuffer().compare(baseMint.toBuffer()) < 0
      ? [quoteMint, baseMint]
      : [baseMint, quoteMint];
    return web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), ammConfig.toBuffer(), mint0.toBuffer(), mint1.toBuffer()],
      this.raydiumClmmProgramId
    );
  }

  getRaydiumPoolVaultPda(poolPda: web3.PublicKey, mint: web3.PublicKey): [web3.PublicKey, number] {
    return web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool_vault"), poolPda.toBuffer(), mint.toBuffer()],
      this.raydiumClmmProgramId
    );
  }

  getRaydiumObservationStatePda(poolPda: web3.PublicKey): [web3.PublicKey, number] {
    return web3.PublicKey.findProgramAddressSync(
      [Buffer.from("observation"), poolPda.toBuffer()],
      this.raydiumClmmProgramId
    );
  }

  getRaydiumTickArrayBitmapPda(poolPda: web3.PublicKey): [web3.PublicKey, number] {
    return web3.PublicKey.findProgramAddressSync(
      [Buffer.from("tick_array_bitmap"), poolPda.toBuffer()],
      this.raydiumClmmProgramId
    );
  }

  getRaydiumPoolTickArrayBitmapExtensionPda(poolPda: web3.PublicKey): [web3.PublicKey, number] {
    return web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool_tick_array_bitmap_extension"), poolPda.toBuffer()],
      this.raydiumClmmProgramId
    );
  }

  getRaydiumPersonalPositionPda(positionNftMint: web3.PublicKey): [web3.PublicKey, number] {
    return web3.PublicKey.findProgramAddressSync(
      [Buffer.from("position"), positionNftMint.toBuffer()],
      this.raydiumClmmProgramId
    );
  }

  getRaydiumProtocolPositionPda(poolPda: web3.PublicKey, tickLower: number, tickUpper: number): [web3.PublicKey, number] {
    const tickLowerBuffer = Buffer.alloc(4);
    tickLowerBuffer.writeInt32BE(tickLower, 0);
    const tickUpperBuffer = Buffer.alloc(4);
    tickUpperBuffer.writeInt32BE(tickUpper, 0);
    return web3.PublicKey.findProgramAddressSync(
      [Buffer.from("protocol_position"), poolPda.toBuffer(), tickLowerBuffer, tickUpperBuffer],
      this.raydiumClmmProgramId
    );
  }

  getRaydiumTickArrayPda(poolPda: web3.PublicKey, startIndex: number): [web3.PublicKey, number] {
    const startIndexBuffer = Buffer.alloc(4);
    startIndexBuffer.writeInt32BE(startIndex, 0);
    return web3.PublicKey.findProgramAddressSync(
      [Buffer.from("tick_array"), poolPda.toBuffer(), startIndexBuffer],
      this.raydiumClmmProgramId
    );
  }

  getAssociatedTokenAddress(owner: web3.PublicKey, mint: web3.PublicKey): web3.PublicKey {
    return getAssociatedTokenAddressSync(
      mint,
      owner,
      true
    );
  }

  private getIxMethod(primary: string, fallback: string) {
    const methods: any = (this.program as any).methods;
    return methods?.[primary] ?? methods?.[fallback];
  }

  getIncomeDispatcherConfigPda(): [web3.PublicKey, number] {
    return web3.PublicKey.findProgramAddressSync([INCOME_DISPATCHER_SEED_ROOT, Buffer.from("config")], INCOME_DISPATCHER_PROGRAM_ID);
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

  getPda(seeds: (string | Buffer | web3.PublicKey | {
    publicKey?: web3.PublicKey
  } | Uint8Array)[]): [web3.PublicKey, number] {
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

  getLaunchPresetPda(id: number): [web3.PublicKey, number] {
    const one = Buffer.from(Uint8Array.of(id & 0xff));
    return this.getPda(["preset", one]);
  }

  getTokenMetadataConfigPda(launch: web3.PublicKey): [web3.PublicKey, number] {
    return this.getPda(["token_metadata", launch]);
  }

  getLotteryPda(launch: web3.PublicKey): [web3.PublicKey, number] {
    return this.getPda(["lottery", launch]);
  }

  getContributionPda(launch: web3.PublicKey, contributor: web3.PublicKey): [web3.PublicKey, number] {
    return this.getPda(["contributor", launch, contributor]);
  }

  getWithdrawnRangesPda(launch: web3.PublicKey): [web3.PublicKey, number] {
    return this.getPda(["withdrawn", launch]);
  }

  getReallocFundsPda(): [web3.PublicKey, number] {
    return this.getPda(["realloc_funds"]);
  }

  getTicketsClaimedPda(launch: web3.PublicKey, bucket: number, participant: web3.PublicKey): [web3.PublicKey, number] {
    const bucketByte = Buffer.from(Uint8Array.of(bucket & 0xff));
    return this.getPda(["tickets_claimed", launch, bucketByte, participant]);
  }

  async initLaunchFromPresetIx(params: {
    creator: web3.PublicKey;
    presetId: number;
    projectId: BN | number;
    /** Absolute unix timestamp (seconds) when the sale starts. If 0, starts immediately. */
    saleStartTimeTimestamp: number;
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
    tokenMetadataConfig: web3.PublicKey;
    launchPreset: web3.PublicKey;
    lottery: web3.PublicKey;
    withdrawnRanges: web3.PublicKey;
  }> {
    const projectIdLe = (() => {
      if (BN.isBN(params.projectId as any)) {
        return (params.projectId as BN).toArrayLike(Uint8Array as any, "le", 8) as Uint8Array;
      }
      const buf = new Uint8Array(8);
      const view = new DataView(buf.buffer);
      view.setBigUint64(0, BigInt(params.projectId as number), true);
      return buf;
    })();
    const [launchState] = this.getPda(["launch", projectIdLe]);
    const [escrowAuthority] = this.getPda(["escrow_authority", launchState]);
    const [projectCounter] = this.getPda(["project_counter"]);
    const [tokenMetadataConfig] = this.getTokenMetadataConfigPda(launchState);
    const [engineConfig] = this.getPda(["config"]);
    const [launchPreset] = this.getLaunchPresetPda(params.presetId);
    const [lottery] = this.getLotteryPda(launchState);
    const [withdrawnRanges] = this.getWithdrawnRangesPda(launchState);

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
        new BN(params.saleStartTimeTimestamp),
        metaArg
      )
      .accountsStrict({
        creator: params.creator,
        projectCounter,
        launchState,
        escrowAuthority,
        tokenMetadataConfig,
        engineConfig,
        creatorXyberAta,
        treasuryXyberAta,
        launchPreset,
        lottery,
        withdrawnRanges,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    return {
      instruction,
      launchState,
      escrowAuthority,
      projectCounter,
      tokenMetadataConfig,
      launchPreset,
      lottery,
      withdrawnRanges,
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
    teamAllocationBasisPoints: number;
    fundingDurationSeconds: number;
    unlockTimeSec: number;
    creatorPeriodUnlock: BN;
    creatorPeriodSec: number;
    creatorMaxDeposit: BN;
    poolCreationGracePeriodSec: number;
    teamDurationSec: number;
    teamPeriodSec: number;
    withdrawalLimit: number;
    creationFee: BN;
    signerAdmins: web3.PublicKey[];
  }): Promise<{
    instruction: web3.TransactionInstruction;
    launchPreset: web3.PublicKey;
    engineConfig: web3.PublicKey
  }> {
    const [engineConfig] = this.getPda(["config"]);
    const [launchPreset] = this.getLaunchPresetPda(params.id);

    const initParams: any = {
      hardCapLamports: params.hardCapLamports,
      minRaiseLamports: params.minRaiseLamports,
      perWalletCap: params.perWalletCap,
      tauLamports: params.tauLamports,
      baseTotalAllocation: params.baseTotalAllocation,
      baseSaleBasisPoints: params.baseSaleBasisPoints,
      teamAllocationBasisPoints: new BN(params.teamAllocationBasisPoints),
      fundingDurationSeconds: new BN(params.fundingDurationSeconds),
      unlockTimeSec: new BN(params.unlockTimeSec),
      creatorPeriodUnlock: params.creatorPeriodUnlock,
      creatorPeriodSec: new BN(params.creatorPeriodSec),
      creatorMaxDeposit: params.creatorMaxDeposit,
      poolCreationGracePeriodSec: new BN(params.poolCreationGracePeriodSec),
      teamDurationSec: new BN(params.teamDurationSec),
      teamPeriodSec: new BN(params.teamPeriodSec),
      withdrawalLimit: params.withdrawalLimit,
      creationFee: params.creationFee,
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

  async initEngineConfigIx(params: {
    payer: web3.PublicKey;
    treasury: web3.PublicKey;
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
        params.admins.map((pubkey) => ({
          pubkey,
          isSigner: params.signerAdmins.some((s) => s.equals(pubkey)),
          isWritable: false
        }))
      )
      .instruction();
    return { instruction: ix, engineConfig };
  }

  async setSeedIx(params: { launch: web3.PublicKey; payer: web3.PublicKey }): Promise<{
    instruction: web3.TransactionInstruction;
    selectionPda: web3.PublicKey;
  }> {
    const [selectionPda] = this.getPda(["selection", params.launch]);
    const [lottery] = this.getLotteryPda(params.launch);

    const launchState = await this.fetchLaunch(params.launch);
    const presetAddress = launchState.preset;

    const instruction = await this.program.methods
      .setSeed()
      .accountsStrict({
        payer: params.payer,
        launchState: params.launch,
        launchPreset: presetAddress,
        lottery,
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
    contributor: web3.PublicKey;
    amount: BN;
  }): Promise<{
    instruction: web3.TransactionInstruction;
    contribution: web3.PublicKey;
  }> {
    const [contribution] = this.getContributionPda(params.launch, params.contributor);
    const [escrowAuthority] = this.getPda(["escrow_authority", params.launch]);
    const [lottery] = this.getLotteryPda(params.launch);
    const [withdrawnRanges] = this.getWithdrawnRangesPda(params.launch);
    const [reallocFunds] = this.getReallocFundsPda();
    const [launchPreset] = this.getLaunchPresetPda(1); // TODO: get from launch state

    const launchState = await this.fetchLaunch(params.launch);
    const presetAddress = launchState.preset;

    const instruction = await this.program.methods
      .deposit(params.amount)
      .accountsStrict({
        contributor: params.contributor,
        launchState: params.launch,
        launchPreset: presetAddress,
        reallocFunds,
        lottery,
        withdrawnRanges,
        contribution,
        escrowAuthority,
        systemProgram: web3.SystemProgram.programId,
      })
      .instruction();

    return { instruction, contribution };
  }

  async depositTx(params: {
    launch: web3.PublicKey;
    contributor: web3.PublicKey;
    amount: BN;
  }): Promise<{ transaction: web3.Transaction; contribution: web3.PublicKey }> {
    const { instruction, contribution } = await this.depositIx(params);
    const transaction = new web3.Transaction().add(instruction);
    return { transaction, contribution };
  }

  async withdrawIx(params: {
    launch: web3.PublicKey;
    contributor: web3.PublicKey;
    amount: BN;
  }): Promise<{
    instruction: web3.TransactionInstruction;
    contribution: web3.PublicKey;
  }> {
    const [contribution] = this.getContributionPda(params.launch, params.contributor);
    const [escrowAuthority] = this.getPda(["escrow_authority", params.launch]);
    const [lottery] = this.getLotteryPda(params.launch);
    const [withdrawnRanges] = this.getWithdrawnRangesPda(params.launch);
    const [reallocFunds] = this.getReallocFundsPda();

    const launchState = await this.fetchLaunch(params.launch);
    const presetAddress = launchState.preset;

    const instruction = await this.program.methods
      .withdraw(params.amount)
      .accountsStrict({
        contributor: params.contributor,
        contribution,
        launchState: params.launch,
        launchPreset: presetAddress,
        lottery,
        withdrawnRanges,
        reallocFunds,
        escrowAuthority,
        systemProgram: web3.SystemProgram.programId,
      })
      .instruction();

    return { instruction, contribution };
  }

  async withdrawTx(params: {
    launch: web3.PublicKey;
    contributor: web3.PublicKey;
    amount: BN;
  }): Promise<{ transaction: web3.Transaction; contribution: web3.PublicKey }> {
    const { instruction, contribution } = await this.withdrawIx(params);
    const transaction = new web3.Transaction().add(instruction);
    return { transaction, contribution };
  }

  async refundIx(params: {
    launch: web3.PublicKey;
    contributor: web3.PublicKey;
  }): Promise<{
    instruction: web3.TransactionInstruction;
    contribution: web3.PublicKey;
  }> {
    const [contribution] = this.getContributionPda(params.launch, params.contributor);
    const [escrowAuthority] = this.getPda(["escrow_authority", params.launch]);
    const [lottery] = this.getLotteryPda(params.launch);

    const launchState = await this.fetchLaunch(params.launch);
    const presetAddress = launchState.preset;

    const instruction = await this.program.methods
      .refund()
      .accountsStrict({
        contributor: params.contributor,
        launchState: params.launch,
        launchPreset: presetAddress,
        lottery,
        contribution,
        escrowAuthority,
        systemProgram: web3.SystemProgram.programId,
      })
      .instruction();

    return { instruction, contribution };
  }

  async refundTx(params: {
    launch: web3.PublicKey;
    contributor: web3.PublicKey;
  }): Promise<{ transaction: web3.Transaction; contribution: web3.PublicKey }> {
    const { instruction, contribution } = await this.refundIx(params);
    const transaction = new web3.Transaction().add(instruction);
    return { transaction, contribution };
  }

  async claimIx(params: {
    launch: web3.PublicKey;
    baseMint: web3.PublicKey;
    participant: web3.PublicKey;
    bucket: number;
  }): Promise<{ instruction: web3.TransactionInstruction; participantAta: web3.PublicKey }> {
    const [contribution] = this.getContributionPda(params.launch, params.participant);
    const [escrowAuthority] = this.getPda(["escrow_authority", params.launch]);
    const [lottery] = this.getLotteryPda(params.launch);
    const [ticketsClaimed] = this.getTicketsClaimedPda(params.launch, params.bucket, params.participant);

    const launchState = await this.fetchLaunch(params.launch);
    const presetAddress = launchState.preset;

    const participantAta = getAssociatedTokenAddressSync(params.baseMint, params.participant, true);
    const bucketArg = params.bucket === 0 ? { sale: {} } : { team: {} };

    const instruction = await this.program.methods
      .claim(bucketArg as any)
      .accountsStrict({
        participant: params.participant,
        launchState: params.launch,
        launchPreset: presetAddress,
        lottery,
        contribution,
        ticketsClaimed,
        baseMint: params.baseMint,
        escrowAuthority,
        baseEscrowAta: getAssociatedTokenAddressSync(params.baseMint, escrowAuthority, true),
        participantAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
      })
      .instruction();

    return { instruction, participantAta };
  }

  async claimTx(params: {
    launch: web3.PublicKey;
    baseMint: web3.PublicKey;
    participant: web3.PublicKey;
    bucket: number;
  }): Promise<{ transaction: web3.Transaction; participantAta: web3.PublicKey }> {
    const { instruction, participantAta } = await this.claimIx(params);
    const transaction = new web3.Transaction().add(instruction);
    return { transaction, participantAta };
  }

  async fetchContribution(launch: web3.PublicKey, contributor: web3.PublicKey) {
    const [pda] = this.getContributionPda(launch, contributor);
    return this.program.account.contribution.fetch(pda);
  }

  async fetchLottery(launch: web3.PublicKey) {
    const [pda] = this.getLotteryPda(launch);
    return this.program.account.lottery.fetch(pda);
  }

  // Legacy aliases for backwards compatibility
  async claimRefundIx(params: { launch: web3.PublicKey; user: web3.PublicKey }) {
    return this.refundIx({ launch: params.launch, contributor: params.user });
  }

  async claimRefundTx(params: { launch: web3.PublicKey; user: web3.PublicKey }) {
    return this.refundTx({ launch: params.launch, contributor: params.user });
  }

  async fetchLaunch(launch: web3.PublicKey) {
    return this.program.account.launchState.fetch(launch);
  }

  async fetchProjectCounter() {
    const [pda] = this.getPda(["project_counter"]);
    return this.program.account.projectCounter.fetch(pda);
  }

  async fetchLaunchPreset(id: number) {
    const [pda] = this.getLaunchPresetPda(id);
    return this.program.account.launchPreset.fetch(pda);
  }

  async preparePoolCreationTx(params: {
    payer: web3.PublicKey;
    launch: web3.PublicKey;
    computeUnits?: number;
    computeUnitPriceMicroLamports?: number;
  }): Promise<{
    transaction: web3.Transaction;
  }> {
    const [lottery] = this.getLotteryPda(params.launch);
    const [withdrawnRanges] = this.getWithdrawnRangesPda(params.launch);
    const SLOT_HASHES_SYSVAR = new web3.PublicKey("SysvarS1otHashes111111111111111111111111111");

    const launchState = await this.fetchLaunch(params.launch);
    const presetAddress = launchState.preset;

    const ix = await this.program.methods
      .preparePoolCreation()
      .accountsStrict({
        payer: params.payer,
        launchState: params.launch,
        launchPreset: presetAddress,
        lottery,
        withdrawnRanges,
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

    return { transaction };
  }

  async createClmmPoolTx(params: {
    payer: web3.PublicKey;
    launch: web3.PublicKey;
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
    quoteVault: web3.PublicKey;
    baseVault: web3.PublicKey;
  }> {
    const [escrowAuthority] = this.getPda(["escrow_authority", params.launch]);

    const baseMintKeypair = web3.Keypair.generate();
    const baseMint = baseMintKeypair.publicKey;

    const [raydiumPoolState] = this.getRaydiumPoolPda(WSOL_MINT, baseMint);
    const [observationState] = this.getRaydiumObservationStatePda(raydiumPoolState);
    const [quoteVault] = this.getRaydiumPoolVaultPda(raydiumPoolState, WSOL_MINT);
    const [baseVault] = this.getRaydiumPoolVaultPda(raydiumPoolState, baseMint);
    const [tickArrayBitmap] = this.getRaydiumPoolTickArrayBitmapExtensionPda(raydiumPoolState);

    const baseTokenAta = getAssociatedTokenAddressSync(
      baseMint,
      escrowAuthority,
      true // allowOwnerOffCurve for PDA
    );


    const raydiumAmmConfig = this.getRaydiumAmmConfigPda()[0];
    const [lottery] = this.getLotteryPda(params.launch);

    const launchState = await this.fetchLaunch(params.launch);
    const presetAddress = launchState.preset;

    const createClmmPoolIx = await (this.program.methods as any)
      .createClmmPool()
      .accountsStrict({
        payer: params.payer,
        launchState: params.launch,
        launchPreset: presetAddress,
        lottery,
        escrowAuthority: escrowAuthority,
        baseEscrowAta: baseTokenAta,
        baseMint: baseMint,
        quoteMint: WSOL_MINT,
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
    transaction
      .add(computeBudgetIx)
      .add(createClmmPoolIx);

    return {
      transaction,
      signers: [baseMintKeypair],
      baseMint: baseMint,
      baseTokenAta,
      poolState: raydiumPoolState,
      tickArrayBitmap,
      quoteVault,
      baseVault,
    };
  }

  async addClmmLiquidityIx(params: {
    payer: web3.PublicKey;
    launch: web3.PublicKey;
    baseMint: web3.PublicKey;
  }): Promise<{
    instruction: web3.TransactionInstruction;
    signers: web3.Keypair[];
    quoteVault: web3.PublicKey;
    baseVault: web3.PublicKey;
    poolState: web3.PublicKey;
    raydiumPositionNftMint: web3.PublicKey;
    raydiumPositionNftAccount: web3.PublicKey;
    personalPosition: web3.PublicKey;
    protocolPosition: web3.PublicKey;
    quoteEscrowAta: web3.PublicKey;
    ammConfig: web3.PublicKey;
    tickArrayLower: web3.PublicKey;
    tickArrayUpper: web3.PublicKey;
    bitmapExtension: web3.PublicKey;
    escrowAuthority: web3.PublicKey;
    tickArrayBitmap: web3.PublicKey;
  }> {
    const [escrowAuthority] = this.getPda(["escrow_authority", params.launch]);

    const baseTokenAta = getAssociatedTokenAddressSync(
      params.baseMint,
      escrowAuthority,
      true
    );

    const ammConfigForAdd = this.getRaydiumAmmConfigPda()[0];
    const clmmProgram = this.getRaydiumClmmProgramId();

    const [raydiumPoolPda] = this.getRaydiumPoolPda(WSOL_MINT, params.baseMint);
    const [bitmapExtension] = this.getRaydiumPoolTickArrayBitmapExtensionPda(raydiumPoolPda);
    const [tickArrayBitmap] = this.getRaydiumTickArrayBitmapPda(raydiumPoolPda);
    const [quoteVault] = this.getRaydiumPoolVaultPda(raydiumPoolPda, WSOL_MINT);
    const [baseVault] = this.getRaydiumPoolVaultPda(raydiumPoolPda, params.baseMint);

    const quoteEscrowAta = getAssociatedTokenAddressSync(
      WSOL_MINT,
      escrowAuthority,
      true
    );

    const raydiumPositionNftMint = web3.Keypair.generate();
    const raydiumPositionNftAccount = getAssociatedTokenAddressSync(
      raydiumPositionNftMint.publicKey,
      escrowAuthority,
      true,
      TOKEN_2022_PROGRAM_ID
    );

    const [personalPosition] = this.getRaydiumPersonalPositionPda(raydiumPositionNftMint.publicKey);

    const range = await this.getLiquidityRange({
      launch: params.launch,
      baseMint: params.baseMint,
      quoteMint: WSOL_MINT,
      raydiumQuoteVault: quoteVault,
      raydiumBaseVault: baseVault,
    });
    const tickLowerIndex = range.tickArrayLower;
    const tickUpperIndex = range.tickArrayUpper;
    const tickArrayLowerStartIndex = range.tickArrayLowerStartIndex;
    const tickArrayUpperStartIndex = range.tickArrayUpperStartIndex;

    const [protocolPosition] = this.getRaydiumProtocolPositionPda(raydiumPoolPda, tickLowerIndex, tickUpperIndex);
    const [tickArrayLower] = this.getRaydiumTickArrayPda(raydiumPoolPda, tickArrayLowerStartIndex);
    const [tickArrayUpper] = this.getRaydiumTickArrayPda(raydiumPoolPda, tickArrayUpperStartIndex);

    const [lottery] = this.getLotteryPda(params.launch);

    const launchState = await this.fetchLaunch(params.launch);
    const presetAddress = launchState.preset;

    const instruction = await this.program.methods
      .addClmmLiquidity()
      .accountsStrict({
        payer: params.payer,
        launchState: params.launch,
        launchPreset: presetAddress,
        lottery,
        baseMint: params.baseMint,
        escrowAuthority: escrowAuthority,
        baseEscrowAta: baseTokenAta,
        quoteMint: WSOL_MINT,
        quoteEscrowAta: quoteEscrowAta,
        raydiumAmmConfig: ammConfigForAdd,
        raydiumPoolState: raydiumPoolPda,
        raydiumQuoteVault: quoteVault,
        raydiumBaseVault: baseVault,
        raydiumPositionNftMint: raydiumPositionNftMint.publicKey,
        raydiumPositionNftAccount: raydiumPositionNftAccount,
        raydiumPersonalPosition: personalPosition,
        raydiumProtocolPosition: protocolPosition,
        raydiumTickArrayLower: tickArrayLower,
        raydiumTickArrayUpper: tickArrayUpper,
        token2022Program: TOKEN_2022_PROGRAM_ID,
        raydiumProgram: clmmProgram,
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

    return {
      instruction,
      signers: [raydiumPositionNftMint],
      quoteVault,
      baseVault,
      poolState: raydiumPoolPda,
      raydiumPositionNftMint: raydiumPositionNftMint.publicKey,
      raydiumPositionNftAccount,
      personalPosition,
      protocolPosition,
      quoteEscrowAta,
      ammConfig: ammConfigForAdd,
      tickArrayLower,
      tickArrayUpper,
      bitmapExtension,
      tickArrayBitmap,
      escrowAuthority,
    };
  }

  async addClmmLiquidityTx(params: {
    payer: web3.PublicKey;
    launch: web3.PublicKey;
    baseMint: web3.PublicKey;
    provider: any;
  }): Promise<{
    transaction: web3.Transaction;
    signers: web3.Keypair[];
    quoteVault: web3.PublicKey;
    baseVault: web3.PublicKey;
    poolState: web3.PublicKey;
    raydiumPositionNftMint: web3.PublicKey;
    raydiumPositionNftAccount: web3.PublicKey;
    personalPosition: web3.PublicKey;
    protocolPosition: web3.PublicKey;
    quoteEscrowAta: web3.PublicKey;
    ammConfig: web3.PublicKey;
    tickArrayLower: web3.PublicKey;
    tickArrayUpper: web3.PublicKey;
    bitmapExtension: web3.PublicKey;
    escrowAuthority: web3.PublicKey;
    tickArrayBitmap: web3.PublicKey;
  }> {
    const { instruction, ...rest } = await this.addClmmLiquidityIx(params);

    const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({
      units: 1_400_000,
    });

    const transaction = new web3.Transaction()
      .add(computeBudgetIx)
      .add(instruction);

    return { transaction, ...rest };
  }

  async getLiquidityRange(params: {
    launch: web3.PublicKey;
    baseMint: web3.PublicKey;
    quoteMint: web3.PublicKey;
    raydiumQuoteVault: web3.PublicKey;
    raydiumBaseVault: web3.PublicKey;
  }): Promise<{
    tickArrayLower: number;
    tickArrayUpper: number;
    tickArrayLowerStartIndex: number;
    tickArrayUpperStartIndex: number;
  }> {
    const [ammConfig] = this.getRaydiumAmmConfigPda();

    try {
      const res = await (this.program.methods as any)
        .getLiquidityRange()
        .accountsStrict({
          launchState: params.launch,
          baseMint: params.baseMint,
          quoteMint: params.quoteMint,
          raydiumQuoteVault: params.raydiumQuoteVault,
          raydiumBaseVault: params.raydiumBaseVault,
          quoteTokenProgram: TOKEN_PROGRAM_ID,
          baseTokenProgram: TOKEN_PROGRAM_ID,
          raydiumAmmConfig: ammConfig,
        })
        .view();
      return res as any;
    } catch (_) {
      const tx = await (this.program.methods as any)
        .getLiquidityRange()
        .accountsStrict({
          launchState: params.launch,
          baseMint: params.baseMint,
          quoteMint: params.quoteMint,
          raydiumQuoteVault: params.raydiumQuoteVault,
          raydiumBaseVault: params.raydiumBaseVault,
          quoteTokenProgram: TOKEN_PROGRAM_ID,
          baseTokenProgram: TOKEN_PROGRAM_ID,
          raydiumAmmConfig: ammConfig,
        })
        .transaction();

      const providerAny: any = this.program.provider as any;
      const conn: any = providerAny.connection;

      // Determine a suitable fee payer for simulation:
      // - Prefer wallet.payer (LiteSVM / Keypair wallet)
      // - Fallback to wallet.publicKey (browser/adapters), no signing required with sigVerify=false
      const walletPayerPubkey: web3.PublicKey | undefined =
        providerAny?.wallet?.payer?.publicKey ?? providerAny?.wallet?.publicKey;
      if (!walletPayerPubkey) throw new Error("Simulation: missing wallet publicKey for feePayer");
      tx.feePayer = walletPayerPubkey;

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

      // Ensure the tx is signed before simulation when possible (LiteSVM requires signatures)
      try {
        if (providerAny.wallet?.payer) {
          tx.partialSign(providerAny.wallet.payer);
        }
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
