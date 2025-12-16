import { FlowStep } from "../step";
import type { FlowContext } from "../types";
import { SystemProgram, Transaction, PublicKey, Keypair } from "@solana/web3.js";
import { createAssociatedTokenAccountInstruction, createInitializeMintInstruction, createMintToInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";

export class SetupStep extends FlowStep {
  constructor() {
    super("[1/10] Setup & Config");
  }

  async execute(context: FlowContext): Promise<void> {
    const { config, addLog, provider, admin, adminSigners, sdk, program } = context;
    const LAMPORTS_PER_SOL = 1_000_000_000;

    // --- Simulation Parameters ---
    config.creatorInitialDepositLamports = 8 * LAMPORTS_PER_SOL;

    addLog(`\n--- Using Simulation Parameters ---`);
    addLog(`   -> Base total supply (tokens): ${config.baseTotalAllocationTokens}`);
    addLog(`   -> Sale Allocation (bps): ${String((config as any).saleBasisPoints ?? 0)}`);
    addLog(`   -> LP Allocation (bps): ${String((config as any).lpBasisPoints ?? 0)}`);
    addLog(`   -> Team Allocation (bps of base_total): ${(config as any).teamAllocationBasisPoints}`);
    addLog(`   -> Creator Deposit: ${config.creatorInitialDepositLamports / LAMPORTS_PER_SOL} SOL`);
    addLog(`------------------------------------`);

    // Admin Balance Check
    let adminBalance: number;
    try {
      adminBalance = await provider.connection.getBalance(admin.publicKey);
    } catch (error) {
      adminBalance = 10 * 1e9; // Fallback
      addLog(`Using fallback admin balance: ${adminBalance / 1e9} SOL`);
    }

    const MIN_BALANCE_FOR_FEES = 500000000; // 0.5 SOL
    if (adminBalance < MIN_BALANCE_FOR_FEES) {
      throw new Error(`Admin wallet balance is too low (${(adminBalance / 1e9).toFixed(2)} SOL). Need ${MIN_BALANCE_FOR_FEES / 1e9} SOL.`);
    }

    // Adjust Creator Deposit based on balance
    const availableForCreatorDeposit = adminBalance - MIN_BALANCE_FOR_FEES;
    const maxAffordable = Math.max(0, availableForCreatorDeposit);
    const desired = Math.min(config.creatorInitialDepositLamports, maxAffordable);
    let adjustedCreatorDeposit = Math.floor(desired / config.tauLamports) * config.tauLamports;

    if (adjustedCreatorDeposit < config.creatorInitialDepositLamports) {
        addLog(`Adjusting creator deposit to τ-multiple: ${(config.creatorInitialDepositLamports / 1e9).toFixed(2)} -> ${(adjustedCreatorDeposit / 1e9).toFixed(2)} SOL`);
    }
     if (adjustedCreatorDeposit === 0 && maxAffordable >= config.tauLamports) {
      adjustedCreatorDeposit = Math.floor(maxAffordable / config.tauLamports) * config.tauLamports;
      adjustedCreatorDeposit = Math.max(config.tauLamports, adjustedCreatorDeposit);
      addLog(`Bumping creator deposit to at least 1τ: ${(adjustedCreatorDeposit / 1e9).toFixed(2)} SOL`);
    }
    context.userFundingCost += config.creatorInitialDepositLamports - adjustedCreatorDeposit;
    config.creatorInitialDepositLamports = adjustedCreatorDeposit;

    // Prepare Engine Config
    addLog(`[1/10] Preparing EngineConfig and XYBER fee accounts...`);
    const [engineConfigPda] = sdk.getConfigPda();
    let engineConfig: any | null = null;
    try {
      engineConfig = await (program.account as any).engineConfig.fetch(engineConfigPda);
    } catch (_) {
      engineConfig = null;
    }
    if (!engineConfig) {
      throw new Error("EngineConfig not initialized. Run migration to set treasury, fee and admins.");
    }

    const treasuryPubkey: PublicKey = engineConfig.treasury as PublicKey;
    const creationFeeU64: number = Number(engineConfig.creationFee ?? 0);
    const threshold: number = Number(engineConfig.threshold ?? 1);

    const engineXyberMintStr = String(engineConfig.xyberMint ?? "");
    const engineXyberMintDefault = /^0+$/i.test(engineXyberMintStr.replace(/[^0-9a-f]/gi, ""));
    let xyberMint: PublicKey;

    if (engineXyberMintDefault || !engineConfig.xyberMint) {
      throw new Error("EngineConfig.xyberMint is not set.");
    }
    xyberMint = engineConfig.xyberMint as PublicKey;
    addLog(`   -> Using XYBER mint from config: ${xyberMint.toBase58()}`);

    const mintInfo = await provider.connection.getAccountInfo(xyberMint);
    if (!mintInfo) {
      addLog(`   -> XYBER mint account is missing. Attempting local provision...`);
      try {
        const newMint = Keypair.generate();
        const lamports = await provider.connection.getMinimumBalanceForRentExemption(82);
        const tx = new Transaction()
          .add(SystemProgram.createAccount({ fromPubkey: admin.publicKey, newAccountPubkey: newMint.publicKey, space: 82, lamports, programId: TOKEN_PROGRAM_ID }))
          .add(createInitializeMintInstruction(newMint.publicKey, 9, admin.publicKey, null));
        await provider.sendAndConfirm!(tx, [newMint]);
        
        if (threshold > 1 && adminSigners.length < threshold) {
            throw new Error(`Not enough admin signers (${adminSigners.length}/${threshold}).`);
        }
        await (sdk as any).updateEngineConfig({ newXyberMint: newMint.publicKey, signerAdmins: adminSigners });
        xyberMint = newMint.publicKey;
        addLog(`   -> Updated EngineConfig.xyberMint: ${xyberMint.toBase58()}`);
      } catch (e: any) {
         throw new Error(`Failed to provision XYBER mint: ${e?.message || e}`);
      }
    }
    context.xyberMint = xyberMint;

    // Create ATAs
    const creatorXyberAta = getAssociatedTokenAddressSync(xyberMint, admin.publicKey);
    const treasuryXyberAta = getAssociatedTokenAddressSync(xyberMint, treasuryPubkey);
    try {
        const ataTx = new Transaction()
        .add(createAssociatedTokenAccountInstruction(admin.publicKey, creatorXyberAta, admin.publicKey, xyberMint))
        .add(createAssociatedTokenAccountInstruction(admin.publicKey, treasuryXyberAta, treasuryPubkey, xyberMint));
        await provider.sendAndConfirm!(ataTx, []);
    } catch (e) { /* ignore */ }

    // Fund Creation Fee
    if (creationFeeU64 > 0) {
        const bal = await this.getTokenBalance(context, creatorXyberAta);
        const req = creationFeeU64 / 1e9;
        if (bal < req) {
             let funded = false;
             try {
                const mintFeeTx = new Transaction().add(createMintToInstruction(xyberMint, creatorXyberAta, admin.publicKey, BigInt(creationFeeU64)));
                await provider.sendAndConfirm!(mintFeeTx, []);
                funded = true;
             } catch(_) {}

             if (!funded) {
                 try {
                     if (threshold > 1 && adminSigners.length < threshold) throw new Error("Not enough signers");
                     await (sdk as any).updateEngineConfig({ newCreationFee: new BN(0), signerAdmins: adminSigners });
                     addLog("   -> Creation fee set to 0 via config update.");
                 } catch (e: any) {
                     throw new Error(`Unable to fund creation fee: ${e.message}`);
                 }
             }
        }
    }
  }

  async getTokenBalance(context: FlowContext, ata: PublicKey): Promise<number> {
      try {
        const balance = await context.provider.connection.getTokenAccountBalance(ata);
        return parseFloat(balance.value.uiAmountString || "0");
      } catch { return 0; }
  }
}

