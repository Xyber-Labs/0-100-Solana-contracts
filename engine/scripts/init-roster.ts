import { Command } from "commander";

import { getExplorerUrl, runWithSdk } from "./utils";

async function main() {
  await runWithSdk(async ({ provider, sdk }) => {
    const opts = parseArgs();

    console.log(`Finding project #${opts.projectId}...`);
    const project = await sdk.findProjectById(opts.projectId);
    if (!project) {
      console.error(`❌ Project #${opts.projectId} not found`);
      process.exit(1);
    }
    console.log("Found launch state:", project.launchPda.toBase58());
    console.log("Initializing roster...");

    const result = await sdk.initRoster({
      launch: project.launchPda
    });

    console.log("✅ Success!");
    console.log("Roster PDA:", result.rosterPda.toBase58());
    console.log("Transaction signature:", result.signature);
    console.log("Explorer:", getExplorerUrl(provider, result.signature));
  });
}

function parseArgs() {
  const program = new Command();

  program
    .requiredOption("--project-id <number>", "Project ID to initialize roster for")
    .parse(process.argv);

  const opts = program.opts();
  return {
    projectId: parseInt(opts.projectId)
  };
}

main();
