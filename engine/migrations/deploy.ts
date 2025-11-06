// Migrations are an early feature. Currently, they're nothing more than this
// single deploy script that's invoked from the CLI, injecting a provider
// configured from the workspace's Anchor.toml.

import * as anchor from "@coral-xyz/anchor";
import { Command } from "commander";
import EngineSDK from "../ts-sdk/src/engine";
import * as fs from "fs";

function parseArgs() {
  const program = new Command();
  program
    .allowExcessArguments(false)
    .requiredOption("--treasury <pubkey>")
    .option("--fee <u64>", "0")
    .requiredOption("--admins <pubkeys>")
    .option("--threshold <num>", "2")
    .option("--admin-key <path>", undefined, (val, acc: string[]) => { acc.push(val); return acc; }, [] as string[]);
  program.parse(process.argv);
  const opts = program.opts();
  const admins = String(opts.admins).split(",").map((s: string) => s.trim()).filter(Boolean);
  if (admins.length !== 3) throw new Error("--admins must contain exactly 3 pubkeys");
  const thresholdNum = Number(opts.threshold);
  if (![2, 3].includes(thresholdNum)) throw new Error("--threshold must be 2 or 3");
  const feeU64 = BigInt(String(opts.fee));
  if (feeU64 < 0n) throw new Error("--fee must be >= 0");
  return { treasury: String(opts.treasury), admins, thresholdNum, feeU64, adminKeyPaths: opts.adminKey as string[] };
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
  const programAny: any = (anchor.workspace as any).Engine || new anchor.Program(idl as any, (idl as any).metadata.address, provider);
  const sdk = EngineSDK.create(provider, programAny);
  const adminPks = args.admins.map((s) => new anchor.web3.PublicKey(s)) as [anchor.web3.PublicKey, anchor.web3.PublicKey, anchor.web3.PublicKey];
  const adminKeypairs = (args.adminKeyPaths || []).map(loadKeypair);
  const res = await sdk.initEngineConfig({
    treasury: new anchor.web3.PublicKey(args.treasury),
    creationFee: new anchor.BN(args.feeU64.toString()),
    admins: adminPks,
    threshold: args.thresholdNum,
    adminKeypairs,
  });
  console.log(`EngineConfig: ${res.engineConfig.toBase58()}`);
  console.log(`Signature: ${res.signature}`);
};
