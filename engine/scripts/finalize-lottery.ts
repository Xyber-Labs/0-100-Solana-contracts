import { BN } from "@coral-xyz/anchor";
import { Command } from "commander";

import { getExplorerUrl, runWithSdk } from "./utils";

async function main() {
  const program = new Command();

  program
    .allowExcessArguments(false)
    .requiredOption("--project-id <number>", "Project ID")
    .option("--compute-units <number>", "Compute units limit (max 1400000)", "1200000")
    .parse(process.argv);

  const opts = program.opts();
  const computeUnits = Number(opts.computeUnits);

  if (!Number.isInteger(computeUnits) || computeUnits < 1 || computeUnits > 1_400_000) {
    throw new Error("compute-units must be 1..1400000");
  }

  await runWithSdk(async ({ provider, sdk }) => {
    const projectId = new BN(opts.projectId);
    const [launchPda] = sdk.getLaunchPdaByProjectId(projectId);

    console.log("Finalizing lottery:");
    console.log("  Project ID:", projectId.toString());
    console.log("  Launch PDA:", launchPda.toBase58());
    console.log("  Compute units:", computeUnits.toLocaleString());

    const result = await sdk.finalizeLottery({
      launch: launchPda,
      computeUnits,
    });

    console.log("✅ Success!");
    console.log("Transaction signature:", result.signature);
    console.log("Explorer:", getExplorerUrl(provider, result.signature));
  });
}

main();
