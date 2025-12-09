import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { Command } from "commander";
import { PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";

import { getExplorerUrl, loadKeypair } from "./utils";
import EngineSDK from "../ts-sdk/src/engine";
import IncomeDispatcherSDK from "../ts-sdk/src/income-dispatcher";
import type { IncomeDispatcher as IncomeDispatcherIDL } from "../ts-sdk/idl/income_dispatcher";

const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

const PERSONAL_POSITION_TICK_LOWER_OFFSET = 8 + 1 + 32 + 32;
const PERSONAL_POSITION_TICK_UPPER_OFFSET = PERSONAL_POSITION_TICK_LOWER_OFFSET + 4;
const TICK_ARRAY_SIZE = 60;

function tickArrayStartIndex(tickIndex: number, tickSpacing: number): number {
  const realSize = TICK_ARRAY_SIZE * tickSpacing;
  const divided = Math.floor(tickIndex / realSize);
  return divided * realSize;
}

async function main() {
  const program = new Command();

  program
    .allowExcessArguments(false)
    .requiredOption("--project-id <number>", "Project ID")
    .requiredOption("--payer-keypair <path>", "Path to payer keypair file")
    .parse(process.argv);

  const opts = program.opts();
  const payerKeypair = loadKeypair(opts.payerKeypair);
  const projectId = new BN(opts.projectId);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const engineProgram = anchor.workspace.Engine;
  const sdk = EngineSDK.create(provider, engineProgram);

  const dispatcherProgram: Program<IncomeDispatcherIDL> = anchor.workspace.IncomeDispatcher;
  const dispatcherSdk = IncomeDispatcherSDK.create(provider, dispatcherProgram);

  console.log("Harvesting CLMM fees for project:", projectId.toString());
  console.log("Payer:", payerKeypair.publicKey.toBase58());

  const [launchPda] = sdk.getLaunchPdaByProjectId(projectId);
  console.log("Launch PDA:", launchPda.toBase58());

  const launchState = await sdk.fetchLaunch(launchPda);

  const baseMint = launchState.baseMint as PublicKey | null;
  if (!baseMint) {
    console.error("Launch state does not have baseMint set. Pool must be created first.");
    process.exit(1);
  }
  console.log("Base mint:", baseMint.toBase58());

  const raydiumPoolState = launchState.raydiumPoolState as PublicKey | null;
  if (!raydiumPoolState) {
    console.error("Launch state does not have raydiumPoolState set. Pool must be created first.");
    process.exit(1);
  }
  console.log("Raydium pool state:", raydiumPoolState.toBase58());

  const raydiumPositionNftMint = launchState.raydiumPositionNftMint as PublicKey | null;
  if (!raydiumPositionNftMint) {
    console.error("Launch state does not have raydiumPositionNftMint set. Liquidity must be added first.");
    process.exit(1);
  }
  console.log("Raydium position NFT mint:", raydiumPositionNftMint.toBase58());

  const escrowAuthority = sdk.getEscrowAuthorityPda(launchPda)[0];
  console.log("Escrow authority:", escrowAuthority.toBase58());

  const raydiumClmmProgramId = sdk.getRaydiumClmmProgramId();

  const [personalPosition] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), raydiumPositionNftMint.toBuffer()],
    raydiumClmmProgramId
  );
  console.log("Personal position:", personalPosition.toBase58());

  const personalPositionAccount = await provider.connection.getAccountInfo(personalPosition);
  if (!personalPositionAccount) {
    console.error("Personal position account not found. Liquidity may not have been added.");
    process.exit(1);
  }

  const tickLowerIndex = personalPositionAccount.data.readInt32LE(PERSONAL_POSITION_TICK_LOWER_OFFSET);
  const tickUpperIndex = personalPositionAccount.data.readInt32LE(PERSONAL_POSITION_TICK_UPPER_OFFSET);
  console.log("Tick lower index:", tickLowerIndex);
  console.log("Tick upper index:", tickUpperIndex);

  const poolStateAccount = await provider.connection.getAccountInfo(raydiumPoolState);
  if (!poolStateAccount) {
    console.error("Pool state account not found");
    process.exit(1);
  }
  const tickSpacing = poolStateAccount.data.readUInt16LE(235);
  console.log("Tick spacing:", tickSpacing);

  const isQuoteSmaller = Buffer.compare(WSOL_MINT.toBuffer(), baseMint.toBuffer()) < 0;

  const [quoteVault] = sdk.getRaydiumPoolVaultPda(raydiumPoolState, WSOL_MINT);
  const [baseVault] = sdk.getRaydiumPoolVaultPda(raydiumPoolState, baseMint);

  const tokenVault0 = isQuoteSmaller ? quoteVault : baseVault;
  const tokenVault1 = isQuoteSmaller ? baseVault : quoteVault;
  console.log("Token vault 0:", tokenVault0.toBase58());
  console.log("Token vault 1:", tokenVault1.toBase58());

  const tickLowerBuffer = Buffer.alloc(4);
  tickLowerBuffer.writeInt32BE(tickLowerIndex, 0);
  const tickUpperBuffer = Buffer.alloc(4);
  tickUpperBuffer.writeInt32BE(tickUpperIndex, 0);

  const [protocolPosition] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_position"), raydiumPoolState.toBuffer(), tickLowerBuffer, tickUpperBuffer],
    raydiumClmmProgramId
  );
  console.log("Protocol position:", protocolPosition.toBase58());

  const tickArrayLowerStartIndex = tickArrayStartIndex(tickLowerIndex, tickSpacing);
  const tickArrayUpperStartIndex = tickArrayStartIndex(tickUpperIndex, tickSpacing);

  const tickArrayLowerStartBuffer = Buffer.alloc(4);
  tickArrayLowerStartBuffer.writeInt32BE(tickArrayLowerStartIndex, 0);
  const tickArrayUpperStartBuffer = Buffer.alloc(4);
  tickArrayUpperStartBuffer.writeInt32BE(tickArrayUpperStartIndex, 0);

  const [tickArrayLower] = PublicKey.findProgramAddressSync(
    [Buffer.from("tick_array"), raydiumPoolState.toBuffer(), tickArrayLowerStartBuffer],
    raydiumClmmProgramId
  );
  const [tickArrayUpper] = PublicKey.findProgramAddressSync(
    [Buffer.from("tick_array"), raydiumPoolState.toBuffer(), tickArrayUpperStartBuffer],
    raydiumClmmProgramId
  );
  console.log("Tick array lower:", tickArrayLower.toBase58());
  console.log("Tick array upper:", tickArrayUpper.toBase58());

  const raydiumPositionNftAccount = getAssociatedTokenAddressSync(
    raydiumPositionNftMint,
    escrowAuthority,
    true,
    TOKEN_2022_PROGRAM_ID
  );
  console.log("Raydium position NFT account:", raydiumPositionNftAccount.toBase58());

  const remainingAccounts: { pubkey: PublicKey; isWritable: boolean; isSigner: boolean }[] = [];

  const maxTickInBitmap = tickSpacing * 512 * 8;
  const needsExtension =
    tickArrayLowerStartIndex < -maxTickInBitmap ||
    tickArrayUpperStartIndex >= maxTickInBitmap ||
    tickArrayLowerStartIndex >= maxTickInBitmap ||
    tickArrayUpperStartIndex < -maxTickInBitmap;

  if (needsExtension) {
    const [tickArrayBitmapExtension] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool_tick_array_bitmap_extension"), raydiumPoolState.toBuffer()],
      raydiumClmmProgramId
    );
    console.log("Adding bitmap extension:", tickArrayBitmapExtension.toBase58());
    remainingAccounts.push({
      pubkey: tickArrayBitmapExtension,
      isWritable: true,
      isSigner: false,
    });
  }

  console.log("\nSending harvest transaction...");

  try {
    const tx = await dispatcherSdk.txBuilder.harvestPoolTx({
      payer: payerKeypair.publicKey,
      launchState: launchPda,
      projectId: launchState.projectId,
      baseMint,
      quoteMint: WSOL_MINT,
      engineProgram: engineProgram.programId,
      escrowAuthority,
      raydiumPositionNftMint,
      raydiumPositionNftAccount,
      personalPosition,
      raydiumPoolState,
      protocolPosition,
      tokenVault0,
      tokenVault1,
      tickArrayLower,
      tickArrayUpper,
      remainingAccounts,
    });

    const signature = await provider.sendAndConfirm(tx, [payerKeypair], {
      skipPreflight: true,
    });

    console.log("\n✅ Harvest successful!");
    console.log("Transaction signature:", signature);
    console.log("Explorer:", getExplorerUrl(provider, signature));

    const incomeConfig = await dispatcherSdk.fetchIncomeConfig(launchState.projectId);
    console.log("\n--- Harvested Totals ---");
    console.log("Total harvested base:", incomeConfig.totalHarvestedBase.toString());
    console.log("Total harvested quote:", incomeConfig.totalHarvestedQuote.toString());
  } catch (error: any) {
    console.error("\n❌ Harvest failed:", error.message);
    if (error.logs) {
      console.error("Program logs:");
      error.logs.forEach((log: string) => console.error(log));
    }
    process.exit(1);
  }
}

main();
