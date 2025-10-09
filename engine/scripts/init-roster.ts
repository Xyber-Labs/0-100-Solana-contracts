import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Engine } from "../target/types/engine";
import EngineSDK from "../ts-sdk/src/engine";
import { Command } from "commander";

const program = new Command();

program
  .requiredOption("--project-id <number>", "Project ID to initialize roster for")
  .parse(process.argv);

const opts = program.opts();

function parseArgs() {
  return {
    projectId: parseInt(opts.projectId)
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

async function main() {
  try {
    const args = parseArgs();
    const { provider, sdk } = initializeSdk();
    const project = await findProject(sdk, args.projectId);

    console.log("Initializing roster...");
    const result = await sdk.initRoster({
      launch: project.launchPda
    });

    console.log("✅ Roster initialized successfully!");
    console.log(`Roster PDA: ${result.rosterPda.toBase58()}`);
    console.log(`Transaction: ${result.signature}`);
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
