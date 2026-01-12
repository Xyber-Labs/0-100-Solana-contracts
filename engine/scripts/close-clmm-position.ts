import * as anchor from "@coral-xyz/anchor";
import { Command } from "commander";

import { findProject, getExplorerUrl, loadKeypair, runWithSdk } from "./utils";

const program = new Command();

program
  .requiredOption("--project-id <number>", "Project ID")
  .requiredOption("--creator-keypair <path>", "Path to creator keypair file")
  .parse(process.argv);

const opts = program.opts();

function parseArgs() {
  return {
    projectId: parseInt(opts.projectId),
    creatorKeypair: loadKeypair(opts.creatorKeypair),
  };
}

async function main() {
  const args = parseArgs();

  await runWithSdk(async ({ provider, sdk }) => {
    const project = await findProject(sdk, args.projectId);
    const launchPda = project.launchPda;

    console.log("\nClosing CLMM position...");

    const launchState = await sdk.fetchLaunch(launchPda);
    const positionNftMint = sdk.extractPositionNftMint(launchState.data);

    if (!positionNftMint) {
      console.error("❌ No position NFT found. Liquidity may not have been added or position already closed.");
      process.exit(1);
    }

    if (!args.creatorKeypair.publicKey.equals(launchState.data.creator)) {
      console.error(`❌ Provided keypair ${args.creatorKeypair.publicKey.toBase58()} is not the creator of this launch.`);
      console.error(`   Expected creator: ${launchState.data.creator.toBase58()}`);
      process.exit(1);
    }

    const result = await sdk.closeClmmPosition({
      launch: launchPda,
      creatorKeypair: args.creatorKeypair,
    });

    console.log(`✅ Position closed!`);
    console.log(`Transaction signature: ${result.signature}`);
    console.log(`Explorer: ${getExplorerUrl(provider, result.signature)}`);
  });
}

main();
