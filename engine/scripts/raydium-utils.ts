import * as anchor from "@coral-xyz/anchor";
import { ClmmConfigLayout } from "@raydium-io/raydium-sdk-v2";

export function getRaydiumCluster(provider: anchor.AnchorProvider): "mainnet" | "devnet" {
  const endpoint = provider.connection.rpcEndpoint;
  if (endpoint.includes('mainnet')) return 'mainnet';
  return 'devnet';
}

export type AmmConfigInfo = ReturnType<typeof ClmmConfigLayout.decode>;

export async function fetchAmmConfig(
  connection: anchor.web3.Connection,
  ammConfigAddress: anchor.web3.PublicKey
): Promise<AmmConfigInfo> {
  const accountInfo = await connection.getAccountInfo(ammConfigAddress);
  if (!accountInfo) {
    throw new Error(`AmmConfig account not found: ${ammConfigAddress.toString()}`);
  }
  return ClmmConfigLayout.decode(accountInfo.data);
}
