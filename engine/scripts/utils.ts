import * as anchor from "@coral-xyz/anchor";

import EngineSDK from "@xyber-labs/0-100-sdk";

export function initializeSdk() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const engineProgram = anchor.workspace.engine;
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
