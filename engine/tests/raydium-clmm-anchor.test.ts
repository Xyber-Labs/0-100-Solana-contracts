import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  TOKEN_PROGRAM_ID
} from "@solana/spl-token";

import { Engine } from "../target/types/engine";
import EngineSDK from "../ts-sdk/src/engine";
import { assert } from "chai";


function getExplorerUrl(provider, signature) {
  const cluster = provider.connection.rpcEndpoint.includes('devnet') ? 'devnet'
    : provider.connection.rpcEndpoint.includes('testnet') ? 'testnet'
      : provider.connection.rpcEndpoint.includes('localhost') || provider.connection.rpcEndpoint.includes('127.0.0.1') ? 'custom&customUrl=' + encodeURIComponent(provider.connection.rpcEndpoint)
        : 'mainnet-beta';
  return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
}

describe("engine anchor - raydium clmm", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Engine as Program<Engine>;
  const admin = provider.wallet;
  const adminKeypair = (provider.wallet as any).payer;
  const sdk = EngineSDK.create(provider as any, program as any, adminKeypair);

  let clmmSaleMint: anchor.web3.Keypair;
  let clmmLaunchState: anchor.web3.PublicKey;
  let baseMintKeypair: anchor.web3.Keypair;
  const WSOL_MINT = new anchor.web3.PublicKey("So11111111111111111111111111111111111111112");
  const MIN_RAISE_LAMPORTS = new anchor.BN(10 * anchor.web3.LAMPORTS_PER_SOL);
  const PER_WALLET_CAP = new anchor.BN(5 * anchor.web3.LAMPORTS_PER_SOL);
  const TAU_LAMPORTS = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);
  const ROSTER_SHARD_CAP = 100;
  const CLMM_HARD_CAP = new anchor.BN(500 * anchor.web3.LAMPORTS_PER_SOL);
  const CLMM_SALE_ALLOCATION = new anchor.BN(540_540_000);
  const CLMM_LP_ALLOCATION = new anchor.BN(459_460_000);

  before(async () => {
  });

  it("Initializes launch and collects deposits", async () => {
    console.log("=== Initializing Launch ===");

    clmmSaleMint = anchor.web3.Keypair.generate();

    const { initLaunchTx, signers, launchState } = await sdk.initLaunchTx({
      creator: admin.publicKey,
      saleMint: clmmSaleMint,
      hardCapLamports: CLMM_HARD_CAP,
      minRaiseLamports: MIN_RAISE_LAMPORTS,
      perWalletCap: PER_WALLET_CAP,
      tauLamports: TAU_LAMPORTS,
      saleAllocation: CLMM_SALE_ALLOCATION,
      lpAllocation: CLMM_LP_ALLOCATION,
      fundingDurationSeconds: 3600,
      rosterShardCap: ROSTER_SHARD_CAP,
      creatorInitialDepositLamports: new anchor.BN(0),
      creatorDailyLamportsLimit: new anchor.BN(0),
      creatorClaimLockPeriodSec: new anchor.BN(2),
      provider,
    });

    clmmLaunchState = launchState;

    console.log("Launch state PDA:", clmmLaunchState.toString());
    console.log("Sale mint:", clmmSaleMint.publicKey.toString());

    const initLaunchSignature = await provider.sendAndConfirm(initLaunchTx, [adminKeypair, ...signers]);
    console.log("✅ Launch initialized:", initLaunchSignature);

    const launchStateData = await sdk.fetchLaunch(clmmLaunchState);
    console.log("Launch state verified:", launchStateData.projectId.toString());

    await sdk.initRoster({ launch: clmmLaunchState, signers: [adminKeypair] });
    await sdk.initRosterShard({ launch: clmmLaunchState, shardId: 0 });

    const targetRaise = 300;
    console.log(`Target raise: ${targetRaise} SOL (fixed for testing)`);

    const numDeposits = Math.ceil(targetRaise / (PER_WALLET_CAP.toNumber() / anchor.web3.LAMPORTS_PER_SOL));
    const batchSize = 10;
    console.log(`Making ${numDeposits} deposits in batches of ${batchSize}...`);
  });

  it("Creates CLMM pool and adds liquidity in separate transactions", async () => {
    console.log("=== Creating CLMM Pool and Adding Liquidity (Separate Transactions) ===");

    console.log("Raydium CLMM setup:");


    console.log("\n=== Creating Quote Mint (SPL token) ===");

    console.log("\n=== Ensuring Raydium Token Ordering (Base must be token_1) ===");
    baseMintKeypair = anchor.web3.Keypair.generate();
    console.log("Base Mint:", baseMintKeypair.publicKey.toString());

    const quoteAmountLamports = new anchor.BN(300000000000);

    let createPoolResultTx = await sdk.createClmmPoolTx({
      payer: admin.publicKey,
      launch: clmmLaunchState,
      quoteMint: WSOL_MINT,
      baseMint: baseMintKeypair,
      provider,
    });

    console.log("Pool will be created at:", createPoolResultTx.poolState.toString());


    console.log("\n=== Sending CreatePool transaction ===");
    console.log(`Instructions: ${createPoolResultTx.transaction.instructions.length}`);
    console.log(`Signers: ${createPoolResultTx.signers.length + 1}`);

    const createPoolSig = await provider.sendAndConfirm(
      createPoolResultTx.transaction,
      [adminKeypair, ...createPoolResultTx.signers],
      { skipPreflight: true }
    );


    console.log("\n=== Getting Liquidity Range ===");
    const liquidityRange = await sdk.getLiquidityRange({
      launch: clmmLaunchState
    });
    console.log(`Liquidity range: tickArrayLower=${liquidityRange.tickArrayLower}, tickArrayUpper=${liquidityRange.tickArrayUpper}`);
    console.log(`Tick array indices: lower=${liquidityRange.tickArrayLowerStartIndex}, upper=${liquidityRange.tickArrayUpperStartIndex}`);

    const [escrowAuthority] = sdk.getEscrowAuthorityPda(clmmLaunchState);

    console.log("\n=== Preparing WSOL for Liquidity ===");


    const wsolAta = anchor.utils.token.associatedAddress({
      mint: WSOL_MINT,
      owner: escrowAuthority,
    });

    const rentForAccount = 0.3 * anchor.web3.LAMPORTS_PER_SOL;

    const prepareTx = new anchor.web3.Transaction()
      .add(
        createAssociatedTokenAccountInstruction(
          adminKeypair.publicKey,
          wsolAta,
          escrowAuthority,
          WSOL_MINT,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      )
      .add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: adminKeypair.publicKey,
          toPubkey: wsolAta,
          lamports: quoteAmountLamports.toNumber(),
        })
      )
      .add(
        createSyncNativeInstruction(wsolAta, TOKEN_PROGRAM_ID)
      )
      .add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: adminKeypair.publicKey,
          toPubkey: escrowAuthority,
          lamports: rentForAccount,
        })
      );

    const prepareSig = await provider.sendAndConfirm(prepareTx, [adminKeypair]);
    console.log(`✅ Transferred ${quoteAmountLamports.toNumber() / anchor.web3.LAMPORTS_PER_SOL} SOL to WSOL ATA, synced, and funded escrow authority with ${rentForAccount / anchor.web3.LAMPORTS_PER_SOL} SOL for rent:`, prepareSig);

    const launchData = await program.account.launchState.fetch(clmmLaunchState);
    console.log("Straight in the state: ", launchData.straight);
    const LP_POOL_ALLOCATION = 440_000_000;
    const baseAmount = new anchor.BN(LP_POOL_ALLOCATION).mul(new anchor.BN(1_000_000_000));

    let addLiquidityResultTx = await sdk.addClmmLiquidityTx({
      payer: admin.publicKey,
      launch: clmmLaunchState,
      quoteMint: WSOL_MINT,
      baseMint: baseMintKeypair.publicKey,
      baseTokenAta: createPoolResultTx.baseTokenAta,
      provider,
      baseAmount: baseAmount,
      quoteAmount: quoteAmountLamports,
      liquidityRange: liquidityRange,
    });

    console.log("✅ Pool created:", createPoolSig);
    console.log("Explorer:", getExplorerUrl(provider, createPoolSig));

    console.log("\n=== Sending AddLiquidity transaction ===");
    console.log(`Instructions: ${addLiquidityResultTx.transaction.instructions.length}`);
    console.log(`Signers: ${addLiquidityResultTx.signers.length + 1}`);

    const addLiquiditySig = await provider.sendAndConfirm(
      addLiquidityResultTx.transaction,
      [adminKeypair, ...addLiquidityResultTx.signers],
      { skipPreflight: true }
    );

    console.log("✅ Liquidity added:", addLiquiditySig);
    console.log("Explorer:", getExplorerUrl(provider, addLiquiditySig));

    console.log("\n=== Checking Raydium Pool Vaults ===");
    const quoteVaultAccount = await provider.connection.getAccountInfo(addLiquidityResultTx.quoteVault);
    assert.ok(quoteVaultAccount, "Quote vault should exist");

    const quoteVaultData = quoteVaultAccount.data;
    const quoteVaultAmount = new anchor.BN(quoteVaultData.slice(64, 72), 'le');
    console.log(`Quote Vault (token_0): ${addLiquidityResultTx.quoteVault.toString()}`);
    console.log(`  Amount: ${quoteVaultAmount.toString()} lamports (${quoteVaultAmount.div(new anchor.BN(anchor.web3.LAMPORTS_PER_SOL)).toString()} SOL)`);

    const baseVaultAccount = await provider.connection.getAccountInfo(addLiquidityResultTx.baseVault);
    assert.ok(baseVaultAccount, "Base vault should exist");

    const baseVaultData = baseVaultAccount.data;
    const baseVaultAmount = new anchor.BN(baseVaultData.slice(64, 72), 'le');
    console.log(`Base Vault (token_1): ${addLiquidityResultTx.baseVault.toString()}`);
    console.log(`  Amount: ${baseVaultAmount.toString()} tokens (${Number(baseVaultAmount) / 1e9} whole tokens)`);
  });
});
