import { BN, Program, web3 } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import type { IncomeDispatcher as IncomeDispatcherIDL } from "../../idl/income_dispatcher";
import IncomeDispatcherIDLJson from "../../idl/income_dispatcher.json";
import EngineIDL from "../../idl/engine.json";
import { getConstant, getConstantRaw, getEnumVariants } from "../utils";
import { ComputeBudgetProgram } from "@solana/web3.js";

const SEED_ROOT = Buffer.from(getConstant("DISPATCHER_SEED_ROOT", IncomeDispatcherIDLJson as any));
const MEMO_PROGRAM_ID = new web3.PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const RAYDIUM_CLMM_PROGRAM_ID = new web3.PublicKey(getConstantRaw("RAYDIUM_CLMM_PROGRAM_ID", EngineIDL as any));

export const Role = getEnumVariants("Role", IncomeDispatcherIDLJson as any);
export type RoleType = number;

export class TxBuilder {
  private program: Program<IncomeDispatcherIDL>;
  private seedRoot: Buffer;

  constructor(program: Program<IncomeDispatcherIDL>) {
    this.program = program;
    this.seedRoot = SEED_ROOT;
  }

  getPda(seeds: (string | BN | Buffer | web3.PublicKey | Uint8Array | number | bigint)[]): [web3.PublicKey, number] {
    const toSeedBuffer = (seed: string | BN | Buffer | web3.PublicKey | Uint8Array | number | bigint): Buffer => {
      if (typeof seed === "string") return Buffer.from(seed);
      if (typeof seed === "number") {
        if (seed <= 255) return Buffer.from([seed]);
        const bn = new BN(seed);
        return Buffer.from(bn.toArray("be", 8));
      }
      if (typeof seed === "bigint") {
        const bn = new BN(seed.toString());
        return Buffer.from(bn.toArray("be", 8));
      }
      if (BN.isBN(seed)) return Buffer.from(seed.toArray("be", 8));
      if (seed && typeof seed === "object" && "toNumber" in seed && typeof (seed as any).toNumber === "function") {
        const bn = new BN((seed as any).toString());
        return Buffer.from(bn.toArray("be", 8));
      }
      if (Buffer.isBuffer(seed)) return seed;
      if (seed instanceof Uint8Array) return Buffer.from(seed);
      if (seed instanceof web3.PublicKey) return seed.toBuffer();
      if (seed && typeof seed === "object" && "toBuffer" in seed && typeof (seed as any).toBuffer === "function") {
        return (seed as any).toBuffer();
      }
      throw new TypeError("Unsupported PDA seed type");
    };

    const seedBuffers = [this.seedRoot, ...seeds.map(toSeedBuffer)];
    return web3.PublicKey.findProgramAddressSync(seedBuffers, this.program.programId);
  }

  getConfigPda(): [web3.PublicKey, number] {
    return this.getPda(["config"]);
  }

  getTotalsPda(role: RoleType, mint: web3.PublicKey): [web3.PublicKey, number] {
    return this.getPda(["totals", role, mint]);
  }

  getProjectTotalsPda(projectId: BN, role: RoleType, mint: web3.PublicKey): [web3.PublicKey, number] {
    return this.getPda(["totals", projectId, role, mint]);
  }

  getAuthorityPda(): [web3.PublicKey, number] {
    return this.getPda(["authority"]);
  }

  getNoncePda(projectId: BN, recipient: web3.PublicKey): [web3.PublicKey, number] {
    return this.getPda(["nonce", projectId, recipient]);
  }

  getHarvestAltAddresses(projectId: BN, baseMint: web3.PublicKey, quoteMint: web3.PublicKey): web3.PublicKey[] {
    return [
      this.getTotalsPda(Role.Treasure, baseMint)[0],
      this.getTotalsPda(Role.Treasure, quoteMint)[0],
      this.getTotalsPda(Role.BuyBack, baseMint)[0],
      this.getTotalsPda(Role.BuyBack, quoteMint)[0],
      this.getProjectTotalsPda(projectId, Role.Creator, baseMint)[0],
      this.getProjectTotalsPda(projectId, Role.Creator, quoteMint)[0],
      this.getProjectTotalsPda(projectId, Role.Community, baseMint)[0],
      this.getProjectTotalsPda(projectId, Role.Community, quoteMint)[0],
    ];
  }

