import * as anchor from "@coral-xyz/anchor";

import EngineSDK, { getExplorerUrl } from "@xyber-labs/0-100-sdk";

export { getExplorerUrl };

export function initializeSdk() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const engineProgram = anchor.workspace.engine;
  const sdk = EngineSDK.create(provider, engineProgram);
  return { provider, sdk };
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
