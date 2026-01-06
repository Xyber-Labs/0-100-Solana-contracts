import * as anchor from "@coral-xyz/anchor";
import { Command } from "commander";

import { findProject, getExplorerUrl, runWithSdk } from "./utils";

const program = new Command();

program
  .requiredOption("--project-id <number>", "Project ID")
  .parse(process.argv);

const opts = program.opts();

function parseArgs() {
  return {
    projectId: parseInt(opts.projectId),
  };
}

async function main() {
  const args = parseArgs();

  await runWithSdk(async ({ provider, sdk }) => {
    const project = await findProject(sdk, args.projectId);
    const launchPda = project.launchPda;

    console.log("\nInitializing team vesting...");

    const payerKeypair = (provider.wallet as anchor.Wallet).payer;

    const { signature } = await sdk.initTeamVesting({
      launch: launchPda,
      payerKeypair,
    });

    const [teamVestingPda] = sdk.getTeamVestingPda(launchPda);

    console.log(`✅ Team vesting initialized!`);
    console.log(`Transaction: ${signature}`);
    console.log(`Explorer: ${getExplorerUrl(provider, signature)}`);
    console.log(`Team Vesting PDA: ${teamVestingPda.toBase58()}`);
  });
}

main();
