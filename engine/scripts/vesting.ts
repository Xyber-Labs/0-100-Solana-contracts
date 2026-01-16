import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Command } from "commander";

import { getExplorerUrl, loadKeypair, runWithSdk } from "./utils";

const program = new Command();

program
  .name("vesting")
  .description("Vesting management commands");

program
  .command("info")
  .description("Get vesting info for a participant")
  .requiredOption("--project-id <number>", "Project ID")
  .requiredOption("--participant <pubkey-or-path>", "Participant pubkey or keypair path")
  .option("--bucket <number>", "Bucket (0 = Sale, 1 = Team)", "0")
  .action(async (opts) => {
    await runWithSdk(async ({ sdk }) => {
      const projectId = new BN(opts.projectId);
      const bucket = parseInt(opts.bucket);

      let participant: anchor.web3.PublicKey;
      try {
        participant = new anchor.web3.PublicKey(opts.participant);
      } catch {
        const keypair = loadKeypair(opts.participant);
        participant = keypair.publicKey;
      }

      const [launchPda] = sdk.getLaunchPdaByProjectId(projectId);
      const { data: launchState } = await sdk.fetchLaunch(launchPda);
      const phase = launchState.phase as any;

      console.log("Vesting Info:");
      console.log("  Project ID:", projectId.toString());
      console.log("  Launch PDA:", launchPda.toBase58());
      console.log("  Participant:", participant.toBase58());
      console.log("  Bucket:", bucket === 0 ? "Sale" : "Team");
      console.log("  Is Creator:", participant.equals(launchState.creator) ? "Yes" : "No");

      if (!phase.finalized?.claimsOpenedAt) {
        console.log("\n⚠️  Claims not opened yet. Vesting info unavailable.");
        return;
      }

      const vestingConfig = await sdk.getVestingConfig({
        launch: launchPda,
        participant,
        bucket,
      });

      // Debug: fetch contribution and winners bitmap
      if (bucket === 0) {
        const [contributionPda] = sdk.getContributionPda(launchPda, participant);
        const { data: contribution } = await sdk.fetchContribution(launchPda, participant);
        const [winnersBitmapPda] = sdk.getWinnersBitmapPda(launchPda);
        const winnersBitmapAccount = await sdk.program.provider.connection.getAccountInfo(winnersBitmapPda);

        console.log("\n[DEBUG] Contribution ticket ranges:");
        contribution.ticketRanges.forEach((range: any, i: number) => {
          const start = range.start.toNumber();
          const end = range.end.toNumber();
          console.log(`  Range ${i}: [${start}, ${end}) = ${end - start} tickets`);

          if (winnersBitmapAccount) {
            const winnersData = winnersBitmapAccount.data;
            let count = 0;
            const firstBits = [];
            const lastBits = [];

            for (let j = start; j < end; j++) {
              const byteIndex = Math.floor(j / 8);
              const bitIndex = j % 8;
              const bit = (winnersData[byteIndex] & (1 << bitIndex)) !== 0;
              if (bit) count++;

              if (j < start + 5) {
                firstBits.push(`${j}:${bit ? 1 : 0}`);
              }
              if (j >= end - 5) {
                lastBits.push(`${j}:${bit ? 1 : 0}`);
              }
            }

            console.log(`    Winning bits: ${count}/${end - start}`);
            console.log(`    First bits: [${firstBits.join(', ')}]`);
            console.log(`    Last bits: [${lastBits.join(', ')}]`);

            // Show bytes
            const startByte = Math.floor(start / 8);
            const endByte = Math.floor((end - 1) / 8);
            const bytesHex = [];
            for (let b = startByte; b <= Math.min(startByte + 3, endByte); b++) {
              bytesHex.push(`${b}:0x${winnersData[b].toString(16).padStart(2, '0')}`);
            }
            if (endByte > startByte + 3) {
              bytesHex.push('...');
              for (let b = Math.max(endByte - 3, startByte + 4); b <= endByte; b++) {
                bytesHex.push(`${b}:0x${winnersData[b].toString(16).padStart(2, '0')}`);
              }
            }
            console.log(`    Bytes: [${bytesHex.join(', ')}]`);
          }
        });
      }

      const claimsOpenedAt = phase.finalized.claimsOpenedAt.toNumber();
      const now = Math.floor(Date.now() / 1000);
      const elapsed = Math.max(0, now - claimsOpenedAt);
      const durationSec = vestingConfig.durationSec.toNumber();
      const periodSec = vestingConfig.periodSec.toNumber();

      if (periodSec <= 0) {
        throw new Error(`Invalid periodSec: ${periodSec}. Must be greater than zero.`);
      }

      const periodsTotal = Math.floor(durationSec / periodSec);
      if (periodsTotal <= 0) {
        throw new Error(`Invalid periodsTotal: ${periodsTotal}. durationSec (${durationSec}) must be >= periodSec (${periodSec}).`);
      }

      const periodsPassed = Math.min(Math.floor(elapsed / periodSec), periodsTotal);

      const availableToClaimBN = vestingConfig.allocation
        .mul(new BN(periodsPassed))
        .div(new BN(periodsTotal));
      const remainingToClaim = availableToClaimBN.sub(vestingConfig.claimed);

      console.log("\nVesting Schedule:");
      console.log("  Total Allocation:", vestingConfig.allocation.toString(), "tokens");
      console.log("  Duration:", durationSec, "seconds");
      console.log("  Period:", periodSec, "seconds");
      console.log("  Periods Total:", periodsTotal);

      console.log("\nCurrent Status:");
      console.log("  Claims Opened At:", new Date(claimsOpenedAt * 1000).toISOString());
      console.log("  Elapsed:", elapsed, "seconds");
      console.log("  Periods Passed:", periodsPassed, "/", periodsTotal);
      console.log("  Available to Claim:", availableToClaimBN.toString(), "tokens");
      console.log("  Already Claimed:", vestingConfig.claimed.toString(), "tokens");
      console.log("  Remaining to Claim Now:", remainingToClaim.toString(), "tokens");

      const percentVested = periodsTotal > 0 ? Math.round((periodsPassed / periodsTotal) * 100) : 0;
      const percentClaimed = vestingConfig.allocation.gt(new BN(0))
        ? Math.round(vestingConfig.claimed.mul(new BN(100)).div(vestingConfig.allocation).toNumber())
        : 0;

      console.log("\nProgress:");
      console.log(`  Vested: ${percentVested}%`);
      console.log(`  Claimed: ${percentClaimed}%`);
    });
  });

