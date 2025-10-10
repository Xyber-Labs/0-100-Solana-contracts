import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Engine } from "../target/types/engine";
import EngineSDK from "../ts-sdk/src/engine";
import { Command } from "commander";

const program = new Command();

program
  .requiredOption("--project-id <number>", "Project ID to create pool for")
  .option("--amm-config-index <number>", "AMM config index (default: 0)", "0")
  .addHelpText('after', `
AMM Config Indices:

DEVNET:
  0: Tick 60,  Fee 0.25% (standard)
  1: Tick 1,   Fee 0.01% (stablecoins)
  2: Tick 10,  Fee 0.05%

MAINNET:
  0: Tick 10,  Fee 0.01%
  1: Tick 60,  Fee 0.25% (standard)
  2: Tick 10,  Fee 0.05%
  3: Tick 120, Fee 1.00% (high volatility)
  4: Tick 1,   Fee 0.01% (stablecoins)
  5: Tick 1,   Fee 0.05%
  6: Tick 1,   Fee 0.02%
  7: Tick 1,   Fee 0.03%
  8: Tick 1,   Fee 0.04%
  9: Tick 120, Fee 2.00%
 10: Tick 10,  Fee 0.10%
`)
  .parse(process.argv);

const opts = program.opts();

function parseArgs() {
  return {
    projectId: parseInt(opts.projectId),
    ammConfigIndex: parseInt(opts.ammConfigIndex)
  };
}

function initializeSdk() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const engineProgram = anchor.workspace.engine as Program<Engine>;
  const sdk = EngineSDK.create(provider, engineProgram);
  return { provider, sdk };
}

async function findProject(sdk: ReturnType<typeof EngineSDK.create>, projectId: number) {
  console.log(`Finding project #${projectId}...`);
  const project = await sdk.findProjectById(projectId);
  if (!project) {
    console.error(`Project #${projectId} not found`);
    process.exit(1);
  }
  console.log("Found launch state:", project.launchPda.toBase58());
  return project;
}

async function createClmmPool(
  sdk: ReturnType<typeof EngineSDK.create>,
  provider: anchor.AnchorProvider,
  launchPda: anchor.web3.PublicKey,
  ammConfigIndex: number
) {
  console.log("\n[1/2] Creating CLMM pool...");

  const clusterUrl = provider.connection.rpcEndpoint;
  const isDevnet = clusterUrl.includes("devnet");
  const isMainnet = clusterUrl.includes("mainnet");

  const WSOL_MINT = new anchor.web3.PublicKey("So11111111111111111111111111111111111111112");

  let RAYDIUM_CLMM: anchor.web3.PublicKey;
  let clusterName: string;

  if (isMainnet) {
    RAYDIUM_CLMM = new anchor.web3.PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");
    clusterName = "mainnet";
  } else if (isDevnet) {
    RAYDIUM_CLMM = new anchor.web3.PublicKey("DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH");
    clusterName = "devnet";
  } else {
    RAYDIUM_CLMM = new anchor.web3.PublicKey("devi51mZmdwUJGU9hjN27vEz64Gps7uUefqxg27EAtH");
    clusterName = "localnet";
  }

  console.log(`Using ${clusterName} Raydium CLMM: ${RAYDIUM_CLMM.toBase58()}`);

  // Derive AMM config PDA from index (u16 big-endian)
  const indexBytes = Buffer.alloc(2);
  indexBytes.writeUInt16BE(ammConfigIndex, 0);

  const [ammConfig] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("amm_config"), indexBytes],
    RAYDIUM_CLMM
  );

  console.log(`Using AMM Config (index ${ammConfigIndex}): ${ammConfig.toBase58()}`);

  let baseMint: anchor.web3.Keypair;
  do {
    baseMint = anchor.web3.Keypair.generate();
  } while (baseMint.publicKey.toBuffer().compare(WSOL_MINT.toBuffer()) <= 0);

  const createPoolResult = await sdk.createClmmPoolTx({
    payer: provider.wallet.publicKey,
    launch: launchPda,
    quoteMint: WSOL_MINT,
    baseMint: baseMint,
    ammConfig: ammConfig,
    clmmProgram: RAYDIUM_CLMM,
    provider,
  });

  const poolSig = await provider.sendAndConfirm(
    createPoolResult.transaction,
    [(provider.wallet as any).payer, ...createPoolResult.signers]
  );

  console.log(`✅ Pool created: ${poolSig}`);
  console.log(`   Base Mint: ${createPoolResult.baseMint.toBase58()}`);

  return {
    poolSig,
    baseMint: createPoolResult.baseMint,
    baseTokenAta: createPoolResult.baseTokenAta,
    ammConfig,
    WSOL_MINT,
    RAYDIUM_CLMM
  };
}

