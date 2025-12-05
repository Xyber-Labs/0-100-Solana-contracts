import * as anchor from "@coral-xyz/anchor";
import { Command } from "commander";
import EngineSDK from "../ts-sdk/src/engine";
import * as fs from "fs";
import * as path from "path";

function parseArgs() {
  const program = new Command();
  program
    .allowExcessArguments(false)
    .requiredOption("--payload <path>");
  program.parse(process.argv);
  const opts = program.opts();
  const payloadPath = path.resolve(String(opts.payload));
  const raw = fs.readFileSync(payloadPath, "utf8");
  const payload = JSON.parse(raw);
  const idStr = payload.id !== undefined ? String(payload.id) : undefined;
  if (idStr === undefined) throw new Error("id is required");
  const id = Number(idStr);
  if (!Number.isInteger(id) || id < 0 || id > 255) throw new Error("id must be 0..255");
  const baseDir = path.dirname(payloadPath);
  let adminKeyPaths: string[] = Array.isArray(payload.adminKeyPaths)
    ? payload.adminKeyPaths.map((p: string) => {
        const s = String(p);
        return path.isAbsolute(s) ? s : path.resolve(baseDir, s);
      })
    : [];
  adminKeyPaths = adminKeyPaths.map((p: string) => {
    if (fs.existsSync(p)) return p;
    const alt = p.replace(`${path.sep}tmp-local${path.sep}`, `${path.sep}tmp${path.sep}`);
    return fs.existsSync(alt) ? alt : p;
  });
  if (!adminKeyPaths.length) throw new Error("adminKeyPaths[] must be provided in payload");
  const p = payload;
  return {
    id,
    adminKeyPaths,
    hardCapLamports: p.hardCapLamports !== undefined ? String(p.hardCapLamports) : undefined,
    minRaiseLamports: p.minRaiseLamports !== undefined ? String(p.minRaiseLamports) : undefined,
    perWalletCap: p.perWalletCap !== undefined ? String(p.perWalletCap) : undefined,
    tauLamports: p.tauLamports !== undefined ? String(p.tauLamports) : undefined,
    baseTotalAllocation: p.baseTotalAllocation !== undefined ? String(p.baseTotalAllocation) : undefined,
    baseSaleBasisPoints: p.baseSaleBasisPoints !== undefined ? String(p.baseSaleBasisPoints) : undefined,
    teamAllocationBasisPoints: p.teamAllocationBasisPoints !== undefined ? Number(p.teamAllocationBasisPoints) : undefined,
    fundingDurationSeconds: p.fundingDurationSeconds !== undefined ? Number(p.fundingDurationSeconds) : undefined,
    unlockTimeSec: p.unlockTimeSec !== undefined ? Number(p.unlockTimeSec) : undefined,
    rosterShardCap: p.rosterShardCap !== undefined ? Number(p.rosterShardCap) : undefined,
    rosterShardsTotal: p.rosterShardsTotal !== undefined ? Number(p.rosterShardsTotal) : undefined,
    creatorInitialDepositLamports: p.creatorInitialDepositLamports !== undefined ? String(p.creatorInitialDepositLamports) : undefined,
    creatorDailyLamportsLimit: p.creatorDailyLamportsLimit !== undefined ? String(p.creatorDailyLamportsLimit) : undefined,
    creatorClaimLockPeriodSec: p.creatorClaimLockPeriodSec !== undefined ? String(p.creatorClaimLockPeriodSec) : undefined,
    creatorMaxDepositLamports: p.creatorMaxDepositLamports !== undefined ? String(p.creatorMaxDepositLamports) : undefined,
    poolCreationGracePeriodSec: p.poolCreationGracePeriodSec !== undefined ? Number(p.poolCreationGracePeriodSec) : undefined,
    teamVestingDurationSec: p.teamVestingDurationSec !== undefined ? Number(p.teamVestingDurationSec) : undefined,
  };
}

function loadKeypair(pathStr: string): anchor.web3.Keypair {
  const raw = fs.readFileSync(pathStr, "utf8");
  const arr = JSON.parse(raw);
  const secret = Uint8Array.from(arr);
  return anchor.web3.Keypair.fromSecretKey(secret);
}

