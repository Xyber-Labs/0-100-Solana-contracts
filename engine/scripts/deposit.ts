import { BN } from "@coral-xyz/anchor";
import { Command } from "commander";

import { getExplorerUrl, loadKeypair, runWithSdk } from "./utils";

const parsePositiveInt = (value: string): number => {
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1) throw new Error("must be a positive integer");
  return n;
};

async function main() {
  const program = new Command();

  program
    .allowExcessArguments(false)
    .requiredOption("--project-id <number>", "Project ID")
    .requiredOption("--amount <lamports>", "Deposit amount in lamports")
    .requiredOption("--user-keypair <path>", "Path to user keypair file")
    .option("--shard-id <number>", "Shard ID", parsePositiveInt, 1)
    .parse(process.argv);

  const opts = program.opts();
  const userKeypair = loadKeypair(opts.userKeypair);
  const shardId = opts.shardId;
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
      userKeypair,
      shardId,
    });

    console.log("✅ Success!");
    console.log("User contribution PDA:", result.userPda.toBase58());
    console.log("Transaction signature:", result.signature);
    console.log("Explorer:", getExplorerUrl(provider, result.signature));
  });
}

main();
