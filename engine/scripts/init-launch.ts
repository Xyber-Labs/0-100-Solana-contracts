import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Engine } from "../target/types/engine";
import EngineSDK from "../ts-sdk/src/engine";
import { Command } from "commander";

const program = new Command();

program
  .option("--hard-cap <lamports>", "Hard cap in lamports", "100000000000")
  .option("--min-raise <lamports>", "Min raise in lamports", "10000000000")
  .option("--per-wallet-cap <lamports>", "Per wallet cap in lamports", "5000000000")
  .option("--tau <lamports>", "Tau in lamports", "1000000000")
  .option("--sale-allocation <amount>", "Sale allocation", "1000000")
  .option("--lp-allocation <amount>", "LP allocation", "500000")
  .option("--funding-duration-sec <seconds>", "Funding duration in seconds", "10")
  .parse(process.argv);

const opts = program.opts();

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const engineProgram = anchor.workspace.engine as Program<Engine>;
  const sdk = EngineSDK.create(provider, engineProgram);

  console.log("Testing init_launch with parameters:");
  console.log("  Hard cap:", opts.hardCap);
  console.log("  Min raise:", opts.minRaise);
  console.log("  Per wallet cap:", opts.perWalletCap);
  console.log("  Tau:", opts.tau);
  console.log("  Sale allocation:", opts.saleAllocation);
  console.log("  LP allocation:", opts.lpAllocation);
  console.log("  Funding duration (sec):", opts.fundingDurationSec);

  const saleMint = anchor.web3.Keypair.generate();
  console.log("Generated sale mint:", saleMint.publicKey.toBase58());

  const [launchState] = sdk.getLaunchPda(saleMint.publicKey);
  const [escrow] = sdk.getEscrowPda(launchState);
  const [projectCounter] = sdk.getProjectCounterPda();
  const [mintAuth] = sdk.getMintAuthPda(launchState);

  console.log("PDAs:");
  console.log("  Launch state:", launchState.toBase58());
  console.log("  Escrow:", escrow.toBase58());
  console.log("  Project counter:", projectCounter.toBase58());
  console.log("  Mint authority:", mintAuth.toBase58());

  console.log("Sending transaction...");

  try {
    const result = await sdk.initLaunchTx({
      admin: provider.wallet.publicKey,
      saleMint: saleMint,
      hardCapLamports: new anchor.BN(opts.hardCap),
      minRaiseLamports: new anchor.BN(opts.minRaise),
      perWalletCap: new anchor.BN(opts.perWalletCap),
      tauLamports: new anchor.BN(opts.tau),
      saleAllocation: new anchor.BN(opts.saleAllocation),
      lpAllocation: new anchor.BN(opts.lpAllocation),
      fundingDurationSec: new anchor.BN(opts.fundingDurationSec),
      provider,
    });

    const signature = await provider.sendAndConfirm(result.transaction, result.signers);
    console.log("✅ Success! Transaction signature:", signature);

    const launchAccount = await sdk.fetchLaunch(launchState);
    console.log("Launch state created:");
    console.log("  Project ID:", launchAccount.projectId.toString());
    console.log("  Admin:", launchAccount.admin.toBase58());
    console.log("  Hard cap:", launchAccount.hardCapLamports.toString());
    console.log("  Funding period end:", new Date(launchAccount.fundingPeriodEnd.toNumber() * 1000).toISOString());
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

main();
