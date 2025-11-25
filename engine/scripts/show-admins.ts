import * as anchor from "@coral-xyz/anchor";
import { Command } from "commander";
import EngineSDK from "../ts-sdk/src/engine";

function parseArgs() {
  const program = new Command();
  program.allowExcessArguments(false);
  program.parse(process.argv);
}

async function loadEngineConfig() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const engineProgram = (anchor.workspace as any).engine;
  const sdk = EngineSDK.create(provider, engineProgram);
  const [configPda] = sdk.getConfigPda();
  const config = await (sdk.program.account as any).engineConfig.fetch(configPda);
  return { provider, configPda, config };
}

function printEngineConfig(params: { provider: anchor.AnchorProvider; configPda: anchor.web3.PublicKey; config: any }) {
  console.log("RPC endpoint:", params.provider.connection.rpcEndpoint);
  console.log("Provider wallet:", params.provider.wallet.publicKey.toBase58());
  console.log("Engine config PDA:", params.configPda.toBase58());
  console.log("Treasury:", params.config.treasury.toBase58());
  console.log("Creation fee:", params.config.creationFee.toString());
  console.log("XYBER mint:", params.config.xyberMint.toBase58());
  console.log("Admins:");
  params.config.admins.forEach((key: anchor.web3.PublicKey, index: number) => {
    console.log(`  Admin ${index + 1}:`, key.toBase58());
  });
  console.log("Threshold:", params.config.threshold);
}

async function main() {
  parseArgs();
  const { provider, configPda, config } = await loadEngineConfig();
  printEngineConfig({ provider, configPda, config });
}

main().catch(error => {
  console.error("❌ Failed to load engine config");
  console.error(error);
  process.exit(1);
});


