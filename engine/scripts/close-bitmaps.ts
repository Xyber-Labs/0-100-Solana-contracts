import { BN } from "@coral-xyz/anchor";
import { Command } from "commander";

import { getExplorerUrl, loadKeypair, runWithSdk } from "./utils";

async function main() {
  const program = new Command();

  program
    .allowExcessArguments(false)
    .requiredOption("--project-id <number>", "Project ID")
    .requiredOption("--multisig-keypair <path>", "Multisig keypair file")
    .option("--info", "Display bitmap info without closing")
    .parse(process.argv);

  const opts = program.opts();
  const projectId = new BN(opts.projectId);
  const multisig = loadKeypair(opts.multisigKeypair);

  await runWithSdk(async ({ provider, sdk }) => {
    const [launchPda] = sdk.getLaunchPdaByProjectId(projectId);
    const [winnersBitmapPda] = sdk.getWinnersBitmapPda(launchPda);
    const [inactiveBitmapPda] = sdk.getInactiveBitmapPda(launchPda);

    console.log("Close Bitmaps:");
    console.log("  Project ID:", projectId.toString());
    console.log("  Launch PDA:", launchPda.toBase58());
    console.log("  Winners Bitmap:", winnersBitmapPda.toBase58());
    console.log("  Inactive Bitmap:", inactiveBitmapPda.toBase58());

    const { data: launchState } = await sdk.fetchLaunch(launchPda);

    if (!launchState.phase.finalized) {
      throw new Error("Launch is not finalized");
    }

    const winnersBitmapInfo = await provider.connection.getAccountInfo(winnersBitmapPda);
    const inactiveBitmapInfo = await provider.connection.getAccountInfo(inactiveBitmapPda);

    if (!winnersBitmapInfo) {
      throw new Error("Winners bitmap account not found");
    }
    if (!inactiveBitmapInfo) {
      throw new Error("Inactive bitmap account not found");
    }

    const winnersBitmapData = winnersBitmapInfo.data;
    const winnersHasNonZero = winnersBitmapData.some(b => b !== 0);

    console.log("\nBitmap State:");
    console.log("  Winners bitmap size:", winnersBitmapData.length, "bytes");
    console.log("  Winners bitmap rent:", winnersBitmapInfo.lamports / 1e9, "SOL");
    console.log("  Winners bitmap empty:", !winnersHasNonZero);
    console.log("  Inactive bitmap size:", inactiveBitmapInfo.data.length, "bytes");
    console.log("  Inactive bitmap rent:", inactiveBitmapInfo.lamports / 1e9, "SOL");

    if (winnersHasNonZero) {
      console.log("\n⚠️  WARNING: Winners bitmap is not empty!");
      console.log("   This means some Sale claims are not complete.");
      console.log("   All participants must fully claim their Sale allocation before closing bitmaps.");
      console.log("   Transaction will likely fail with ClaimsNotComplete error.");
    }

    if (opts.info) {
      console.log("\n(--info mode: not executing transaction)");
      return;
    }

    console.log("\nClosing bitmaps...");

    const { signature } = await sdk.closeBitmaps({
      launch: launchPda,
      rentRecipient: multisig.publicKey,
      signers: [multisig],
    });

    const totalRentReturned = (winnersBitmapInfo.lamports + inactiveBitmapInfo.lamports) / 1e9;

    console.log("\n✅ Success!");
    console.log("Transaction signature:", signature);
    console.log("Explorer:", getExplorerUrl(provider, signature));
    console.log("Total rent returned:", totalRentReturned, "SOL");
  });
}

main();
