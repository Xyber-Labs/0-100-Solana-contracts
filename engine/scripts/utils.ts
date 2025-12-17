import * as anchor from "@coral-xyz/anchor";
import EngineSDK from "../ts-sdk/src/engine";

export function initializeSdk() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const engineProgram = anchor.workspace.Engine;
  const sdk = EngineSDK.create(provider, engineProgram);
  return { provider, sdk };
}

function getCluster(provider: anchor.AnchorProvider): string {
  const endpoint = provider.connection.rpcEndpoint;
  if (endpoint.includes('devnet')) return 'devnet';
  if (endpoint.includes('testnet')) return 'testnet';
  if (endpoint.includes('localhost') || endpoint.includes('127.0.0.1')) {
    return 'custom&customUrl=' + encodeURIComponent(endpoint);
  }
  return 'mainnet-beta';
}

export function getExplorerUrl(provider: anchor.AnchorProvider, signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=${getCluster(provider)}`;
}

export function getAccountUrl(provider: anchor.AnchorProvider, address: anchor.web3.PublicKey): string {
  return `https://explorer.solana.com/address/${address.toString()}?cluster=${getCluster(provider)}`;
}

export async function runWithSdk(
  fn: (ctx: { provider: anchor.AnchorProvider; sdk: ReturnType<typeof EngineSDK.create> }) => Promise<void>
): Promise<void> {
  try {
    const { provider, sdk } = initializeSdk();
    await fn({ provider, sdk });
  } catch (error) {
    console.error("❌ Transaction failed:");
    console.error(error);
    if (error.logs) {
      console.error("Program logs:");
      error.logs.forEach((log: string) => console.error(log));
    }
    process.exit(1);
  }
}

export async function findProject(
  sdk: ReturnType<typeof EngineSDK.create>,
  projectId: number
): Promise<{ launchPda: anchor.web3.PublicKey; projectId: number }> {
  console.log(`Finding project #${projectId}...`);
  const project = await sdk.findProjectById(projectId);
  if (!project) {
    console.error(`Project #${projectId} not found`);
    process.exit(1);
  }
  console.log("Found launch state:", project.launchPda.toBase58());
  return project;
}

export function loadKeypair(keyPath: string): anchor.web3.Keypair {
  const fs = require("fs");
  const raw = fs.readFileSync(keyPath, "utf8");
  const arr = JSON.parse(raw);
  const secret = Uint8Array.from(arr);
  return anchor.web3.Keypair.fromSecretKey(secret);
}

export function toPublicKey(acc: unknown): anchor.web3.PublicKey {
  if (!acc) throw new Error("Cannot convert null/undefined to PublicKey");
  if ((acc as any)._bn) return acc as anchor.web3.PublicKey;
  if ((acc as any).pubkey) return new anchor.web3.PublicKey((acc as any).pubkey);
  if ((acc as any).address) return new anchor.web3.PublicKey((acc as any).address);
  if (typeof acc === "string") return new anchor.web3.PublicKey(acc);
  return new anchor.web3.PublicKey(acc as any);
}
