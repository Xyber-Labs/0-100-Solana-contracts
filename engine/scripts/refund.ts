import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Command } from "commander";

import { getExplorerUrl, loadKeypair, runWithSdk } from "./utils";

const program = new Command();

program
  .name("refund")
  .description("Refund management commands");

program
  .command("info")
  .description("Get refund info for a participant")
  .requiredOption("--project-id <number>", "Project ID")
  .requiredOption("--participant <pubkey-or-path>", "Participant pubkey or keypair path")
  .action(async (opts) => {
    await runWithSdk(async ({ sdk }) => {
      const projectId = new BN(opts.projectId);

      let participant: anchor.web3.PublicKey;
      try {
        participant = new anchor.web3.PublicKey(opts.participant);
      } catch {
        const keypair = loadKeypair(opts.participant);
        participant = keypair.publicKey;
      }

      const [launchPda] = sdk.getLaunchPdaByProjectId(projectId);
      const { data: launchState } = await sdk.fetchLaunch(launchPda);
      const { data: preset } = await sdk.fetchLaunchPresetByAddress(launchState.preset);
      const { data: lotteryControl } = await sdk.fetchLotteryControl(launchPda);

      console.log("Refund Info:");
      console.log("  Project ID:", projectId.toString());
      console.log("  Launch PDA:", launchPda.toBase58());
      console.log("  Participant:", participant.toBase58());

      const isFinalized = lotteryControl.status.finalized !== undefined;
      const isCancelled = lotteryControl.status.cancelled !== undefined;

      console.log("\nLottery Status:");
      if (isCancelled) {
        console.log("  Status: Cancelled (full refund available)");
      } else if (isFinalized) {
        console.log("  Status: Finalized (losing tickets refundable)");
      } else {
        console.log("  Status: Funding (no refunds yet)");
        return;
      }

      try {
        const { data: contribution } = await sdk.fetchContribution(launchPda, participant);
        const totalTickets = contribution.ticketRanges.reduce(
          (sum: number, r: { start: BN; end: BN }) => sum + r.end.sub(r.start).toNumber(),
          0
        );
        const ticketsRefunded = contribution.ticketsRefunded.toNumber();

        let refundableTickets: number;
        if (isCancelled) {
          refundableTickets = totalTickets - ticketsRefunded;
        } else {
          const winnersData = await sdk.fetchWinnersBitmap(launchPda);
          let winningTickets = 0;
          for (const range of contribution.ticketRanges) {
            const start = range.start.toNumber();
            const end = range.end.toNumber();
            for (let i = start; i < end; i++) {
              const byteIndex = Math.floor(i / 8);
              const bitIndex = i % 8;
              if (byteIndex < winnersData.length) {
                if ((winnersData[byteIndex] & (1 << bitIndex)) !== 0) {
                  winningTickets++;
                }
              }
            }
          }
          const losingTickets = totalTickets - winningTickets;
          refundableTickets = losingTickets - ticketsRefunded;
        }

        const tauLamports = preset.tauLamports.toNumber();
        const refundableLamports = refundableTickets * tauLamports;

        console.log("\nContribution:");
        console.log("  Total Tickets:", totalTickets);
        console.log("  Already Refunded:", ticketsRefunded, "tickets");
        console.log("  Refundable Now:", refundableTickets, "tickets");
        console.log("  Refund Amount:", refundableLamports, "lamports", `(${refundableLamports / anchor.web3.LAMPORTS_PER_SOL} SOL)`);
      } catch {
        console.log("\n⚠️  No contribution found for this participant.");
      }
    });
  });

program
  .command("claim")
  .description("Claim refund for losing tickets")
  .requiredOption("--project-id <number>", "Project ID")
  .requiredOption("--user-keypair <path>", "Path to user keypair file")
  .action(async (opts) => {
    await runWithSdk(async ({ provider, sdk }) => {
      const projectId = new BN(opts.projectId);
      const userKeypair = loadKeypair(opts.userKeypair);

      const [launchPda] = sdk.getLaunchPdaByProjectId(projectId);

      console.log("Claiming refund:");
      console.log("  Project ID:", projectId.toString());
      console.log("  Launch PDA:", launchPda.toBase58());
      console.log("  User:", userKeypair.publicKey.toBase58());

      console.log("\nSending transaction...");

      const result = await sdk.refund({
        launch: launchPda,
        contributorKeypair: userKeypair,
      });

      console.log("\n✅ Refund claimed!");
      console.log("Transaction signature:", result.signature);
      console.log("Explorer:", getExplorerUrl(provider, result.signature));
    });
  });

program.parse(process.argv);
