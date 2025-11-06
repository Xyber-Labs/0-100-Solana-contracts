import * as anchor from "@coral-xyz/anchor";
import { Command } from "commander";
import * as fs from "fs";
import {
  createInitializeMintInstruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

function parseArgs() {
  const program = new Command();
  program
    .allowExcessArguments(false)
    .option("--out <path>", "tmp/predeploy.json")
    .option("--airdrop <sol>", "2")
    .option("--supply <u64>", "1000000000")
    .option("--decimals <num>", "9");
  program.parse(process.argv);
  const opts = program.opts();
  const outPath = String(opts.out);
  const airdropSol = Number(opts.airdrop);
  const supply = BigInt(String(opts.supply));
  const decimals = Number(opts.decimals);
  if (!Number.isFinite(airdropSol) || airdropSol < 0) throw new Error("--airdrop must be >= 0");
  if (!Number.isFinite(decimals) || decimals < 0 || decimals > 9) throw new Error("--decimals must be 0..9");
  return { outPath, airdropSol, supply, decimals };
}

function ensureDir(path: string) {
  const dir = require("path").dirname(path);
  fs.mkdirSync(dir, { recursive: true });
}

function writeKeypair(path: string, kp: anchor.web3.Keypair) {
  ensureDir(path);
  fs.writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));
}

async function createMint(params: {
  provider: anchor.AnchorProvider;
  mint: anchor.web3.Keypair;
  mintAuthority: anchor.web3.PublicKey;
  decimals: number;
}) {
  const rent = await params.provider.connection.getMinimumBalanceForRentExemption(82);
  const tx = new anchor.web3.Transaction()
    .add(anchor.web3.SystemProgram.createAccount({
      fromPubkey: params.provider.wallet.publicKey,
      newAccountPubkey: params.mint.publicKey,
      space: 82,
      lamports: rent,
      programId: TOKEN_PROGRAM_ID,
    }))
    .add(createInitializeMintInstruction(params.mint.publicKey, params.decimals, params.mintAuthority, null));
  await params.provider.sendAndConfirm(tx, [params.mint]);
}

async function createAtaIfMissing(params: {
  provider: anchor.AnchorProvider;
  owner: anchor.web3.PublicKey;
  mint: anchor.web3.PublicKey;
  payer?: anchor.web3.PublicKey;
}) {
  const payer = params.payer ?? params.provider.wallet.publicKey;
  const ata = getAssociatedTokenAddressSync(params.mint, params.owner, true);
  const info = await params.provider.connection.getAccountInfo(ata);
  if (!info) {
    const ix = createAssociatedTokenAccountInstruction(payer, ata, params.owner, params.mint);
    await params.provider.sendAndConfirm(new anchor.web3.Transaction().add(ix), []);
  }
  return ata;
}

module.exports = async function (provider: anchor.AnchorProvider) {
  anchor.setProvider(provider);
  const { outPath, airdropSol, supply, decimals } = parseArgs();
  const admin1 = anchor.web3.Keypair.generate();
  const admin2 = anchor.web3.Keypair.generate();
  const admin3 = anchor.web3.Keypair.generate();
  if (airdropSol > 0) {
    const lamports = BigInt(airdropSol * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(admin1.publicKey, Number(lamports));
    await provider.connection.requestAirdrop(admin2.publicKey, Number(lamports));
    await provider.connection.requestAirdrop(admin3.publicKey, Number(lamports));
  }
  const mint = anchor.web3.Keypair.generate();
  await createMint({ provider, mint, mintAuthority: provider.wallet.publicKey, decimals });
  const admin1Ata = await createAtaIfMissing({ provider, owner: admin1.publicKey, mint: mint.publicKey });
  const admin2Ata = await createAtaIfMissing({ provider, owner: admin2.publicKey, mint: mint.publicKey });
  const admin3Ata = await createAtaIfMissing({ provider, owner: admin3.publicKey, mint: mint.publicKey });
  if (supply > BigInt(0)) {
    const mintIx = createMintToInstruction(mint.publicKey, admin1Ata, provider.wallet.publicKey, supply);
    await provider.sendAndConfirm(new anchor.web3.Transaction().add(mintIx), []);
  }
  const baseDir = require("path").join(process.cwd(), "tmp");
  ensureDir(baseDir + "/a");
  const admin1Path = require("path").join(baseDir, "admin-1.json");
  const admin2Path = require("path").join(baseDir, "admin-2.json");
  const admin3Path = require("path").join(baseDir, "admin-3.json");
  const mintPath = require("path").join(baseDir, "xyber-mint.json");
  writeKeypair(admin1Path, admin1);
  writeKeypair(admin2Path, admin2);
  writeKeypair(admin3Path, admin3);
  writeKeypair(mintPath, mint);
  const payload = {
    xyberMint: mint.publicKey.toBase58(),
    admins: [admin1.publicKey.toBase58(), admin2.publicKey.toBase58(), admin3.publicKey.toBase58()],
    adminKeyPaths: [admin1Path, admin2Path, admin3Path],
    treasury: admin2.publicKey.toBase58(),
    feeU64: "0",
    threshold: 2,
    atAs: {
      admin1: admin1Ata.toBase58(),
      admin2: admin2Ata.toBase58(),
      admin3: admin3Ata.toBase58(),
    },
  };
  ensureDir(outPath);
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`predeploy payload written to ${outPath}`);
  console.log(`admins ${payload.admins.join(",")}`);
  console.log(`treasury ${payload.treasury}`);
  console.log(`xyberMint ${payload.xyberMint}`);
};

if (require.main === module) {
  const provider = anchor.AnchorProvider.env();
  (module.exports as any)(provider).catch((e: any) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}

