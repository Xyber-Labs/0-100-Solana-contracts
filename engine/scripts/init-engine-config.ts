import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Command } from "commander";

import { getExplorerUrl, loadKeypair, runWithSdk } from "./utils";

async function main() {
  const program = new Command();

  program
    .requiredOption("--treasury <pubkey>", "Treasury address")
    .requiredOption("--creation-fee <lamports>", "Creation fee in lamports")
    .requiredOption("--xyber-mint <pubkey>", "XYBER token mint address")
    .requiredOption("--threshold <number>", "Admin signature threshold (2 or 3)")
    .requiredOption("--admin1-keypair <path>", "Path to first admin keypair file")
    .requiredOption("--admin2-keypair <path>", "Path to second admin keypair file")
    .requiredOption("--admin3-keypair <path>", "Path to third admin keypair file")
    .parse(process.argv);

  const opts = program.opts();

  const treasury = new anchor.web3.PublicKey(opts.treasury);
  const creationFee = new BN(opts.creationFee);
  const xyberMint = new anchor.web3.PublicKey(opts.xyberMint);
  const threshold = parseInt(opts.threshold);

  const admin1Keypair = loadKeypair(opts.admin1Keypair);
  const admin2Keypair = loadKeypair(opts.admin2Keypair);
  const admin3Keypair = loadKeypair(opts.admin3Keypair);

  const admin1 = admin1Keypair.publicKey;
  const admin2 = admin2Keypair.publicKey;
  const admin3 = admin3Keypair.publicKey;

  const adminKeypairs = [admin1Keypair, admin2Keypair, admin3Keypair];

  await runWithSdk(async ({ provider, sdk }) => {
    console.log("Initializing engine config:");
    console.log("  Treasury:", treasury.toBase58());
    console.log("  Creation fee:", creationFee.toString());
    console.log("  XYBER mint:", xyberMint.toBase58());
    console.log("  Admin 1:", admin1.toBase58());
    console.log("  Admin 2:", admin2.toBase58());
    console.log("  Admin 3:", admin3.toBase58());
    console.log("  Threshold:", threshold);

    const [configPda] = sdk.getConfigPda();
    console.log("  Engine config PDA:", configPda.toBase58());

    console.log("Sending transaction...");

    const result = await sdk.initEngineConfig({
      treasury,
      creationFee,
      xyberMint,
      admins: [admin1, admin2, admin3],
      threshold,
      adminKeypairs,
    });

    console.log("✅ Success!");
    console.log("Transaction signature:", result.signature);
    console.log("Explorer:", getExplorerUrl(provider, result.signature));
    console.log("Engine config:", result.engineConfig.toBase58());
  });
}

main();
