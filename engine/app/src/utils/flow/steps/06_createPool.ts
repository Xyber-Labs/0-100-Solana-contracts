import { FlowStep } from "../step";
import type { FlowContext } from "../types";
import { preparePoolCreationWithRetry, mintForTestSafe } from "../../flowHelpers";
import { PublicKey, Keypair } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

export class CreatePoolStep extends FlowStep {
  constructor() {
    super("[7/10] Create Pool");
  }

  async execute(context: FlowContext): Promise<void> {
    const { sdk, provider, config, addLog, testLaunchState, simConfig } = context;
    if (!testLaunchState) throw new Error("Launch state not initialized");

    addLog(`\n[7/10] Prepare Pool Creation...`);
    await preparePoolCreationWithRetry({ sdk, launchPda: testLaunchState, addLog });

    const testBaseMint = Keypair.generate();
    let mintedBaseMint: PublicKey | null = null;
    const wantTestMint = !!(simConfig && (simConfig as any).useTestMintForBase);

    if (wantTestMint) {
      mintedBaseMint = await mintForTestSafe({ sdk, launchPda: testLaunchState, baseMintKeypair: testBaseMint, addLog });
      addLog(`      - Minted base mint (test): ${mintedBaseMint.toBase58()}`);
    } else {
        let clmmProgramStr = String((config as any).clmmProgram || "");
        if (!clmmProgramStr) {
            try {
                const raydiumFromSdk = (sdk as any).getRaydiumClmmProgramId?.();
                if (raydiumFromSdk) clmmProgramStr = raydiumFromSdk.toBase58();
            } catch (_) {}
        }
        if (!clmmProgramStr) {
             const ep = (provider as any)?.connection?.rpcEndpoint || "";
             clmmProgramStr = ep.includes("devnet")
               ? "DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH"
               : "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK";
        }
        (config as any).clmmProgram = clmmProgramStr;
        const clmmProgramPk = new PublicKey(clmmProgramStr);

        const createPool = await (sdk as any).createClmmPoolTx({
            payer: (provider as any).wallet.publicKey,
            launch: testLaunchState,
            clmmProgram: clmmProgramPk,
            provider,
        });
        const sig = await (provider as any).sendAndConfirm(createPool.transaction, createPool.signers);
        addLog(`      - CLMM pool created. Signature: ${sig}`);
        
        mintedBaseMint = createPool.baseMint;
        if (!mintedBaseMint) throw new Error("Base mint missing after CLMM pool creation");
        addLog(`      - Base mint: ${mintedBaseMint.toBase58()}`);

        try {
             const addLiq = await (sdk as any).addClmmLiquidityTx({
                payer: (provider as any).wallet.publicKey,
                launch: testLaunchState,
                baseMint: mintedBaseMint,
                provider,
            });
            const sigL = await (provider as any).sendAndConfirm(addLiq.transaction, addLiq.signers);
            addLog(`      - Initial liquidity added. Signature: ${sigL}`);
            
            try {
                const baseVaultBal = await provider.connection.getTokenAccountBalance(addLiq.baseVault);
                const quoteVaultBal = await provider.connection.getTokenAccountBalance(addLiq.quoteVault);
                const baseUi = Number(baseVaultBal.value.uiAmount ?? baseVaultBal.value.uiAmountString ?? "0");
                const quoteUi = Number(quoteVaultBal.value.uiAmount ?? quoteVaultBal.value.uiAmountString ?? "0");
                context.poolBaseLiquidityUi = baseUi;
                context.poolQuoteLiquidityUi = quoteUi;
                addLog(`      - Pool liquidity: base=${baseUi} quote=${quoteUi}`);
            } catch (_) {}

        } catch (liqErr: any) {
             addLog(`      - Warning: addClmmLiquidity failed (claims may remain closed): ${liqErr?.message || liqErr}`);
        }
    }

    context.mintedBaseMint = mintedBaseMint!;
    await this.updateSupplySnapshot(context, mintedBaseMint!);
  }

  async updateSupplySnapshot(context: FlowContext, baseMint: PublicKey) {
        if (!baseMint) return;
        try {
            const supply = await context.provider.connection.getTokenSupply(baseMint);
            const amountStr = typeof supply.value.amount === "string" ? supply.value.amount : String(supply.value.amount ?? "0");
            const observedAtomic = new BN(amountStr);
            const launchForSupply: any = await (context.sdk as any).fetchLaunch(context.testLaunchState!);
            const baseTotalAllocationBn = new BN(launchForSupply.baseTotalAllocation.toString());
            const expectedAtomic = baseTotalAllocationBn;
            const deltaAtomic = expectedAtomic.sub(observedAtomic);

            const DECIMALS_SCALE = new BN(1_000_000_000);
            const format = (v: BN) => {
                 const abs = v.abs();
                 const whole = abs.div(DECIMALS_SCALE);
                 const frac = abs.mod(DECIMALS_SCALE).toString().padStart(9, "0").replace(/0+$/, "");
                 return (v.isNeg() ? "-" : "") + (frac.length ? `${whole}.${frac}` : whole.toString());
            };

            context.addLog(`   Base mint total supply:   ${format(observedAtomic)}`);
            context.addLog(`   Expected supply (base_total): ${format(expectedAtomic)}`);
            context.addLog(`   Supply delta: ${format(deltaAtomic)}`);
        } catch (_) { }
  }
}
