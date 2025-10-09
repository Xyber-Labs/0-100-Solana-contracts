import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Engine } from "../target/types/engine";
import EngineSDK from "../ts-sdk/src/engine";
import { Command } from "commander";

const program = new Command();

program
  .requiredOption("--action <type>", "Action to perform: deposit or display")
  .requiredOption("--project-id <number>", "Project ID")
  .option("--amount <lamports>", "Amount to deposit in lamports (required for deposit action)")
  .parse(process.argv);

const opts = program.opts();

function parseArgs() {
  const action = opts.action as string;
  if (!["deposit", "display"].includes(action)) {
    console.error("❌ --action must be either 'deposit' or 'display'");
    process.exit(1);
  }

  return {
    action: action as "deposit" | "display",
    projectId: parseInt(opts.projectId),
    amountLamports: opts.amount ? new anchor.BN(opts.amount) : null
  };
}

function initializeSdk() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const engineProgram = anchor.workspace.engine as Program<Engine>;
  const sdk = EngineSDK.create(provider, engineProgram);
  return { provider, sdk };
}

async function findProject(sdk: ReturnType<typeof EngineSDK.create>, projectId: number) {
  console.log(`Finding project #${projectId}...`);
  const project = await sdk.findProjectById(projectId);
  if (!project) {
    console.error(`Project #${projectId} not found`);
    process.exit(1);
  }
  console.log("Found launch state:", project.launchPda.toBase58());
  return project;
}

async function deposit(
  sdk: ReturnType<typeof EngineSDK.create>,
  provider: anchor.AnchorProvider,
  launchPda: anchor.web3.PublicKey,
  amountLamports: anchor.BN
) {
  console.log(`Depositing ${amountLamports.toNumber() / anchor.web3.LAMPORTS_PER_SOL} SOL...`);

  const result = await sdk.depositTx({
    launch: launchPda,
    amountLamports: amountLamports,
    userPubkey: provider.wallet.publicKey
  });

  const signature = await provider.sendAndConfirm(
    result.transaction,
    [(provider.wallet as any).payer]
  );

  console.log(`✅ Deposit successful: ${signature}`);

  return signature;
}

async function displayResults(
  sdk: ReturnType<typeof EngineSDK.create>,
  launchPda: anchor.web3.PublicKey,
  userPubkey: anchor.web3.PublicKey
) {
  const launchState = await sdk.fetchLaunch(launchPda);
  const userContribution = await sdk.fetchUserContribution(launchPda, userPubkey);

  console.log("\nLaunch state:");
  console.log(`  Total deposited: ${launchState.totalDeposited.toNumber() / anchor.web3.LAMPORTS_PER_SOL} SOL`);
  console.log(`  Hard cap: ${launchState.hardCapLamports.toNumber() / anchor.web3.LAMPORTS_PER_SOL} SOL`);
  console.log(`  Progress: ${(launchState.totalDeposited.toNumber() / launchState.hardCapLamports.toNumber() * 100).toFixed(2)}%`);

  console.log("\nYour deposit:");
  console.log(`  Amount: ${userContribution.deposited.toNumber() / anchor.web3.LAMPORTS_PER_SOL} SOL`);
}

async function main() {
  try {
    const args = parseArgs();
    const { provider, sdk } = initializeSdk();
    const project = await findProject(sdk, args.projectId);

    if (args.action === "display") {
      await displayResults(sdk, project.launchPda, provider.wallet.publicKey);
    } else if (args.action === "deposit") {
      if (!args.amountLamports) {
        console.error("❌ --amount is required for deposit action");
        process.exit(1);
      }
      await deposit(sdk, provider, project.launchPda, args.amountLamports);
      await displayResults(sdk, project.launchPda, provider.wallet.publicKey);
    }
  } catch (error) {
    console.error("\n❌ Transaction failed:");
    console.error(error);
    if (error.logs) {
      console.error("\nProgram logs:");
      error.logs.forEach((log: string) => console.error(log));
    }
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
