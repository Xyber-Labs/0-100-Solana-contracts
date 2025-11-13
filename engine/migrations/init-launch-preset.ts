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
  // Fallback: if tmp-local paths missing, try tmp/
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
    hardCapLamports: String(p.hardCapLamports),
    minRaiseLamports: String(p.minRaiseLamports),
    perWalletCap: String(p.perWalletCap),
    tauLamports: String(p.tauLamports),
    baseTotalAllocation: String(p.baseTotalAllocation),
    baseSaleBasisPoints: String(p.baseSaleBasisPoints),
    teamAllocationBasisPoints: p.teamAllocationBasisPoints !== undefined ? Number(p.teamAllocationBasisPoints) : undefined,
    fundingDurationSeconds: p.fundingDurationSeconds !== undefined ? String(p.fundingDurationSeconds) : undefined,
    saleStartTimeSec: p.saleStartTimeSec !== undefined ? String(p.saleStartTimeSec) : undefined,
    unlockTimeSec: p.unlockTimeSec !== undefined ? String(p.unlockTimeSec) : undefined,
    rosterShardCap: Number(p.rosterShardCap),
    rosterShardsTotal: Number(p.rosterShardsTotal),
    creatorInitialDepositLamports: String(p.creatorInitialDepositLamports ?? "0"),
    creatorDailyLamportsLimit: String(p.creatorDailyLamportsLimit ?? "0"),
    creatorClaimLockPeriodSec: String(p.creatorClaimLockPeriodSec),
    creatorMaxDepositLamports: String(p.creatorMaxDepositLamports),
    poolCreationGracePeriodSec: p.poolCreationGracePeriodSec !== undefined ? String(p.poolCreationGracePeriodSec) : undefined,
    teamVestingDurationSec: p.teamVestingDurationSec !== undefined ? String(p.teamVestingDurationSec) : undefined,
  };
}

function loadKeypair(path: string): anchor.web3.Keypair {
  const raw = fs.readFileSync(path, "utf8");
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
  const res = await (sdk as any).initLaunchPreset({
    id: args.id,
    params: {
      hardCapLamports: new anchor.BN(args.hardCapLamports),
      minRaiseLamports: new anchor.BN(args.minRaiseLamports),
      perWalletCap: new anchor.BN(args.perWalletCap),
      tauLamports: new anchor.BN(args.tauLamports),
      baseTotalAllocation: new anchor.BN(args.baseTotalAllocation),
      baseSaleBasisPoints: new anchor.BN(args.baseSaleBasisPoints),
      teamAllocationBasisPoints: args.teamAllocationBasisPoints,
      fundingDurationSeconds: args.fundingDurationSeconds !== undefined ? Number(args.fundingDurationSeconds) : 0,
      saleStartTimeSec: args.saleStartTimeSec !== undefined ? Number(args.saleStartTimeSec) : undefined,
      unlockTimeSec: args.unlockTimeSec !== undefined ? Number(args.unlockTimeSec) : undefined,
      rosterShardCap: args.rosterShardCap,
      rosterShardsTotal: args.rosterShardsTotal,
      creatorInitialDepositLamports: new anchor.BN(args.creatorInitialDepositLamports),
      creatorDailyLamportsLimit: new anchor.BN(args.creatorDailyLamportsLimit),
      creatorClaimLockPeriodSec: new anchor.BN(args.creatorClaimLockPeriodSec),
      creatorMaxDepositLamports: new anchor.BN(args.creatorMaxDepositLamports),
      poolCreationGracePeriodSec: args.poolCreationGracePeriodSec !== undefined ? Number(args.poolCreationGracePeriodSec) : undefined,
      teamVestingDurationSec: args.teamVestingDurationSec !== undefined ? Number(args.teamVestingDurationSec) : undefined,
    },
    adminKeypairs,
  });
  console.log(`LaunchPreset: ${res.launchPreset.toBase58()}`);
  console.log(`Signature: ${res.signature}`);
};

if (require.main === module) {
  const provider = (anchor as any).AnchorProvider.env();
  (module.exports as any)(provider).catch((e: any) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}


