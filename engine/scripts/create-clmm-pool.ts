import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Engine } from "../target/types/engine";
import EngineSDK from "../ts-sdk/src/engine";
import { Command } from "commander";
import * as fs from "fs";

const program = new Command();

program
  .requiredOption("--project-id <number>", "Project ID to create pool for")
  .option("--token-mint <string>", "Token mint keypair path (generates new if not provided)")
  .parse(process.argv);

const opts = program.opts();

function parseArgs() {
  return {
    projectId: parseInt(opts.projectId),
    tokenMintPath: opts.tokenMint
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
  tokenMintPath?: string
) {
  console.log("Creating CLMM pool...");

  let tokenMint: anchor.web3.Keypair;
  if (tokenMintPath) {
    const keypairData = JSON.parse(fs.readFileSync(tokenMintPath, "utf-8"));
    tokenMint = anchor.web3.Keypair.fromSecretKey(new Uint8Array(keypairData));
    console.log("Using existing token mint:", tokenMint.publicKey.toString());
  } else {
    tokenMint = anchor.web3.Keypair.generate();
    console.log("Generated new token mint:", tokenMint.publicKey.toString());
  }

  const result = await sdk.createClmmPool({
    launch: launchPda,
    tokenMint,
  });

  return { signature: result.signature, result, provider, tokenMint };
}

async function displayResults(
  signature: string,
  result: { tokenMint: anchor.web3.PublicKey; poolTokenAta: anchor.web3.PublicKey },
  provider: anchor.AnchorProvider
) {
  console.log("Pool created successfully!");
  console.log("Signature:", signature);

  const mintAccount = await provider.connection.getAccountInfo(result.tokenMint);
  const tokenAccountInfo = await provider.connection.getAccountInfo(result.poolTokenAta);

  console.log("Results:");
  console.log("  Token mint:", result.tokenMint.toString());
  console.log("  Pool token ATA:", result.poolTokenAta.toString());
  console.log("  Mint account exists:", !!mintAccount);
  console.log("  Token account (ATA) exists:", !!tokenAccountInfo);
}

async function main() {
  try {
    const args = parseArgs();
    const { provider, sdk } = initializeSdk();
    const project = await findProject(sdk, args.projectId);
    const { signature, result, provider: usedProvider } = await createClmmPool(
      sdk,
      provider,
      project.launchPda,
      args.tokenMintPath
    );
    await displayResults(signature, result, usedProvider);
  } catch (error) {
    console.error("Transaction failed:");
    console.error(error);
    if (error.logs) {
      console.error("Program logs:");
      error.logs.forEach((log: string) => console.error(log));
    }
    process.exit(1);
  }
}

main();
