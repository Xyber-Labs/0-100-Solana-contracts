import { BN } from "@coral-xyz/anchor";
import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";

import { getExplorerUrl, loadKeypair, runWithSdk } from "./utils";

async function main() {
  const program = new Command();
  program
    .allowExcessArguments(false)
    .requiredOption("--payload <path>", "Path to JSON payload file")
    .option("--admin-keypair <path>", "Admin keypair file (can be specified multiple times)", (value, previous: string[]) => {
      return previous ? [...previous, value] : [value];
    }, []);
  program.parse(process.argv);

  const opts = program.opts();
  const payloadPath = path.resolve(String(opts.payload));
  const raw = fs.readFileSync(payloadPath, "utf8");
  const payload = JSON.parse(raw);

  const idStr = payload.id !== undefined ? String(payload.id) : undefined;
  if (idStr === undefined) throw new Error("id is required");
  const id = Number(idStr);
  if (!Number.isInteger(id) || id < 0 || id > 255) throw new Error("id must be 0..255");

  const adminKeyPaths: string[] = opts.adminKeypair && opts.adminKeypair.length > 0
    ? opts.adminKeypair.map((p: string) => path.resolve(p))
    : [];

  if (!adminKeyPaths.length) throw new Error("At least one --admin-keypair must be provided");

  const adminKeypairs = adminKeyPaths.map(loadKeypair);
  const p = payload;

  await runWithSdk(async ({ provider, sdk }) => {
    const result = await sdk.initLaunchPreset({
      id,
      params: {
        hardCapLamports: new BN(String(p.hardCapLamports)),
        minRaiseLamports: new BN(String(p.minRaiseLamports)),
        perWalletCap: new BN(String(p.perWalletCap)),
        tauLamports: new BN(String(p.tauLamports)),
        baseTotalAllocation: new BN(String(p.baseTotalAllocation)),
        baseSaleBasisPoints: new BN(String(p.baseSaleBasisPoints)),
        teamAllocationBasisPoints: p.teamAllocationBasisPoints !== undefined ? Number(p.teamAllocationBasisPoints) : 1000,
        fundingDurationSeconds: p.fundingDurationSeconds !== undefined ? Number(p.fundingDurationSeconds) : 0,
        saleStartTimeSec: p.saleStartTimeSec !== undefined ? Number(p.saleStartTimeSec) : 0,
        unlockTimeSec: p.unlockTimeSec !== undefined ? Number(p.unlockTimeSec) : 0,
        rosterShardCap: Number(p.rosterShardCap),
        rosterShardsTotal: Number(p.rosterShardsTotal),
        creatorInitialDepositLamports: new BN(String(p.creatorInitialDepositLamports ?? "0")),
        creatorDailyLamportsLimit: new BN(String(p.creatorDailyLamportsLimit ?? "0")),
        creatorClaimLockPeriodSec: new BN(String(p.creatorClaimLockPeriodSec)),
        creatorMaxDepositLamports: new BN(String(p.creatorMaxDepositLamports)),
        poolCreationGracePeriodSec: p.poolCreationGracePeriodSec !== undefined ? Number(p.poolCreationGracePeriodSec) : 0,
        teamVestingDurationSec: p.teamVestingDurationSec !== undefined ? Number(p.teamVestingDurationSec) : 365 * 24 * 60 * 60,
      },
      adminKeypairs,
    });

    console.log("✅ Success!");
    console.log("LaunchPreset:", result.launchPreset.toBase58());
    console.log("Transaction signature:", result.signature);
    console.log("Explorer:", getExplorerUrl(provider, result.signature));
  });
}

main();


