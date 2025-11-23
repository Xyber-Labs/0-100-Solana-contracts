import * as anchor from "@coral-xyz/anchor";
import { Command } from "commander";
import { loadKeypair } from "@xyber-labs/0-100-sdk";
import { getExplorerUrl } from "../scripts/utils";
import { runWithDispatcherSdk } from "./utils";

async function main() {
  const program = new Command();
  program
    .requiredOption("--platform-wallet <pubkey>", "Platform wallet address for receiving fees")
    .requiredOption("--community-claim-signer <pubkey>", "Community claim signer address")
    .requiredOption("--admin-keypair <path>", "Path to admin keypair file")
    .parse(process.argv);

  const opts = program.opts();
  const platformWallet = new anchor.web3.PublicKey(opts.platformWallet);
  const communityClaimSigner = new anchor.web3.PublicKey(opts.communityClaimSigner);
  const adminKeypair = loadKeypair(opts.adminKeypair);

  await runWithDispatcherSdk(adminKeypair, async ({ provider, sdk }) => {
    console.log("Initializing Income Dispatcher config:");
    console.log("  Platform wallet:", platformWallet.toBase58());
    console.log("  Community claim signer:", communityClaimSigner.toBase58());
    console.log("  Admin:", adminKeypair.publicKey.toBase58());

    const [configPda] = sdk.getConfigPda();
    console.log("  Config PDA:", configPda.toBase58());

    console.log("Sending transaction...");
    const result = await sdk.initialize({
      platformWallet,
      communityClaimSigner,
      signers: [adminKeypair],
    });

    console.log("✅ Success!");
    console.log("Transaction signature:", result.signature);
    console.log("Explorer:", getExplorerUrl(provider, result.signature));
    console.log("Config:", result.config.toBase58());
  });
}

main();
