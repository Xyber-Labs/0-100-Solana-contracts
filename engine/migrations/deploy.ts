import * as anchor from "@coral-xyz/anchor";
import { Command } from "commander";
import EngineSDK from "../ts-sdk/src/engine";
import * as fs from "fs";

function parseArgs() {
  const program = new Command();
  program
    .allowExcessArguments(false)
    .option("--treasury <pubkey>")
    .option("--fee <u64>", "0")
    .option("--admins <pubkeys>")
    .option("--threshold <num>", "2")
    .option("--admin-key <path>", undefined, (val, acc: string[]) => { acc.push(val); return acc; }, [] as string[])
    .option("--payload <path>");
  program.parse(process.argv);
  const opts = program.opts();
  let admins = (opts.admins ? String(opts.admins) : "").split(",").map((s: string) => s.trim()).filter(Boolean);
  let treasury = opts.treasury ? String(opts.treasury) : "";
  let feeRaw: any = (opts.fee !== undefined && opts.fee !== null) ? opts.fee : "0";
  let thresholdNum = Number(opts.threshold);
  let adminKeyPaths: string[] = opts.adminKey as string[];
  let xyberMintStr: string | undefined;
  if (opts.payload) {
    const raw = fs.readFileSync(String(opts.payload), "utf8");
    const payload = JSON.parse(raw);
    admins = (payload.admins || admins).map((s: string) => String(s));
    treasury = String(payload.treasury || treasury);
    if (payload.feeU64 !== undefined && payload.feeU64 !== null) feeRaw = payload.feeU64;
    if (payload.threshold !== undefined) thresholdNum = Number(payload.threshold);
    if (Array.isArray(payload.adminKeyPaths) && payload.adminKeyPaths.length) adminKeyPaths = payload.adminKeyPaths.map((p: string) => String(p));
    if (payload.xyberMint) xyberMintStr = String(payload.xyberMint);
  }
  const feeU64 = BigInt(String(feeRaw ?? "0"));
  if (admins.length !== 3) throw new Error("--admins must contain exactly 3 pubkeys (or provide --payload with admins)");
  if (!treasury) throw new Error("--treasury is required (or provide --payload with treasury)");
  if (![2, 3].includes(thresholdNum)) throw new Error("--threshold must be 2 or 3");
  if (feeU64 < BigInt(0)) throw new Error("--fee must be >= 0");
  return { treasury, admins, thresholdNum, feeU64, adminKeyPaths, xyberMintStr };
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
  const sdk = EngineSDK.create(provider as any, programAny as any);
  const adminPks = args.admins.map((s) => new anchor.web3.PublicKey(s)) as [anchor.web3.PublicKey, anchor.web3.PublicKey, anchor.web3.PublicKey];
  const adminKeypairs = (args.adminKeyPaths || []).map(loadKeypair);
  const payloadMint = args.xyberMintStr || (process as any).env.XYBER_MINT || undefined;
  const res = await (sdk as any).initEngineConfig({
    treasury: new anchor.web3.PublicKey(args.treasury),
    creationFee: new anchor.BN(args.feeU64.toString()),
    xyberMint: payloadMint ? new anchor.web3.PublicKey(String(payloadMint)) : undefined,
    admins: adminPks,
    threshold: args.thresholdNum,
    adminKeypairs,
  });
  console.log(`EngineConfig: ${res.engineConfig.toBase58()}`);
  console.log(`Signature: ${res.signature}`);
};

if (require.main === module) {
  const provider = (anchor as any).AnchorProvider.env();
  (module.exports as any)(provider).catch((e: any) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
