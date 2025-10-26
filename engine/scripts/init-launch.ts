import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Command } from "commander";
import EngineSDK from "0-100-sdk";

async function main() {
  const opts = parseArgs();

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const engineProgram = anchor.workspace.engine;
  const sdk = EngineSDK.create(provider, engineProgram);

  printParameters(opts);

  const saleMint = anchor.web3.Keypair.generate();
  const launchState = printPdas(sdk, saleMint.publicKey);

  console.log("Sending transaction...");

  try {
    const result = await sdk.initLaunchTx({
      creator: provider.wallet.publicKey,
      saleMint: saleMint,
      hardCapLamports: new BN(opts.hardCap),
      minRaiseLamports: new BN(opts.minRaise),
      perWalletCap: new BN(opts.perWalletCap),
      tauLamports: new BN(opts.tau),
      saleAllocation: new BN(opts.saleAllocation),
      lpAllocation: new BN(opts.lpAllocation),
      fundingDurationSeconds: parseInt(opts.fundingDurationSec),
      rosterShardCap: parseInt(opts.rosterShardCap),
      creatorInitialDepositLamports: new BN(opts.creatorInitialDeposit),
      creatorDailyLamportsLimit: new BN(opts.creatorDailyLimit),
      creatorClaimLockPeriodSec: new BN(opts.creatorLockPeriod),
      provider,
    });

    const signature = await provider.sendAndConfirm(result.initLaunchTx, result.signers);

    console.log("✅ Success!");
    console.log("Transaction signature:", signature);
    console.log("Explorer:", getExplorerUrl(provider, signature));

    await printLaunchInfo(sdk, launchState);
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

function parseArgs() {
  const program = new Command();

  program
    .option("--hard-cap <lamports>", "Hard cap in lamports", "100000000000")
    .option("--min-raise <lamports>", "Min raise in lamports", "10000000000")
    .option("--per-wallet-cap <lamports>", "Per wallet cap in lamports", "5000000000")
    .option("--tau <lamports>", "Tau in lamports", "1000000000")
    .option("--sale-allocation <amount>", "Sale allocation", "1000000")
    .option("--lp-allocation <amount>", "LP allocation", "500000")
    .option("--funding-duration-sec <seconds>", "Funding duration in seconds", "10")
    .option("--roster-shard-cap <number>", "Roster shard cap", "100")
    .option("--creator-initial-deposit <lamports>", "Creator initial deposit in lamports", "1000000000")
    .option("--creator-daily-limit <lamports>", "Creator daily lamports limit", "10000000000")
    .option("--creator-lock-period <seconds>", "Creator claim lock period in seconds", "86400")
    .parse(process.argv);

  return program.opts();
}

function printParameters(opts: any) {
  console.log("Initializing launch with parameters:");
  console.log("  Hard cap:", opts.hardCap);
  console.log("  Min raise:", opts.minRaise);
  console.log("  Per wallet cap:", opts.perWalletCap);
  console.log("  Tau:", opts.tau);
  console.log("  Sale allocation:", opts.saleAllocation);
  console.log("  LP allocation:", opts.lpAllocation);
  console.log("  Funding duration (sec):", opts.fundingDurationSec);
  console.log("  Roster shard cap:", opts.rosterShardCap);
  console.log("  Creator initial deposit:", opts.creatorInitialDeposit);
  console.log("  Creator daily limit:", opts.creatorDailyLimit);
  console.log("  Creator lock period (sec):", opts.creatorLockPeriod);
}

function printPdas(sdk: any, saleMint: anchor.web3.PublicKey) {
  const [launchState] = sdk.getLaunchPda(saleMint);
  const [escrow] = sdk.getEscrowPda(launchState);
  const [projectCounter] = sdk.getProjectCounterPda();
  const [mintAuth] = sdk.getMintAuthPda(launchState);

  console.log("Generated sale mint:", saleMint.toBase58());
  console.log("PDAs:");
  console.log("  Launch state:", launchState.toBase58());
  console.log("  Escrow:", escrow.toBase58());
  console.log("  Project counter:", projectCounter.toBase58());
  console.log("  Mint authority:", mintAuth.toBase58());

  return launchState;
}

function getExplorerUrl(provider: anchor.AnchorProvider, signature: string): string {
  const cluster = provider.connection.rpcEndpoint.includes('devnet') ? 'devnet'
    : provider.connection.rpcEndpoint.includes('testnet') ? 'testnet'
      : provider.connection.rpcEndpoint.includes('localhost') || provider.connection.rpcEndpoint.includes('127.0.0.1') ? 'custom&customUrl=' + encodeURIComponent(provider.connection.rpcEndpoint)
        : 'mainnet-beta';

  return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
}

async function printLaunchInfo(sdk: any, launchState: anchor.web3.PublicKey) {
  const launchAccount = await sdk.fetchLaunch(launchState);
  console.log("Launch state created:");
  console.log("  Project ID:", launchAccount.projectId.toString());
  console.log("  Creator:", launchAccount.creator.toBase58());
  console.log("  Hard cap:", launchAccount.hardCapLamports.toString());
  console.log("  Funding period end:", new Date(launchAccount.fundingPeriodEnd.toNumber() * 1000).toISOString());
}


main();
