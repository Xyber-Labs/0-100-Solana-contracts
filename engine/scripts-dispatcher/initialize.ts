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
    .requiredOption("--signer-keypair <path>", "Path to signer keypair (deployer for first run, multisig for updates)")
    .requiredOption("--new-multisig <pubkey>", "Multisig pubkey to store in config")
    .parse(process.argv);

  const opts = program.opts();
  const backend = new anchor.web3.PublicKey(opts.backend);
  const platformWallet = new anchor.web3.PublicKey(opts.platformWallet);
  const communityWallet = new anchor.web3.PublicKey(opts.communityWallet);
  const newMultisig = new anchor.web3.PublicKey(opts.newMultisig);
  const signerKeypair = loadKeypair(opts.signerKeypair);

  await runWithDispatcherSdk(async ({ provider, sdk }) => {
    console.log("Initializing Income Dispatcher config:");
    console.log("  Backend:", backend.toBase58());
    console.log("  Platform wallet:", platformWallet.toBase58());
    console.log("  Community wallet:", communityWallet.toBase58());
    console.log("  New multisig:", newMultisig.toBase58());
    console.log("  Signer:", signerKeypair.publicKey.toBase58());

    const [configPda] = sdk.getConfigPda();
    console.log("  Config PDA:", configPda.toBase58());

    console.log("Sending transaction...");
    const result = await sdk.initialize({
      newMultisig,
      backend,
      platformWallet,
      communityWallet,
      signerKeypair,
    });

    console.log("✅ Success!");
    console.log("Transaction signature:", result.signature);
    console.log("Explorer:", getExplorerUrl(provider, result.signature));
    console.log("Config:", result.config.toBase58());
  });
}

main();
