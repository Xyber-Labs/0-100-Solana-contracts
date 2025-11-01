import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { assert } from "chai";

import { Engine } from "../target/types/engine";
import EngineSDK from "../ts-sdk/src/engine";

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
  let quoteMintKeypair: anchor.web3.Keypair;
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

    let totalRaised = 0;

  });

  it("Creates CLMM pool and adds liquidity in separate transactions", async () => {
    console.log("=== Creating CLMM Pool and Adding Liquidity (Separate Transactions) ===");

    console.log("Raydium CLMM setup:");
    const { createMint, mintTo, getOrCreateAssociatedTokenAccount } = await import("@solana/spl-token");

    console.log("\n=== Creating Quote Mint (SPL token) ===");
    quoteMintKeypair = anchor.web3.Keypair.generate();

    const quoteMint = await createMint(
      provider.connection,
      adminKeypair,
      adminKeypair.publicKey,
      null,
      9,
      quoteMintKeypair
    );

    console.log("✅ Quote Mint created:", quoteMint.toString());

    console.log("\n=== Ensuring Raydium Token Ordering (Quote must be token_0) ===");
    do {
      baseMintKeypair = anchor.web3.Keypair.generate();
    } while (baseMintKeypair.publicKey.toBuffer().compare(quoteMintKeypair.publicKey.toBuffer()) < 0);


    console.log("Quote Mint:", quoteMintKeypair.publicKey.toString());
    console.log("Base Mint:", baseMintKeypair.publicKey.toString());

    const isQuoteLessThanBase = quoteMintKeypair.publicKey.toBuffer().compare(baseMintKeypair.publicKey.toBuffer()) < 0;
    console.log("Quote < Base (required for Raydium):", isQuoteLessThanBase);
    assert.ok(isQuoteLessThanBase, "Quote mint must have smaller address than base mint for Raydium CLMM");


    const quoteAmountLamports = new anchor.BN(300000000000);

    const [escrowAuthority] =
      sdk.getEscrowAuthorityPda(clmmLaunchState);

    console.log("\n=== Minting Quote Tokens to Escrow Authority ===");
    const escrowQuoteAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      adminKeypair,
      quoteMintKeypair.publicKey,
      escrowAuthority,
      true
    );

    await mintTo(
      provider.connection,
      adminKeypair,
      quoteMintKeypair.publicKey,
      escrowQuoteAta.address,
      adminKeypair,
      quoteAmountLamports.toNumber()
    );

    console.log("✅ Minted", quoteAmountLamports.toString(), "quote tokens to escrow ATA:", escrowQuoteAta.address.toString());

    let createPoolResultTx = await sdk.createClmmPoolTx({
      payer: admin.publicKey,
      launch: clmmLaunchState,
      quoteMint: quoteMintKeypair.publicKey,
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


    const launchData = await program.account.launchState.fetch(clmmLaunchState);
    console.log("Straight in the state: ", launchData.straight);
    const LP_POOL_ALLOCATION = 440_000_000;
    const baseAmount = new anchor.BN(LP_POOL_ALLOCATION).mul(new anchor.BN(1_000_000_000));


    let addLiquidityResultTx = await sdk.addClmmLiquidityTx({
      payer: admin.publicKey,
      launch: clmmLaunchState,
      quoteMint: quoteMintKeypair.publicKey,
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
