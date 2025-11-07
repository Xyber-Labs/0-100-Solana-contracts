import * as anchor from "@coral-xyz/anchor";
import { Command } from "commander";
import EngineSDK from "../ts-sdk/src/engine";
import * as fs from "fs";

function parseArgs() {
  const program = new Command();
  program
    .allowExcessArguments(false)
    .option("--fee <u64>", "100000000000")
    .option("--xyber-mint <pubkey>")
    .option("--admin-key <path>", undefined, (val, acc: string[]) => { acc.push(val); return acc; }, [] as string[])
    .option("--payload <path>");
  program.parse(process.argv);
  const opts = program.opts();
  let feeRaw: any = (opts.fee !== undefined && opts.fee !== null) ? opts.fee : "100000000000";
  let adminKeyPaths: string[] = opts.adminKey as string[];
  let xyberMintStr: string | undefined = opts.xyberMint ? String(opts.xyberMint) : undefined;
  if (opts.payload) {
    const raw = fs.readFileSync(String(opts.payload), "utf8");
    const payload = JSON.parse(raw);
    if (payload.feeU64 !== undefined && payload.feeU64 !== null) feeRaw = payload.feeU64;
    if (Array.isArray(payload.adminKeyPaths) && payload.adminKeyPaths.length) adminKeyPaths = payload.adminKeyPaths.map((p: string) => String(p));
    if (payload.xyberMint) xyberMintStr = String(payload.xyberMint);
  }
  const feeU64 = BigInt(String(feeRaw ?? "100000000000"));
  if (feeU64 < BigInt(0)) throw new Error("--fee must be >= 0");
  return { feeU64, adminKeyPaths, xyberMintStr };
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
  const adminKeypairs = (args.adminKeyPaths || []).map(loadKeypair);
  const newMint = args.xyberMintStr ? new anchor.web3.PublicKey(String(args.xyberMintStr)) : undefined;
  const res = await (sdk as any).updateEngineConfig({
    newCreationFee: new anchor.BN(args.feeU64.toString()),
    newXyberMint: newMint,
    
    signerAdmins: adminKeypairs,
  });
  console.log(`EngineConfig: ${res.engineConfig.toBase58()}`);
  console.log(`Signature: ${res.signature}`);
  const cfg = await (programAny.account as any).engineConfig.fetch(res.engineConfig);
  console.log("EngineConfig after update:");
  console.log(`  treasury: ${cfg.treasury.toBase58()}`);
  console.log(`  creationFee: ${cfg.creationFee.toString()}`);
  console.log(`  xyberMint: ${cfg.xyberMint.toBase58()}`);
  console.log(`  admins: ${(cfg.admins || []).map((k: any) => k.toBase58()).join(", ")}`);
  console.log(`  threshold: ${cfg.threshold}`);
};

if (require.main === module) {
  const provider = (anchor as any).AnchorProvider.env();
  (module.exports as any)(provider).catch((e: any) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
