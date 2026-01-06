import { BN } from "@coral-xyz/anchor";
import { Command } from "commander";

import { getExplorerUrl, loadKeypair, runWithSdk } from "./utils";

async function main() {
  const program = new Command();

  program
    .allowExcessArguments(false)
    .requiredOption("--project-id <number>", "Project ID")
    .requiredOption("--amount <lamports>", "Deposit amount in lamports")
    .requiredOption("--user-keypair <path>", "Path to user keypair file")
    .parse(process.argv);

  const opts = program.opts();
  const userKeypair = loadKeypair(opts.userKeypair);
  await runWithSdk(async ({ provider, sdk }) => {
    const projectId = new BN(opts.projectId);
    const amount = new BN(opts.amount);

    const [launchPda] = sdk.getLaunchPdaByProjectId(projectId);

    console.log("Making deposit:");
    console.log("  Project ID:", projectId.toString());
    console.log("  Launch PDA:", launchPda.toBase58());
    console.log("  User:", userKeypair.publicKey.toBase58());
    console.log("  Amount:", amount.toString(), "lamports");

    console.log("Sending transaction...");

    const result = await sdk.deposit({
      launch: launchPda,
      amountLamports: amount,
      contributorKeypair: userKeypair,
    });

    console.log("✅ Success!");
    console.log("User contribution PDA:", result.contributionPda.toBase58());
    console.log("Transaction signature:", result.signature);
    console.log("Explorer:", getExplorerUrl(provider, result.signature));
  });
}

main();
