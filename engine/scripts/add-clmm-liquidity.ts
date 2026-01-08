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
    projectId: parseInt(opts.projectId)
  };
}

async function main() {
  const args = parseArgs();

  await runWithSdk(async ({ provider, sdk }) => {
    const project = await findProject(sdk, args.projectId);
    const launchPda = project.launchPda;

    console.log("\nAdding CLMM liquidity...");

    const launchState = await sdk.fetchLaunch(launchPda);
    const baseMint = sdk.extractBaseMint(launchState.data);

    if (!baseMint) {
      console.error("❌ Pool not created yet. Run create-clmm-pool first.");
      process.exit(1);
    }

    const payerKeypair = (provider.wallet as any).payer as anchor.web3.Keypair;

    const result = await sdk.addClmmLiquidity({
      launch: launchPda,
      signers: [payerKeypair],
    });

    console.log(`✅ Liquidity added!`);
    console.log(`Transaction signature: ${result.signature}`);
    console.log(`Explorer: ${getExplorerUrl(provider, result.signature)}`);
  });
}

main();
