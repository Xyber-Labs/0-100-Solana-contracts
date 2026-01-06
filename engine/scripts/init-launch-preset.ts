import { BN } from "@coral-xyz/anchor";
import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";

import { getExplorerUrl, loadKeypair, runWithSdk } from "./utils";

function formatLaunchPreset(preset: any): Record<string, string | number> {
  const toNum = (v: any): string | number => {
    if (v === null || v === undefined) return "null";
    if (typeof v === "number") return v;
    if (typeof v === "bigint") return v.toString(10);
    if (BN.isBN(v)) return v.toString(10);
    if (typeof v === "string") {
      const n = parseInt(v, 16);
      return isNaN(n) ? v : n.toString(10);
    }
    return String(v);
  };
  return {
    id: toNum(preset.id),
    hardCapLamports: toNum(preset.hardCapLamports),
    minRaiseLamports: toNum(preset.minRaiseLamports),
    perWalletCap: toNum(preset.perWalletCap),
    tauLamports: toNum(preset.tauLamports),
    baseTotalAllocation: toNum(preset.baseTotalAllocation),
    baseSaleBasisPoints: toNum(preset.baseSaleBasisPoints),
    teamAllocationBasisPoints: toNum(preset.teamAllocationBasisPoints),
    fundingDurationSeconds: toNum(preset.fundingDurationSeconds),
    unlockTimeSec: toNum(preset.unlockTimeSec),
    rosterShardCap: toNum(preset.rosterShardCap),
    rosterShardsTotal: toNum(preset.rosterShardsTotal),
    creatorInitialDepositLamports: toNum(preset.creatorInitialDepositLamports),
    creatorDailyLamportsLimit: toNum(preset.creatorDailyLamportsLimit),
    creatorClaimLockPeriodSec: toNum(preset.creatorClaimLockPeriodSec),
    creatorMaxDeposit: toNum(preset.creatorMaxDeposit),
    poolCreationGracePeriodSec: toNum(preset.poolCreationGracePeriodSec),
    teamVestingDurationSec: toNum(preset.teamVestingDurationSec),
  };
}

async function main() {
  const program = new Command();
  program
    .allowExcessArguments(false)
    .option("--info <preset-id>", "Fetch and display preset info by ID")
    .option("--payload <path>", "Path to JSON payload file")
    .option("--admin-keypair <path>", "Admin keypair file (can be specified multiple times)", (value, previous: string[]) => {
      return previous ? [...previous, value] : [value];
    }, []);
  program.parse(process.argv);

  const opts = program.opts();

  if (opts.info !== undefined) {
    const id = Number(opts.info);
    if (!Number.isInteger(id) || id < 0 || id > 255) throw new Error("preset-id must be 0..255");

    await runWithSdk(async ({ sdk }) => {
      const { pda, launchPreset } = await sdk.fetchLaunchPreset(id);
      console.log("LaunchPreset PDA:", pda.toBase58());
      console.log("LaunchPreset:", JSON.stringify(formatLaunchPreset(launchPreset), null, 2));
    });
    return;
  }

  if (!opts.payload) throw new Error("--payload is required when not using --info");

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
        teamAllocationBasisPoints: Number(p.teamAllocationBasisPoints),
        fundingDurationSeconds: Number(p.fundingDurationSeconds),
        unlockTimeSec: Number(p.unlockTimeSec ?? 0),
        creatorPeriodUnlock: new BN(String(p.creatorPeriodUnlock)),
        creatorPeriodSec: Number(p.creatorPeriodSec),
        creatorMaxDeposit: new BN(String(p.creatorMaxDeposit)),
        poolCreationGracePeriodSec: Number(p.poolCreationGracePeriodSec),
        teamDurationSec: Number(p.teamDurationSec),
        teamPeriodSec: Number(p.teamPeriodSec),
        contributorDurationSec: Number(p.contributorDurationSec),
        contributorPeriodSec: Number(p.contributorPeriodSec),
        withdrawalLimit: Number(p.withdrawalLimit),
        creationFee: new BN(String(p.creationFee)),
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
