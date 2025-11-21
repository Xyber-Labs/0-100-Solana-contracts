import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Command } from "commander";

import { getExplorerUrl, runWithSdk } from "./utils";

async function main() {
  const program = new Command();

  program
    .allowExcessArguments(false)
    .requiredOption("--project-id <number>", "Project ID")
    .requiredOption("--shard-id <number>", "Shard ID (0-based)")
    .parse(process.argv);

  const opts = program.opts();

  await runWithSdk(async ({ provider, sdk }) => {
    const projectId = new BN(opts.projectId);
    const shardId = parseInt(opts.shardId);
    const [launchPda] = sdk.getLaunchPdaByProjectId(projectId);

    console.log("Initializing roster shard:");
    console.log("  Project ID:", projectId.toString());
    console.log("  Shard ID:", shardId);
    console.log("  Launch PDA:", launchPda.toBase58());

    const payerKeypair = (provider.wallet as any).payer as anchor.web3.Keypair;

    const result = await sdk.initRosterShard({
      launch: launchPda,
      shardId,
      signers: [payerKeypair],
    });

    console.log("✅ Success!");
    console.log("Roster shard PDA:", result.rosterShard.toBase58());
    console.log("Transaction signature:", result.signature);
    console.log("Explorer:", getExplorerUrl(provider, result.signature));
  });
}

main();
