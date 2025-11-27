import * as anchor from "@coral-xyz/anchor";
import EngineSDK from "@xyber-labs/0-100-sdk";

export function initializeSdk() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const engineProgram = anchor.workspace.Engine;
  const sdk = EngineSDK.create(provider, engineProgram);
  return { provider, sdk };
}

export function getExplorerUrl(provider: anchor.AnchorProvider, signature: string): string {
  const cluster = provider.connection.rpcEndpoint.includes('devnet') ? 'devnet'
    : provider.connection.rpcEndpoint.includes('testnet') ? 'testnet'
      : provider.connection.rpcEndpoint.includes('localhost') || provider.connection.rpcEndpoint.includes('127.0.0.1') ? 'custom&customUrl=' + encodeURIComponent(provider.connection.rpcEndpoint)
        : 'mainnet-beta';

  return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
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
