import { BN, Program, web3 } from "@coral-xyz/anchor";
import { IncomeDispatcher as IncomeDispatcherIDL } from "../idl/income_dispatcher";
import { getConstant } from "./utils";

export class TxBuilder {
  private program: Program<IncomeDispatcherIDL>;
  private seedRoot: Buffer;

  constructor(program: Program<IncomeDispatcherIDL>) {
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

  getConfigPda(): [web3.PublicKey, number] {
    return this.getPda(["config"]);
  }

  getProjectPoolPda(projectId: Buffer): [web3.PublicKey, number] {
    return this.getPda(["project_pool", projectId]);
  }

  async initializeIx(args: {
    admin: web3.PublicKey;
    platformWallet: web3.PublicKey;
    incomeSource: web3.PublicKey;
  }): Promise<{
    instruction: web3.TransactionInstruction;
    config: web3.PublicKey;
  }> {
    const [config] = this.getPda(["config"]);

    const instruction = await this.program.methods
      .initialize(args.platformWallet, args.incomeSource)
      .accounts({
        admin: args.admin,
        config,
        systemProgram: web3.SystemProgram.programId,
      })
      .instruction();

    return { instruction, config };
  }

  async initializeTx(args: {
    admin: web3.PublicKey;
    platformWallet: web3.PublicKey;
    incomeSource: web3.PublicKey;
  }): Promise<{
    transaction: web3.Transaction;
    config: web3.PublicKey;
  }> {
    const { instruction, config } = await this.initializeIx(args);
    const transaction = new web3.Transaction().add(instruction);
    return { transaction, config };
  }

  async updatePlatformWalletIx(args: {
    admin: web3.PublicKey;
    newPlatformWallet: web3.PublicKey;
  }): Promise<{
    instruction: web3.TransactionInstruction;
    config: web3.PublicKey;
  }> {
    const [config] = this.getPda(["config"]);

    const instruction = await this.program.methods
      .updatePlatformWallet(args.newPlatformWallet)
      .accounts({
        admin: args.admin,
        config,
      })
      .instruction();

    return { instruction, config };
  }

  async updatePlatformWalletTx(args: {
    admin: web3.PublicKey;
    newPlatformWallet: web3.PublicKey;
  }): Promise<{
    transaction: web3.Transaction;
    config: web3.PublicKey;
  }> {
    const { instruction, config } = await this.updatePlatformWalletIx(args);
    const transaction = new web3.Transaction().add(instruction);
    return { transaction, config };
  }
}
