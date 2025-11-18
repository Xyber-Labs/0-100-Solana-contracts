import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Command } from "commander";
import { loadKeypair } from "@xyber-labs/0-100-sdk";

import { getExplorerUrl, runWithSdk } from "./utils";

async function main() {
  const program = new Command();

  program
    .allowExcessArguments(false)
    .requiredOption("--preset-id <number>", "Launch preset ID")
    .requiredOption("--name <string>", "Token name")
    .requiredOption("--symbol <string>", "Token symbol")
    .requiredOption("--uri <string>", "Token metadata URI")
    .requiredOption("--creator-keypair <path>", "Path to creator keypair file")
    .option("--project-id <number>", "Project ID (auto-generated if not provided)");

  program.parse(process.argv);

  const opts = program.opts();
  const creatorKeypair = loadKeypair(opts.creatorKeypair);

  await runWithSdk(async ({ provider, sdk }) => {
    const presetId = parseInt(opts.presetId);
    const projectId = opts.projectId ? new BN(opts.projectId) : undefined;

    console.log("Initializing launch from preset:");
    console.log("  Preset ID:", presetId);
    if (projectId) {
      console.log("  Project ID:", projectId.toString());
    } else {
      console.log("  Project ID: (auto-generated)");
    }
    console.log("  Name:", opts.name);
    console.log("  Symbol:", opts.symbol);
    console.log("  URI:", opts.uri);

    const [presetPda] = sdk.getLaunchPresetPda(presetId);
    console.log("  Preset PDA:", presetPda.toBase58());

    console.log("Sending transaction...");

    const result = await sdk.initLaunchFromPreset({
      presetId,
      projectId,
      name: opts.name,
      symbol: opts.symbol,
      uri: opts.uri,
      creator: creatorKeypair,
    });

    console.log("✅ Success!");
    console.log("Transaction signature:", result.signature);
    console.log("Explorer:", getExplorerUrl(provider, result.signature));
    console.log("Launch PDA:", result.launchPda.toBase58());

    const launchAccount = await sdk.fetchLaunch(result.launchPda);
    console.log("Launch state created:");
    console.log("  Project ID:", launchAccount.projectId.toString());
    console.log("  Creator:", launchAccount.creator.toBase58());
    console.log("  Hard cap:", launchAccount.hardCapLamports.toString());
    console.log("  Funding period end:", new Date(launchAccount.fundingPeriodEnd.toNumber() * 1000).toISOString());
  });
}

main();