async function addLiquidity(
  sdk: ReturnType<typeof EngineSDK.create>,
  provider: anchor.AnchorProvider,
  launchPda: anchor.web3.PublicKey,
  poolData: {
    baseMint: anchor.web3.PublicKey;
    baseTokenAta: anchor.web3.PublicKey;
    ammConfig: anchor.web3.PublicKey;
    WSOL_MINT: anchor.web3.PublicKey;
    RAYDIUM_CLMM: anchor.web3.PublicKey;
  }
) {
  console.log("\n[2/2] Adding liquidity...");

  const launchState = await sdk.fetchLaunch(launchPda);
  const lpAllocationTokens = Number(launchState.lpAllocation) * 1_000_000_000;
  const saleAllocationTokens = Number(launchState.saleAllocation) * 1_000_000_000;
  const requiredQuoteForLiquidity = Math.ceil(
    (lpAllocationTokens * Number(launchState.totalDeposited)) / saleAllocationTokens
  ) + 1_000_000_000;
  const requiredSOL = requiredQuoteForLiquidity / anchor.web3.LAMPORTS_PER_SOL;

  console.log(`Need ~${requiredSOL.toFixed(2)} SOL for liquidity`);

  const balance = await provider.connection.getBalance(provider.wallet.publicKey);
  if (balance < requiredQuoteForLiquidity + 2 * anchor.web3.LAMPORTS_PER_SOL) {
    console.warn(`⚠️  Low balance: ${balance / anchor.web3.LAMPORTS_PER_SOL} SOL`);
    console.warn(`    Need at least ${(requiredQuoteForLiquidity + 2 * anchor.web3.LAMPORTS_PER_SOL) / anchor.web3.LAMPORTS_PER_SOL} SOL`);
  }

  const addLiquidityResult = await sdk.addClmmLiquidityTx({
    payer: provider.wallet.publicKey,
    launch: launchPda,
    quoteMint: poolData.WSOL_MINT,
    baseMint: poolData.baseMint,
    baseTokenAta: poolData.baseTokenAta,
    ammConfig: poolData.ammConfig,
    clmmProgram: poolData.RAYDIUM_CLMM,
    provider,
  });

  const liquiditySig = await provider.sendAndConfirm(
    addLiquidityResult.transaction,
    [(provider.wallet as any).payer, ...addLiquidityResult.signers]
  );

  console.log(`✅ Liquidity added: ${liquiditySig}`);

  return liquiditySig;
}

async function main() {
  try {
    const args = parseArgs();
    const { provider, sdk } = initializeSdk();
    const project = await findProject(sdk, args.projectId);

    console.log("\nCreating CLMM pool and adding liquidity in single transaction...");

    const clusterUrl = provider.connection.rpcEndpoint;
    const isDevnet = clusterUrl.includes("devnet");
    const isMainnet = clusterUrl.includes("mainnet");

    const WSOL_MINT = new anchor.web3.PublicKey("So11111111111111111111111111111111111111112");

    let RAYDIUM_CLMM: anchor.web3.PublicKey;
    let clusterName: string;

    if (isMainnet) {
      RAYDIUM_CLMM = new anchor.web3.PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");
      clusterName = "mainnet";
    } else if (isDevnet) {
      RAYDIUM_CLMM = new anchor.web3.PublicKey("DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH");
      clusterName = "devnet";
    } else {
      RAYDIUM_CLMM = new anchor.web3.PublicKey("devi51mZmdwUJGU9hjN27vEz64Gps7uUefqxg27EAtH");
      clusterName = "localnet";
    }

    console.log(`Using ${clusterName} Raydium CLMM: ${RAYDIUM_CLMM.toBase58()}`);

    // Derive AMM config PDA
    const indexBytes = Buffer.alloc(2);
    indexBytes.writeUInt16BE(args.ammConfigIndex, 0);

    const [ammConfig] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("amm_config"), indexBytes],
      RAYDIUM_CLMM
    );

    console.log(`Using AMM Config (index ${args.ammConfigIndex}): ${ammConfig.toBase58()}`);

    // Generate base mint
    let baseMint: anchor.web3.Keypair;
    do {
      baseMint = anchor.web3.Keypair.generate();
    } while (baseMint.publicKey.toBuffer().compare(WSOL_MINT.toBuffer()) <= 0);

    // Get create pool transaction
    const createPoolResult = await sdk.createClmmPoolTx({
      payer: provider.wallet.publicKey,
      launch: project.launchPda,
      quoteMint: WSOL_MINT,
      baseMint: baseMint,
      ammConfig: ammConfig,
      clmmProgram: RAYDIUM_CLMM,
      provider,
    });

    // Get add liquidity transaction
    const addLiquidityResult = await sdk.addClmmLiquidityTx({
      payer: provider.wallet.publicKey,
      launch: project.launchPda,
      quoteMint: WSOL_MINT,
      baseMint: baseMint.publicKey,
      baseTokenAta: createPoolResult.baseTokenAta,
      ammConfig: ammConfig,
      clmmProgram: RAYDIUM_CLMM,
      provider,
    });

    // Combine both transactions into one
    const combinedTx = new anchor.web3.Transaction();
    combinedTx.add(...createPoolResult.transaction.instructions);
    combinedTx.add(...addLiquidityResult.transaction.instructions);

    const allSigners = [
      (provider.wallet as any).payer,
      ...createPoolResult.signers,
      ...addLiquidityResult.signers
    ];

    const signature = await provider.sendAndConfirm(combinedTx, allSigners);

    console.log("\n=== CLMM Pool Creation Complete ===");
    console.log(`Launch: ${project.launchPda.toBase58()}`);
    console.log(`Base Mint: ${baseMint.publicKey.toBase58()}`);
    console.log(`Quote Mint (WSOL): ${WSOL_MINT.toBase58()}`);
    console.log(`Transaction: ${signature}`);
  } catch (error) {
    console.error("\n❌ Transaction failed:");
    console.error(error);
    if (error.logs) {
      console.error("\nProgram logs:");
      error.logs.forEach((log: string) => console.error(log));
    }
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
