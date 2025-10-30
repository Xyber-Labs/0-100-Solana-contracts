import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { assert } from "chai";

import { Engine } from "../target/types/engine";
import EngineSDK, { getExplorerUrl } from "../ts-sdk/src/engine";

console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
describe("engine anchor - raydium clmm", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Engine as Program<Engine>;
  const admin = provider.wallet;
  const adminKeypair = (provider.wallet as any).payer;
  const sdk = EngineSDK.create(provider as any, program as any, adminKeypair);

  let raydiumProgramId: anchor.web3.PublicKey;
  let raydiumAmmConfig: anchor.web3.PublicKey;
  let clmmSaleMint: anchor.web3.Keypair;
  let clmmLaunchState: anchor.web3.PublicKey;
  let baseMintKeypair: anchor.web3.Keypair;
  let createPoolResultTx: any;
  let addLiquidityResultTx: any;

  const WSOL_MINT = new anchor.web3.PublicKey("So11111111111111111111111111111111111111112");
  const MIN_RAISE_LAMPORTS = new anchor.BN(10 * anchor.web3.LAMPORTS_PER_SOL);
  const PER_WALLET_CAP = new anchor.BN(5 * anchor.web3.LAMPORTS_PER_SOL);
  const TAU_LAMPORTS = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);
  const ROSTER_SHARD_CAP = 100;
  const CLMM_HARD_CAP = new anchor.BN(500 * anchor.web3.LAMPORTS_PER_SOL);
  const CLMM_SALE_ALLOCATION = new anchor.BN(540_540_000);
  const CLMM_LP_ALLOCATION = new anchor.BN(459_460_000);

  before(async () => {
    raydiumProgramId = new anchor.web3.PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");
    raydiumAmmConfig = new anchor.web3.PublicKey("E64NGkDLLCdQ2yFNPcavaKptrEgmiQaNykUuLC1Qgwyp");
    raydiumAmmConfig = new anchor.web3.PublicKey("9iFER3bpjf1PTTCQCfTRu17EJgvsxo9pVyA9QWwEuX4x");

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
    //
    // for (let batchStart = 0; batchStart < numDeposits; batchStart += batchSize) {
    //   const batchEnd = Math.min(batchStart + batchSize, numDeposits);
    //
    //   for (let i = batchStart; i < batchEnd; i++) {
    //     const depositor = anchor.web3.Keypair.generate();
    //
    //     const depositAmount = Math.min(
    //       PER_WALLET_CAP.toNumber(),
    //       (targetRaise - totalRaised) * anchor.web3.LAMPORTS_PER_SOL
    //     );
    //
    //     const airdropSig = await provider.connection.requestAirdrop(
    //       depositor.publicKey,
    //       depositAmount + anchor.web3.LAMPORTS_PER_SOL
    //     );
    //     await provider.connection.confirmTransaction(airdropSig);
    //
    //     await sdk.deposit({
    //       launch: clmmLaunchState,
    //       amountLamports: new anchor.BN(depositAmount),
    //       userKeypair: depositor
    //     });
    //
    //     totalRaised += depositAmount / anchor.web3.LAMPORTS_PER_SOL;
    //   }
    //
    //   console.log(`Completed batch ${Math.floor(batchStart / batchSize) + 1}/${Math.ceil(numDeposits / batchSize)} with ${batchEnd - batchStart} deposits`);
    // }
    //
    // console.log(`Total raised: ${totalRaised} SOL`);
  });

  it("Creates CLMM pool and adds liquidity in separate transactions", async () => {
    console.log("=== Creating CLMM Pool and Adding Liquidity (Separate Transactions) ===");

    console.log("Raydium CLMM setup:");
    console.log("CLMM Program:", raydiumProgramId.toString());
    console.log("Quote Mint (WSOL):", WSOL_MINT.toString());
    console.log("AMM Config:", raydiumAmmConfig.toString());

    do {
      baseMintKeypair = anchor.web3.Keypair.generate();
    } while (baseMintKeypair.publicKey.toBuffer().compare(WSOL_MINT.toBuffer()) <= 0);

    createPoolResultTx = await sdk.createClmmPoolTx({
      payer: admin.publicKey,
      launch: clmmLaunchState,
      quoteMint: WSOL_MINT,
      baseMint: baseMintKeypair,
      ammConfig: raydiumAmmConfig,
      clmmProgram: raydiumProgramId,
      provider,
    });

    console.log("Pool will be created at:", createPoolResultTx.poolState.toString());

    const launchData = await program.account.launchState.fetch(clmmLaunchState);

    const LP_POOL_ALLOCATION = 440_000_000;
    const baseAmount = new anchor.BN(LP_POOL_ALLOCATION).mul(new anchor.BN(1_000_000_000));

    const quoteAmountLamports = new anchor.BN(277815917584);


    const TOKENS_SOLD_ON_SALE = 560_000_000;
    const tokensSoldOnSale = new anchor.BN(TOKENS_SOLD_ON_SALE).mul(new anchor.BN(1_000_000_000));
    const currentPrice = Number(quoteAmountLamports) / Number(tokensSoldOnSale);
    console.log(`Current price (quote/base from sale): ${currentPrice.toExponential(15)}`);

    const tickCurrent = Math.round(Math.log(currentPrice) / Math.log(1.0001));
    console.log(`Current tick: ${tickCurrent}`);

    const tickLower = -443636;
    const tickUpper = 443520;
    const tickArrayLowerStartIndex = -443640;
    const tickArrayUpperStartIndex = 443680;

    console.log("\n=== Full-Range Parameters (exact from mainnet tx 5Q9Nse...) ===");
    console.log(`  Tick lower: ${tickLower}`);
    console.log(`  Tick upper: ${tickUpper}`);
    console.log(`  Range width: ${tickUpper - tickLower} ticks`);
    console.log(`  Tick array lower start: ${tickArrayLowerStartIndex}`);
    console.log(`  Tick array upper start: ${tickArrayUpperStartIndex}`);

    addLiquidityResultTx = await sdk.addClmmLiquidityTx({
      payer: admin.publicKey,
      launch: clmmLaunchState,
      quoteMint: WSOL_MINT,
      baseMint: baseMintKeypair.publicKey,
      baseTokenAta: createPoolResultTx.baseTokenAta,
      ammConfig: raydiumAmmConfig,
      clmmProgram: raydiumProgramId,
      provider,
      tickLowerIndex: tickLower,
      tickUpperIndex: tickUpper,
      tickArrayLowerStartIndex: tickArrayLowerStartIndex,
      tickArrayUpperStartIndex: tickArrayUpperStartIndex,
      baseAmount: baseAmount,
      quoteAmount: quoteAmountLamports,
    });

    console.log("\n=== Sending CreatePool transaction ===");
    console.log(`Instructions: ${createPoolResultTx.transaction.instructions.length}`);
    console.log(`Signers: ${createPoolResultTx.signers.length + 1}`);

    const createPoolSig = await provider.sendAndConfirm(
      createPoolResultTx.transaction,
      [adminKeypair, ...createPoolResultTx.signers],
      { skipPreflight: true }
    );

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
