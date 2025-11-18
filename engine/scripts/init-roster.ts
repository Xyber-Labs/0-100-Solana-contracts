import { BN } from "@coral-xyz/anchor";
import { Command } from "commander";

import { getExplorerUrl, runWithSdk } from "./utils";

async function main() {
  const program = new Command();

  program
    .allowExcessArguments(false)
    .requiredOption("--project-id <number>", "Project ID")
    .parse(process.argv);

  const opts = program.opts();

  await runWithSdk(async ({ provider, sdk }) => {
    const projectId = new BN(opts.projectId);
    const [launchPda] = sdk.getLaunchPdaByProjectId(projectId);

    console.log("Initializing roster:");
    console.log("  Project ID:", projectId.toString());
    console.log("  Launch PDA:", launchPda.toBase58());

    const result = await sdk.initRoster({
      launch: launchPda,
    });

    console.log("✅ Success!");
    console.log("Roster PDA:", result.rosterPda.toBase58());
    console.log("Transaction signature:", result.signature);
    console.log("Explorer:", getExplorerUrl(provider, result.signature));
  });
}

main();