  async claimSingleIx(params: {
    role: { creator: {} } | { community: {} };
    projectId: BN;
    launchState: web3.PublicKey;
    recipient: web3.PublicKey;
    mint: web3.PublicKey;
    nonce: BN;
    amount?: BN;
    remainingAccounts?: { pubkey: web3.PublicKey; isWritable: boolean; isSigner: boolean }[];
  }): Promise<web3.TransactionInstruction> {
    const [config] = this.getConfigPda();
    const [authority] = this.getAuthorityPda();
    const [noncePda] = this.getNoncePda(params.projectId, params.recipient);

    const roleValue = "creator" in params.role ? Role.Creator : Role.Community;
    const [totals] = this.getProjectTotalsPda(params.projectId, roleValue, params.mint);

    const sourceVault = getAssociatedTokenAddressSync(params.mint, authority, true);
    const recipientAta = getAssociatedTokenAddressSync(params.mint, params.recipient, false);

    return this.program.methods
      .claim(params.projectId, params.role, params.nonce, params.amount ?? null)
      .accountsStrict({
        recipient: params.recipient,
        config,
        launchState: params.launchState,
        totals,
        authority,
        nonce: noncePda,
        mint: params.mint,
        sourceVault,
        recipientAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
      })
      .remainingAccounts(params.remainingAccounts || [])
      .instruction();
  }

  async claimIx(params: {
    role: { creator: {} } | { community: {} };
    projectId: BN;
    launchState: web3.PublicKey;
    recipient: web3.PublicKey;
    baseMint: web3.PublicKey;
    quoteMint: web3.PublicKey;
    nonce: BN;
    remainingAccounts?: { pubkey: web3.PublicKey; isWritable: boolean; isSigner: boolean }[];
  }): Promise<web3.TransactionInstruction[]> {
    const baseIx = await this.claimSingleIx({
      role: params.role,
      projectId: params.projectId,
      launchState: params.launchState,
      recipient: params.recipient,
      mint: params.baseMint,
      nonce: params.nonce,
      remainingAccounts: params.remainingAccounts,
    });

    const quoteIx = await this.claimSingleIx({
      role: params.role,
      projectId: params.projectId,
      launchState: params.launchState,
      recipient: params.recipient,
      mint: params.quoteMint,
      nonce: params.nonce.add(new BN(1)),
      remainingAccounts: params.remainingAccounts,
    });

    return [baseIx, quoteIx];
  }

  async claimTx(params: {
    role: { creator: {} } | { community: {} };
    projectId: BN;
    launchState: web3.PublicKey;
    recipient: web3.PublicKey;
    baseMint: web3.PublicKey;
    quoteMint: web3.PublicKey;
    nonce: BN;
    remainingAccounts?: { pubkey: web3.PublicKey; isWritable: boolean; isSigner: boolean }[];
  }): Promise<web3.Transaction> {
    const instructions = await this.claimIx(params);
    return new web3.Transaction().add(...instructions);
  }