module.exports = async function (provider: anchor.AnchorProvider) {
  anchor.setProvider(provider);
  const args = parseArgs();
  const idl = await EngineSDK.loadIdl();
  const programAny: any = (anchor.workspace as any).Engine || new (anchor as any).Program(idl as any, (idl as any).metadata.address, provider as any);
  const adminKeypairs = (args.adminKeyPaths || []).map(loadKeypair);
  if (!adminKeypairs.length) throw new Error("adminKeyPaths[] in payload is required");
  const sdk = EngineSDK.create(provider as any, programAny as any, adminKeypairs[0]);
  const patch: any = {
    hardCapLamports: args.hardCapLamports !== undefined ? new anchor.BN(args.hardCapLamports) : undefined,
    minRaiseLamports: args.minRaiseLamports !== undefined ? new anchor.BN(args.minRaiseLamports) : undefined,
    perWalletCap: args.perWalletCap !== undefined ? new anchor.BN(args.perWalletCap) : undefined,
    tauLamports: args.tauLamports !== undefined ? new anchor.BN(args.tauLamports) : undefined,
    baseTotalAllocation: args.baseTotalAllocation !== undefined ? new anchor.BN(args.baseTotalAllocation) : undefined,
    baseSaleBasisPoints: args.baseSaleBasisPoints !== undefined ? new anchor.BN(args.baseSaleBasisPoints) : undefined,
    teamAllocationBasisPoints: args.teamAllocationBasisPoints,
    fundingDurationSeconds: args.fundingDurationSeconds,
    unlockTimeSec: args.unlockTimeSec,
    rosterShardCap: args.rosterShardCap,
    rosterShardsTotal: args.rosterShardsTotal,
    creatorInitialDepositLamports: args.creatorInitialDepositLamports !== undefined ? new anchor.BN(args.creatorInitialDepositLamports) : undefined,
    creatorDailyLamportsLimit: args.creatorDailyLamportsLimit !== undefined ? new anchor.BN(args.creatorDailyLamportsLimit) : undefined,
    creatorClaimLockPeriodSec: args.creatorClaimLockPeriodSec !== undefined ? new anchor.BN(args.creatorClaimLockPeriodSec) : undefined,
    creatorMaxDepositLamports: args.creatorMaxDepositLamports !== undefined ? new anchor.BN(args.creatorMaxDepositLamports) : undefined,
    poolCreationGracePeriodSec: args.poolCreationGracePeriodSec,
    teamVestingDurationSec: args.teamVestingDurationSec,
  };
  const res = await (sdk as any).updateLaunchPreset({
    id: args.id,
    patch,
    adminKeypairs,
  });
  console.log(`LaunchPreset: ${res.launchPreset.toBase58()}`);
  console.log(`Signature: ${res.signature}`);
  try {
    const preset: any = await (programAny.account as any).launchPreset.fetch(res.launchPreset);
    console.log("LaunchPreset after update:");
    console.log(`  id: ${preset.id}`);
    console.log(`  hardCapLamports: ${preset.hardCapLamports?.toString?.() ?? preset.hardCapLamports}`);
    console.log(`  minRaiseLamports: ${preset.minRaiseLamports?.toString?.() ?? preset.minRaiseLamports}`);
    console.log(`  perWalletCap: ${preset.perWalletCap?.toString?.() ?? preset.perWalletCap}`);
    console.log(`  tauLamports: ${preset.tauLamports?.toString?.() ?? preset.tauLamports}`);
    console.log(`  baseTotalAllocation: ${preset.baseTotalAllocation?.toString?.() ?? preset.baseTotalAllocation}`);
    console.log(`  baseSaleBasisPoints: ${preset.baseSaleBasisPoints?.toString?.() ?? preset.baseSaleBasisPoints}`);
    console.log(`  teamAllocationBasisPoints: ${preset.teamAllocationBasisPoints?.toString?.() ?? preset.teamAllocationBasisPoints}`);
    console.log(`  fundingDurationSeconds: ${preset.fundingDurationSeconds?.toString?.() ?? preset.fundingDurationSeconds}`);
    console.log(`  unlockTimeSec: ${preset.unlockTimeSec?.toString?.() ?? preset.unlockTimeSec}`);
    console.log(`  rosterShardCap: ${preset.rosterShardCap}`);
    console.log(`  rosterShardsTotal: ${preset.rosterShardsTotal}`);
    console.log(`  creatorInitialDepositLamports: ${preset.creatorInitialDepositLamports?.toString?.() ?? preset.creatorInitialDepositLamports}`);
    console.log(`  creatorDailyLamportsLimit: ${preset.creatorDailyLamportsLimit?.toString?.() ?? preset.creatorDailyLamportsLimit}`);
    console.log(`  creatorClaimLockPeriodSec: ${preset.creatorClaimLockPeriodSec?.toString?.() ?? preset.creatorClaimLockPeriodSec}`);
    console.log(`  creatorMaxDeposit: ${preset.creatorMaxDeposit?.toString?.() ?? preset.creatorMaxDeposit}`);
    console.log(`  poolCreationGracePeriodSec: ${preset.poolCreationGracePeriodSec?.toString?.() ?? preset.poolCreationGracePeriodSec}`);
    console.log(`  teamVestingDurationSec: ${preset.teamVestingDurationSec?.toString?.() ?? preset.teamVestingDurationSec}`);
  } catch (e) {
    console.log("Failed to fetch LaunchPreset after update:", String((e as any)?.message ?? e));
  }
};

if (require.main === module) {
  const provider = (anchor as any).AnchorProvider.env();
  (module.exports as any)(provider).catch((e: any) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}


