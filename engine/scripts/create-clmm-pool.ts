import * as anchor from "@coral-xyz/anchor";
import { Command } from "commander";

import { findProject, getExplorerUrl, runWithSdk } from "./utils";

const program = new Command();

program
  .requiredOption("--project-id <number>", "Project ID to create pool for")
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

    console.log("\nCreating CLMM pool...");

    const payerKeypair = (provider.wallet as any).payer as anchor.web3.Keypair;

    const result = await sdk.createClmmPool({
      launch: launchPda,
      signers: [payerKeypair],
    });

    console.log(`✅ Pool created!`);
    console.log(`Transaction signature: ${result.signature}`);
    console.log(`Explorer: ${getExplorerUrl(provider, result.signature)}`);
    console.log(`Base Mint: ${result.baseMint.toBase58()}`);
    console.log(`Base Token ATA: ${result.baseTokenAta.toBase58()}`);
    console.log(`Quote Vault: ${result.quoteVault.toBase58()}`);
    console.log(`Base Vault: ${result.baseVault.toBase58()}`);
  });
}

main();
