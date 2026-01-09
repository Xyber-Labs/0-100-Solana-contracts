import { Command } from "commander";

import { getExplorerUrl, loadKeypair, runWithSdk } from "./utils";

async function main() {
  const program = new Command();

  program
    .allowExcessArguments(false)
    .requiredOption("--preset-id <number>", "Launch preset ID")
    .requiredOption("--name <string>", "Token name")
    .requiredOption("--symbol <string>", "Token symbol")
    .requiredOption("--uri <string>", "Token metadata URI")
    .requiredOption("--creator-keypair <path>", "Path to creator keypair file")
    .option("--third-party-keypair <path>", "Path to third party keypair file (for event tracking)");

  program.parse(process.argv);

  const opts = program.opts();
  const creatorKeypair = loadKeypair(opts.creatorKeypair);
  const thirdPartyKeypair = opts.thirdPartyKeypair ? loadKeypair(opts.thirdPartyKeypair) : undefined;

  await runWithSdk(async ({ provider, sdk }) => {
    const presetId = parseInt(opts.presetId);
    const projectId = await sdk.getNextProjectId();

    console.log("Initializing launch from preset:");
    console.log("  Preset ID:", presetId);
    console.log("  Project ID:", projectId.toString());
    console.log("  Name:", opts.name);
    console.log("  Symbol:", opts.symbol);
    console.log("  URI:", opts.uri);
    if (thirdPartyKeypair) {
      console.log("  Third Party:", thirdPartyKeypair.publicKey.toBase58());
    }

    const [presetPda] = sdk.getLaunchPresetPda(presetId);
    console.log("  Preset PDA:", presetPda.toBase58());

    console.log("Sending transaction...");

    const result = await sdk.initLaunch({
      presetId,
      projectId,
      name: opts.name,
      symbol: opts.symbol,
      uri: opts.uri,
      creator: creatorKeypair,
      thirdParty: thirdPartyKeypair,
    });

    console.log("✅ Success!");
    console.log("Transaction signature:", result.signature);
    console.log("Explorer:", getExplorerUrl(provider, result.signature));
    console.log("Launch PDA:", result.launchPda.toBase58());

    const launchAccount = await sdk.fetchLaunch(result.launchPda);
    const presetAccount = await sdk.fetchLaunchPreset(presetId);
    const phase = launchAccount.data.phase as any;
    const fundingEnd = phase.funding.startedAt.toNumber() + presetAccount.data.fundingDurationSeconds.toNumber();
    console.log("Launch state created:");
    console.log("  Project ID:", launchAccount.data.projectId.toString());
    console.log("  Creator:", launchAccount.data.creator.toBase58());
    console.log("  Hard cap:", presetAccount.data.hardCapLamports.toString());
    console.log("  Funding period end:", new Date(fundingEnd * 1000).toISOString());
  });
}

main();
