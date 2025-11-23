import * as anchor from "@coral-xyz/anchor";
import { IncomeDispatcherSDK } from "@xyber-labs/0-100-sdk";

export function initializeDispatcherSdk(admin: anchor.web3.Keypair) {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.incomeDispatcher;
  const sdk = IncomeDispatcherSDK.create(provider, program, admin);
  return { provider, sdk };
}

export async function runWithDispatcherSdk(
  admin: anchor.web3.Keypair,
  fn: (ctx: { provider: anchor.AnchorProvider; sdk: ReturnType<typeof IncomeDispatcherSDK.create> }) => Promise<void>
): Promise<void> {
  try {
    const { provider, sdk } = initializeDispatcherSdk(admin);
    await fn({ provider, sdk });
  } catch (error: any) {
    console.error("❌ Transaction failed:");
    console.error(error);
    if (error.logs) {
      console.error("Program logs:");
      error.logs.forEach((log: string) => console.error(log));
    }
    process.exit(1);
  }
}