  async harvestPoolIx(params: {
    payer: web3.PublicKey;
    launchState: web3.PublicKey;
    projectId: BN;
    baseMint: web3.PublicKey;
    quoteMint: web3.PublicKey;
    engineProgram: web3.PublicKey;
    escrowAuthority: web3.PublicKey;
    raydiumPositionNftMint: web3.PublicKey;
    raydiumPositionNftAccount: web3.PublicKey;
    personalPosition: web3.PublicKey;
    raydiumPoolState: web3.PublicKey;
    protocolPosition: web3.PublicKey;
    tokenVault0: web3.PublicKey;
    tokenVault1: web3.PublicKey;
    tickArrayLower: web3.PublicKey;
    tickArrayUpper: web3.PublicKey;
    remainingAccounts?: { pubkey: web3.PublicKey; isWritable: boolean; isSigner: boolean }[];
  }): Promise<web3.TransactionInstruction> {
    const [config] = this.getConfigPda();
    const [authority] = this.getAuthorityPda();

    const [platformTreasureBase] = this.getTotalsPda(Role.Treasure, params.baseMint);
    const [platformTreasureQuote] = this.getTotalsPda(Role.Treasure, params.quoteMint);
    const [platformBuybackBase] = this.getTotalsPda(Role.BuyBack, params.baseMint);
    const [platformBuybackQuote] = this.getTotalsPda(Role.BuyBack, params.quoteMint);
    const [projectCreatorBase] = this.getProjectTotalsPda(params.projectId, Role.Creator, params.baseMint);
    const [projectCreatorQuote] = this.getProjectTotalsPda(params.projectId, Role.Creator, params.quoteMint);
    const [projectCommunityBase] = this.getProjectTotalsPda(params.projectId, Role.Community, params.baseMint);
    const [projectCommunityQuote] = this.getProjectTotalsPda(params.projectId, Role.Community, params.quoteMint);

    const quoteVault = getAssociatedTokenAddressSync(params.quoteMint, authority, true);
    const baseVault = getAssociatedTokenAddressSync(params.baseMint, authority, true);

    return this.program.methods
      .harvestPool(params.projectId)
      .accountsStrict({
        payer: params.payer,
        config,
        launchState: params.launchState,
        quoteMint: params.quoteMint,
        baseMint: params.baseMint,
        platformTreasureBase,
        platformTreasureQuote,
        platformBuybackBase,
        platformBuybackQuote,
        projectCreatorBase,
        projectCreatorQuote,
        projectCommunityBase,
        projectCommunityQuote,
        authority,
        quoteVault,
        baseVault,
        escrowAuthority: params.escrowAuthority,
        raydiumPositionNftMint: params.raydiumPositionNftMint,
        raydiumPositionNftAccount: params.raydiumPositionNftAccount,
        personalPosition: params.personalPosition,
        raydiumPoolState: params.raydiumPoolState,
        protocolPosition: params.protocolPosition,
        tokenVault0: params.tokenVault0,
        tokenVault1: params.tokenVault1,
        tickArrayLower: params.tickArrayLower,
        tickArrayUpper: params.tickArrayUpper,
        engineProgram: params.engineProgram,
        raydiumProgram: RAYDIUM_CLMM_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenProgram2022: TOKEN_2022_PROGRAM_ID,
        memoProgram: MEMO_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
      })
      .remainingAccounts(params.remainingAccounts || [])
      .instruction();
  }

  async harvestPoolTx(params: {
    payer: web3.PublicKey;
    launchState: web3.PublicKey;
    projectId: BN;
    baseMint: web3.PublicKey;
    quoteMint: web3.PublicKey;
    engineProgram: web3.PublicKey;
    escrowAuthority: web3.PublicKey;
    raydiumPositionNftMint: web3.PublicKey;
    raydiumPositionNftAccount: web3.PublicKey;
    personalPosition: web3.PublicKey;
    raydiumPoolState: web3.PublicKey;
    protocolPosition: web3.PublicKey;
    tokenVault0: web3.PublicKey;
    tokenVault1: web3.PublicKey;
    tickArrayLower: web3.PublicKey;
    tickArrayUpper: web3.PublicKey;
    remainingAccounts?: { pubkey: web3.PublicKey; isWritable: boolean; isSigner: boolean }[];
  }): Promise<web3.Transaction> {
    const ix = await this.harvestPoolIx(params);
    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
    const heapFrameIx = ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 });
    return new web3.Transaction().add(computeBudgetIx).add(heapFrameIx).add(ix);
  }

  async harvestPoolV0Tx(params: {
    payer: web3.PublicKey;
    launchState: web3.PublicKey;
    projectId: BN;
    baseMint: web3.PublicKey;
    quoteMint: web3.PublicKey;
    engineProgram: web3.PublicKey;
    escrowAuthority: web3.PublicKey;
    raydiumPositionNftMint: web3.PublicKey;
    raydiumPositionNftAccount: web3.PublicKey;
    personalPosition: web3.PublicKey;
    raydiumPoolState: web3.PublicKey;
    protocolPosition: web3.PublicKey;
    tokenVault0: web3.PublicKey;
    tokenVault1: web3.PublicKey;
    tickArrayLower: web3.PublicKey;
    tickArrayUpper: web3.PublicKey;
    remainingAccounts?: { pubkey: web3.PublicKey; isWritable: boolean; isSigner: boolean }[];
    recentBlockhash: string;
    addressLookupTableAccounts: web3.AddressLookupTableAccount[];
  }): Promise<web3.VersionedTransaction> {
    const ix = await this.harvestPoolIx(params);
    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
    const heapFrameIx = ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 });

    const message = new web3.TransactionMessage({
      payerKey: params.payer,
      recentBlockhash: params.recentBlockhash,
      instructions: [computeBudgetIx, heapFrameIx, ix],
    }).compileToV0Message(params.addressLookupTableAccounts);

    return new web3.VersionedTransaction(message);
  }
}