program
  .command("claim")
  .description("Claim vested tokens")
  .requiredOption("--project-id <number>", "Project ID")
  .requiredOption("--participant-keypair <path>", "Participant keypair path")
  .option("--bucket <number>", "Bucket (0 = Sale, 1 = Team)", "0")
  .option("--compute-units <number>", "Compute units limit (max 1400000)", "500000")
  .action(async (opts) => {
    await runWithSdk(async ({ provider, sdk }) => {
      const projectId = new BN(opts.projectId);
      const bucket = parseInt(opts.bucket);
      const participantKeypair = loadKeypair(opts.participantKeypair);
      const computeUnits = Number(opts.computeUnits);

      if (!Number.isInteger(computeUnits) || computeUnits < 1 || computeUnits > 1_400_000) {
        throw new Error("compute-units must be 1..1400000");
      }

      const [launchPda] = sdk.getLaunchPdaByProjectId(projectId);
      const { data: launchState } = await sdk.fetchLaunch(launchPda);
      const phase = launchState.phase as any;
      const baseMint = sdk.extractBaseMint(launchState);

      console.log("Claiming vested tokens:");
      console.log("  Project ID:", projectId.toString());
      console.log("  Launch PDA:", launchPda.toBase58());
      console.log("  Participant:", participantKeypair.publicKey.toBase58());
      console.log("  Bucket:", bucket === 0 ? "Sale" : "Team");
      console.log("  Is Creator:", participantKeypair.publicKey.equals(launchState.creator) ? "Yes" : "No");
      console.log("  Compute Units:", computeUnits);

      if (!phase.finalized?.claimsOpenedAt) {
        console.log("\n❌ Claims not opened yet.");
        return;
      }

      if (!baseMint) {
        console.log("\n❌ Base mint not created yet.");
        return;
      }

      const vestingBefore = await sdk.getVestingConfig({
        launch: launchPda,
        participant: participantKeypair.publicKey,
        bucket,
      });

      console.log("\nBefore claim:");
      console.log("  Allocation:", vestingBefore.allocation.toString(), "tokens");
      console.log("  Already Claimed:", vestingBefore.claimed.toString(), "tokens");

      console.log("\nSending transaction...");

      const result = await sdk.claim({
        launch: launchPda,
        baseMint,
        bucket,
        participantKeypair,
        computeUnits,
      });

      const vestingAfter = await sdk.getVestingConfig({
        launch: launchPda,
        participant: participantKeypair.publicKey,
        bucket,
      });

      const claimed = vestingAfter.claimed.sub(vestingBefore.claimed);

      console.log("\n✅ Success!");
      console.log("  Claimed:", claimed.toString(), "tokens");
      console.log("  Total Claimed Now:", vestingAfter.claimed.toString(), "tokens");
      console.log("  Transaction:", result.signature);
      console.log("  Explorer:", getExplorerUrl(provider, result.signature));
    });
  });

program.parse(process.argv);
