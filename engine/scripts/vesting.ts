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

      console.log("Vesting Info:");
      console.log("  Project ID:", projectId.toString());
      console.log("  Launch PDA:", launchPda.toBase58());
      console.log("  Participant:", participant.toBase58());
      console.log("  Bucket:", bucket === 0 ? "Sale" : "Team");
      console.log("  Is Creator:", participant.equals(launchState.creator) ? "Yes" : "No");

      if (!launchState.claimsOpenedAt) {
        console.log("\n⚠️  Claims not opened yet. Vesting info unavailable.");
        return;
      }

      const vestingConfig = await sdk.getVestingConfig({
        launch: launchPda,
        participant,
        bucket,
      });

      const claimsOpenedAt = launchState.claimsOpenedAt.toNumber();
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
  .action(async (opts) => {
    await runWithSdk(async ({ provider, sdk }) => {
      const projectId = new BN(opts.projectId);
      const bucket = parseInt(opts.bucket);
      const participantKeypair = loadKeypair(opts.participantKeypair);

      const [launchPda] = sdk.getLaunchPdaByProjectId(projectId);
      const { data: launchState } = await sdk.fetchLaunch(launchPda);

      console.log("Claiming vested tokens:");
      console.log("  Project ID:", projectId.toString());
      console.log("  Launch PDA:", launchPda.toBase58());
      console.log("  Participant:", participantKeypair.publicKey.toBase58());
      console.log("  Bucket:", bucket === 0 ? "Sale" : "Team");
      console.log("  Is Creator:", participantKeypair.publicKey.equals(launchState.creator) ? "Yes" : "No");

      if (!launchState.claimsOpenedAt) {
        console.log("\n❌ Claims not opened yet.");
        return;
      }

      if (!launchState.baseMint) {
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
        baseMint: launchState.baseMint,
        bucket,
        participantKeypair,
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
