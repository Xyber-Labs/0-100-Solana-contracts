import * as anchor from "@coral-xyz/anchor";
import { web3 } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createInitializeMintInstruction, createAssociatedTokenAccountInstruction, createMintToInstruction } from "@solana/spl-token";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { mplTokenMetadata, findMetadataPda, createMetadataAccountV3 } from "@metaplex-foundation/mpl-token-metadata";
import { keypairIdentity } from "@metaplex-foundation/umi";
import { fromWeb3JsKeypair, fromWeb3JsPublicKey, toWeb3JsPublicKey } from "@metaplex-foundation/umi-web3js-adapters";
import { Command } from "commander";

type Args = {
  name: string;
  symbol: string;
  uri: string;
  decimals: number;
  amount: string;
  recipient?: string;
};

function parseArgs(): Args {
  const program = new Command();
  program
    .requiredOption("--name <string>")
    .requiredOption("--symbol <string>")
    .requiredOption("--uri <string>")
    .option("--decimals <number>", "9")
    .option("--amount <string>", "0")
    .option("--recipient <string>");
  program.parse(process.argv);
  const opts = program.opts();
  return {
    name: String(opts.name),
    symbol: String(opts.symbol),
    uri: String(opts.uri),
    decimals: Number(opts.decimals ?? 9),
    amount: String(opts.amount ?? "0"),
    recipient: opts.recipient ? String(opts.recipient) : undefined,
  };
}

function getProvider(): anchor.AnchorProvider {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  return provider;
}

async function createMintAccount(provider: anchor.AnchorProvider, payer: web3.PublicKey, mintKeypair: web3.Keypair, decimals: number, mintAuthority: web3.PublicKey) {
  const lamports = await provider.connection.getMinimumBalanceForRentExemption(82);
  const createIx = web3.SystemProgram.createAccount({
    fromPubkey: payer,
    newAccountPubkey: mintKeypair.publicKey,
    space: 82,
    lamports,
    programId: TOKEN_PROGRAM_ID,
  });
  const initIx = createInitializeMintInstruction(mintKeypair.publicKey, decimals, mintAuthority, null, TOKEN_PROGRAM_ID);
  const tx = new web3.Transaction().add(createIx, initIx);
  tx.feePayer = payer;
  const sig = await provider.sendAndConfirm(tx, [mintKeypair]);
  try {
    // Ensure the mint is fully finalized on the cluster before proceeding (for devnet RPC consistency)
    // Fallback to old API signature-only confirmation if blockhash context is not available.
    // @ts-ignore
    await provider.connection.confirmTransaction(sig, "finalized");
  } catch (_) {}
  return sig;
}

async function createMetadata(provider: anchor.AnchorProvider, payerKeypair: web3.Keypair, mint: web3.PublicKey, name: string, symbol: string, uri: string) {
  const endpoint = (provider.connection as any)._rpcEndpoint ?? process.env.ANCHOR_PROVIDER_URL ?? "http://127.0.0.1:8899";
  const umi = createUmi(endpoint).use(mplTokenMetadata());
  umi.use(keypairIdentity(fromWeb3JsKeypair(payerKeypair)));
  const mintUmi = fromWeb3JsPublicKey(mint);
  const metadataPda = findMetadataPda(umi, { mint: mintUmi });
  const sig = await createMetadataAccountV3(umi, {
    metadata: metadataPda,
    mint: mintUmi,
    mintAuthority: umi.identity,
    payer: umi.identity,
    updateAuthority: umi.identity,
    data: {
      name,
      symbol,
      uri,
      sellerFeeBasisPoints: 0,
      creators: null,
      collection: null,
      uses: null,
    },
    isMutable: true,
    collectionDetails: null,
  }).sendAndConfirm(umi);
  return { metadata: toWeb3JsPublicKey(metadataPda[0]), sig };
}

async function ensureAtaAndMint(provider: anchor.AnchorProvider, payer: web3.PublicKey, recipient: web3.PublicKey, mint: web3.PublicKey, amount: number) {
  const ata = getAssociatedTokenAddressSync(mint, recipient, true);
  let info: any;
  try {
    info = await provider.connection.getAccountInfo(ata);
  } catch (_) {
    info = null;
  }
  const ixs: web3.TransactionInstruction[] = [];
  if (!info) {
    ixs.push(createAssociatedTokenAccountInstruction(payer, ata, recipient, mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
  }
  if (amount > 0) {
    ixs.push(createMintToInstruction(mint, ata, payer, amount, [], TOKEN_PROGRAM_ID));
  }
  if (ixs.length === 0) return ata;
  const tx = new web3.Transaction().add(...ixs);
  tx.feePayer = payer;
  const sig = await provider.sendAndConfirm(tx, []);
  try {
    // @ts-ignore
    await provider.connection.confirmTransactionSync(sig, "finalized");
  } catch (_) {}
  return ata;
}

async function main() {
  const args = parseArgs();
  const provider = getProvider();
  const payer = provider.publicKey!;
  const payerKeypair = (provider.wallet as any)?.payer as web3.Keypair;
  const mintKeypair = web3.Keypair.generate();
  const sigCreateMint = await createMintAccount(provider, payer, mintKeypair, args.decimals, payer);
  console.log(`created mint ${mintKeypair.publicKey.toBase58()} sig=${sigCreateMint}`);
  const { metadata } = await createMetadata(provider, payerKeypair, mintKeypair.publicKey, args.name, args.symbol, args.uri);
  console.log(`created metadata ${metadata.toBase58()}`);
  const recipient = args.recipient ? new web3.PublicKey(args.recipient) : payer;
  const amount = Number(args.amount);
  const ata = await ensureAtaAndMint(provider, payer, recipient, mintKeypair.publicKey, amount);
  try {
    const mintInfo = await provider.connection.getAccountInfo(mintKeypair.publicKey);
    const ataInfo = await provider.connection.getAccountInfo(ata);
    console.log(`mint.owner=${mintInfo?.owner?.toBase58?.() ?? "N/A"} lamports=${mintInfo?.lamports ?? 0}`);
    console.log(`ata.owner=${ataInfo?.owner?.toBase58?.() ?? "N/A"} lamports=${ataInfo?.lamports ?? 0}`);
  } catch (_) {}
  if (amount > 0) {
    try {
      const bal = await provider.connection.getTokenAccountBalance(ata);
      console.log(`minted amount=${bal.value.amount} decimals=${bal.value.decimals} to ata=${ata.toBase58()}`);
    } catch (_) {
      console.log(`minted to ata=${ata.toBase58()}`);
    }
  } else {
    console.log(`created ATA=${ata.toBase58()} (amount=0)`);
  }
  const clusterParam = (process.env.ANCHOR_PROVIDER_URL ?? "").includes("devnet") ? "?cluster=devnet" : "";
  console.log(`mint=${mintKeypair.publicKey.toBase58()} metadata=${metadata.toBase58()}`);
  console.log(`explorer mint: https://explorer.solana.com/address/${mintKeypair.publicKey.toBase58()}${clusterParam}`);
  console.log(`explorer metadata: https://explorer.solana.com/address/${metadata.toBase58()}${clusterParam}`);
  console.log(`explorer ata: https://explorer.solana.com/address/${ata.toBase58()}${clusterParam}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


