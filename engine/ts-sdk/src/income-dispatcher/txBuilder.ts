import { BN, Program, web3 } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import type { IncomeDispatcher as IncomeDispatcherIDL } from "../../idl/income_dispatcher";
import EngineIDL from "../../idl/engine.json";
import { getConstantRaw } from "../utils";
import { ComputeBudgetProgram } from "@solana/web3.js";

const SEED_ROOT = Buffer.from("income-dispatcher");
const MEMO_PROGRAM_ID = new web3.PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const RAYDIUM_CLMM_PROGRAM_ID = new web3.PublicKey(getConstantRaw("RAYDIUM_CLMM_PROGRAM_ID", EngineIDL as any));

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

  getIncomeConfigPda(projectId: BN): [web3.PublicKey, number] {
    return this.getPda(["income_config", projectId]);
  }

  getProjectAuthorityPda(projectId: BN): [web3.PublicKey, number] {
    return this.getPda(["project_authority", projectId]);
  }

  getNoncePda(projectId: BN, recipient: web3.PublicKey): [web3.PublicKey, number] {
    return this.getPda(["nonce", projectId, recipient]);
  }

  async harvestPoolIx(params: {
    payer: web3.PublicKey;
    launchState: web3.PublicKey;
    projectId: BN;
    baseMint: web3.PublicKey;
    quoteMint: web3.PublicKey;
    engineProgram: web3.PublicKey;
    escrowAuthority: web3.PublicKey;
    positionNftMint: web3.PublicKey;
    positionNftAccount: web3.PublicKey;
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
    const [incomeConfig] = this.getIncomeConfigPda(params.projectId);
    const [projectAuthority] = this.getProjectAuthorityPda(params.projectId);

    const quoteVault = getAssociatedTokenAddressSync(params.quoteMint, projectAuthority, true);
    const baseVault = getAssociatedTokenAddressSync(params.baseMint, projectAuthority, true);

    return this.program.methods
      .harvestPool(params.projectId)
      .accountsStrict({
        payer: params.payer,
        config,
        launchState: params.launchState,
        incomeConfig,
        projectAuthority,
        quoteMint: params.quoteMint,
        baseMint: params.baseMint,
        quoteVault,
        baseVault,
        engineProgram: params.engineProgram,
        raydiumProgram: RAYDIUM_CLMM_PROGRAM_ID,
        escrowAuthority: params.escrowAuthority,
        positionNftMint: params.positionNftMint,
        positionNftAccount: params.positionNftAccount,
        personalPosition: params.personalPosition,
        raydiumPoolState: params.raydiumPoolState,
        protocolPosition: params.protocolPosition,
        tokenVault0: params.tokenVault0,
        tokenVault1: params.tokenVault1,
        tickArrayLower: params.tickArrayLower,
        tickArrayUpper: params.tickArrayUpper,
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
    positionNftMint: web3.PublicKey;
    positionNftAccount: web3.PublicKey;
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
    return new web3.Transaction().add(computeBudgetIx).add(ix);
  }
}
