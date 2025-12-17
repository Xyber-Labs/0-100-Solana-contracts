import * as anchor from "@coral-xyz/anchor";
import { Command } from "commander";
import { getExplorerUrl, loadKeypair } from "../scripts/utils";
import { runWithDispatcherSdk } from "./utils";

async function main() {
  const program = new Command();
  program
    .requiredOption("--backend <pubkey>", "Backend wallet address authorized to execute buyback")
    .requiredOption("--platform-wallet <pubkey>", "Platform wallet address for receiving fees")
    .requiredOption("--community-wallet <pubkey>", "Community wallet address")
    .requiredOption("--deployer-keypair <path>", "Path to deployer keypair file (must match DEPLOYER constant)")
    .parse(process.argv);

  const opts = program.opts();
  const backend = new anchor.web3.PublicKey(opts.backend);
  const platformWallet = new anchor.web3.PublicKey(opts.platformWallet);
  const communityWallet = new anchor.web3.PublicKey(opts.communityWallet);
  const deployerKeypair = loadKeypair(opts.deployerKeypair);

  await runWithDispatcherSdk(async ({ provider, sdk }) => {
    console.log("Initializing Income Dispatcher config:");
    console.log("  Backend:", backend.toBase58());
    console.log("  Platform wallet:", platformWallet.toBase58());
    console.log("  Community wallet:", communityWallet.toBase58());
    console.log("  Deployer:", deployerKeypair.publicKey.toBase58());

    const [configPda] = sdk.getConfigPda();
    console.log("  Config PDA:", configPda.toBase58());

    console.log("Sending transaction...");
    const result = await sdk.initialize({
      backend,
      platformWallet,
      communityWallet,
      signers: [deployerKeypair],
    });

    console.log("✅ Success!");
    console.log("Transaction signature:", result.signature);
    console.log("Explorer:", getExplorerUrl(provider, result.signature));
    console.log("Config:", result.config.toBase58());
  });
}

main();
