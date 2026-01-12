import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Command } from "commander";

import { getExplorerUrl, loadKeypair, runWithSdk } from "./utils";

async function main() {
  const program = new Command();

  program
    .requiredOption("--treasury <pubkey>", "Treasury address")
    .requiredOption("--xyber-mint <pubkey>", "XYBER token mint address")
    .requiredOption("--realloc-fund-lamports <lamports>", "Realloc fund lamports")
    .requiredOption("--signer-keypair <path>", "Path to signer keypair (deployer for first run, multisig for updates)")
    .requiredOption("--new-multisig <pubkey>", "Multisig pubkey to store in config")
    .parse(process.argv);

  const opts = program.opts();

  const treasury = new anchor.web3.PublicKey(opts.treasury);
  const xyberMint = new anchor.web3.PublicKey(opts.xyberMint);
  const reallocFundLamports = new BN(opts.reallocFundLamports);
  const newMultisig = new anchor.web3.PublicKey(opts.newMultisig);

  const signerKeypair = loadKeypair(opts.signerKeypair);

  await runWithSdk(async ({ provider, sdk }) => {
    console.log("Initializing engine config:");
    console.log("  Treasury:", treasury.toBase58());
    console.log("  XYBER mint:", xyberMint.toBase58());
    console.log("  Realloc fund lamports:", reallocFundLamports.toString());
    console.log("  New multisig:", newMultisig.toBase58());
    console.log("  Signer:", signerKeypair.publicKey.toBase58());

    const [configPda] = sdk.getConfigPda();
    console.log("  Engine config PDA:", configPda.toBase58());

    console.log("Sending transaction...");

    const result = await sdk.initEngineConfig({
      treasury,
      xyberMint,
      newMultisig,
      reallocFundLamports,
      signerKeypair,
    });

    console.log("✅ Success!");
    console.log("Transaction signature:", result.signature);
    console.log("Explorer:", getExplorerUrl(provider, result.signature));
    console.log("Engine config:", result.engineConfig.toBase58());
  });
}

main();
