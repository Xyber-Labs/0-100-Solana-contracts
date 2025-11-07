import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { assert } from "chai";

import { Engine } from "../target/types/engine";
import { IncomeDispatcher } from "../target/types/income_dispatcher";
import EngineSDK from "../ts-sdk/src/engine";
import { TxBuilder } from "../ts-sdk/src/txBuilder";
import { Raydium, TxVersion, PoolUtils, MEMO_PROGRAM_ID } from '@raydium-io/raydium-sdk-v2';
import BN from 'bn.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID
} from "@solana/spl-token";


const INCOME_DISPATCHER_PROGRAM_ID = new anchor.web3.PublicKey("DPwfwgErHSmKLjGkadA4EL1zcCKU1ZhdaMUyUzJtTqCN");
const INCOME_DISPATCHER_SEED_ROOT = Buffer.from("income-dispatcher");

function getExplorerUrl(provider, signature) {
  const cluster = provider.connection.rpcEndpoint.includes('devnet') ? 'devnet'
    : provider.connection.rpcEndpoint.includes('testnet') ? 'testnet'
      : provider.connection.rpcEndpoint.includes('localhost') || provider.connection.rpcEndpoint.includes('127.0.0.1') ? 'custom&customUrl=' + encodeURIComponent(provider.connection.rpcEndpoint)
        : 'mainnet-beta';
  return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
}

function getIncomeDispatcherConfigPda() {
  const [configPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [INCOME_DISPATCHER_SEED_ROOT, Buffer.from("config")],
    INCOME_DISPATCHER_PROGRAM_ID
  );
  return configPda;
}

function getIncomeDispatcherAuthorityPda() {
  const [authorityPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [INCOME_DISPATCHER_SEED_ROOT, Buffer.from("authority")],
    INCOME_DISPATCHER_PROGRAM_ID
  );
  return authorityPda;
}

describe("engine anchor - raydium clmm", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Engine as Program<Engine>;
  const incomeDispatcherProgram = anchor.workspace.IncomeDispatcher as Program<IncomeDispatcher>;
  const admin = provider.wallet;
  const adminKeypair = (provider.wallet as any).payer;
  const txBuilder = new TxBuilder(program, adminKeypair);
  const sdk = EngineSDK.create(provider as any, program as any, adminKeypair);

  let clmmSaleMint: anchor.web3.Keypair;
  let clmmLaunchState: anchor.web3.PublicKey;
  let baseMintKeypair: anchor.web3.Keypair;
  let createPoolResultTx: any;
  let addLiquidityResultTx: any;
  let raydium: Raydium;
  const WSOL_MINT = new anchor.web3.PublicKey("So11111111111111111111111111111111111111112");
  const RAYDIUM_CLMM_PROGRAM_ID = new anchor.web3.PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");
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

    await sdk.initRoster({ launch: clmmLaunchState});
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

    createPoolResultTx = await sdk.createClmmPoolTx({
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

    console.log("\n=== Funding Escrow Authority ===");
    const totalSolNeeded = quoteAmountLamports.toNumber() + (0.3 * anchor.web3.LAMPORTS_PER_SOL);

    const fundTx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: adminKeypair.publicKey,
        toPubkey: escrowAuthority,
        lamports: totalSolNeeded,
      })
    );

    const fundSig = await provider.sendAndConfirm(fundTx, [adminKeypair]);
    console.log(`✅ Funded escrow authority with ${totalSolNeeded / anchor.web3.LAMPORTS_PER_SOL} SOL:`, fundSig);

    const LP_POOL_ALLOCATION = 440_000_000;
    const baseAmount = new anchor.BN(LP_POOL_ALLOCATION).mul(new anchor.BN(1_000_000_000));

    addLiquidityResultTx = await sdk.addClmmLiquidityTx({
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

  it("Performs trading on the Raydium CLMM pool", async () => {
    console.log("=== Performing Trading on Raydium CLMM Pool ===");

    const traders: anchor.web3.Keypair[] = [];
    const numTraders = 2;
    for (let i = 0; i < numTraders; i++) {
      traders.push(anchor.web3.Keypair.generate());
    }

    // Fund traders with SOL
    console.log("Funding traders with SOL...");
    const fundAmount = new anchor.BN(5 * anchor.web3.LAMPORTS_PER_SOL); // 5 SOL each
    for (let i = 0; i < traders.length; i++) {
      const fundTx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: admin.publicKey,
          toPubkey: traders[i].publicKey,
          lamports: fundAmount.toNumber(),
        })
      );
      const fundSig = await provider.sendAndConfirm(fundTx, [adminKeypair]);
      console.log(`  ✅ Funded trader ${i + 1}: ${fundSig}`);
    }

    // Perform swaps for each trader - Phase 1: All buys
    console.log("\n=== Phase 1: All traders buying ===");
    const buyResults: any[] = [];
    for (let i = 0; i < traders.length; i++) {
      const trader = traders[i];
      console.log(`🔄 Trader ${i + 1} Buy:`);

      const raydium = await Raydium.load({
        owner: trader,
        connection: provider.connection,
        cluster: 'mainnet',
        disableFeatureCheck: true,
        disableLoadToken: true,
        blockhashCommitment: 'finalized',
      });

      const poolId = createPoolResultTx.poolState.toString();

      try {
        const poolData = await raydium.clmm.getPoolInfoFromRpc(poolId);
        const poolInfo = poolData.poolInfo;
        const poolKeys = poolData.poolKeys;
        const clmmPoolInfo = poolData.computePoolInfo;
        const tickCache = poolData.tickData;

        // Buy: WSOL -> base token
        const inputMint = WSOL_MINT;
        const amountIn = new BN(4.7 * anchor.web3.LAMPORTS_PER_SOL); // 4.7 SOL

        if (inputMint.toBase58() !== poolInfo.mintA.address && inputMint.toBase58() !== poolInfo.mintB.address) {
          throw new Error('Input mint does not match pool');
        }

        const baseIn = inputMint.toBase58() === poolInfo.mintA.address;

        const { minAmountOut, remainingAccounts } = await PoolUtils.computeAmountOutFormat({
          poolInfo: clmmPoolInfo,
          tickArrayCache: tickCache[poolId],
          amountIn,
          tokenOut: poolInfo[baseIn ? 'mintB' : 'mintA'],
          slippage: 0.01,
          epochInfo: await raydium.fetchEpochInfo(),
        });

        // Execute swap (buy)
        const { execute: executeBuy } = await raydium.clmm.swap({
          poolInfo,
          poolKeys,
          inputMint: poolInfo[baseIn ? 'mintA' : 'mintB'].address,
          amountIn,
          amountOutMin: minAmountOut.amount.raw,
          observationId: clmmPoolInfo.observationId,
          ownerInfo: {
            useSOLBalance: true,
          },
          remainingAccounts,
          txVersion: TxVersion.V0,
        });

        // Temporarily suppress console.log to hide simulation output
        const originalConsoleLog = console.log;
        console.log = () => {};

        const buyResult = await executeBuy({ sendAndConfirm: true });

        // Restore console.log
        console.log = originalConsoleLog;

        console.log(`  ✅ Buy: ${buyResult.txId}`);

        buyResults.push({
          trader,
          receivedAmount: minAmountOut.amount.raw,
          poolInfo,
          poolKeys,
          clmmPoolInfo,
          tickCache
        });

      } catch (error) {
        console.error(`  ❌ Trader ${i + 1} buy failed:`, error.message);
        buyResults.push(null); // Mark as failed
      }
    }

    // Phase 2: All sells
    console.log("\n=== Phase 2: All traders selling ===");
    for (let i = 0; i < traders.length; i++) {
      if (!buyResults[i]) continue;

      const trader = traders[i];
      const buyData = buyResults[i];
      console.log(`🔄 Trader ${i + 1} Sell:`);

      try {
        const raydium = await Raydium.load({
          owner: trader,
          connection: provider.connection,
          cluster: 'mainnet',
          disableFeatureCheck: true,
          disableLoadToken: true,
          blockhashCommitment: 'finalized',
        });

        const { poolInfo, poolKeys, clmmPoolInfo, tickCache, receivedAmount } = buyData;
        const poolId = createPoolResultTx.poolState.toString();

        // Sell: base token -> WSOL
        const sellInputMint = baseMintKeypair.publicKey;
        const sellAmountIn = receivedAmount; // Use what we received from buy

        const baseInSell = sellInputMint.toBase58() === poolInfo.mintA.address;

        const { minAmountOut: sellMinAmountOut, remainingAccounts: sellRemainingAccounts } = await PoolUtils.computeAmountOutFormat({
          poolInfo: clmmPoolInfo,
          tickArrayCache: tickCache[poolId],
          amountIn: sellAmountIn,
          tokenOut: poolInfo[baseInSell ? 'mintB' : 'mintA'],
          slippage: 0.01,
          epochInfo: await raydium.fetchEpochInfo(),
        });

        // Execute sell swap
        const { execute: executeSell } = await raydium.clmm.swap({
          poolInfo,
          poolKeys,
          inputMint: poolInfo[baseInSell ? 'mintA' : 'mintB'].address,
          amountIn: sellAmountIn,
          amountOutMin: sellMinAmountOut.amount.raw,
          observationId: clmmPoolInfo.observationId,
          ownerInfo: {
            useSOLBalance: true,
          },
          remainingAccounts: sellRemainingAccounts,
          txVersion: TxVersion.V0,
        });

        // Temporarily suppress console.log to hide simulation output
        const originalConsoleLog = console.log;
        console.log = () => {};

        const sellResult = await executeSell({ sendAndConfirm: true });

        // Restore console.log
        console.log = originalConsoleLog;

        console.log(`  ✅ Sell: ${sellResult.txId}`);

      } catch (error) {
        console.error(`  ❌ Trader ${i + 1} sell failed:`, error.message);
      }
    }

    console.log("✅ Trading completed successfully");
  });

  it("Sets up income-dispatcher program", async () => {
    console.log("=== Setting up Income-Dispatcher Program ===");

    const configPda = getIncomeDispatcherConfigPda();

    // Check if config already exists
    try {
      await incomeDispatcherProgram.account.config.fetch(configPda);
      console.log("✅ Income-dispatcher already initialized, skipping setup");
      return;
    } catch (error) {
      // Config doesn't exist, proceed with initialization
      console.log("Config not found, initializing income-dispatcher...");
    }

    // Initialize income-dispatcher config
    const initTx = await incomeDispatcherProgram.methods
      .initialize(
        admin.publicKey, // platform_wallet
        clmmLaunchState, // income_source (the launch state)
      )
      .accountsStrict({
        admin: admin.publicKey,
        config: configPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([adminKeypair])
      .transaction();

    const initSig = await provider.sendAndConfirm(initTx, [adminKeypair]);
    console.log("✅ Income-dispatcher initialized:", initSig);

    // Verify config was created
    const configAccount = await incomeDispatcherProgram.account.config.fetch(configPda);
    assert.equal(configAccount.admin.toString(), admin.publicKey.toString());
    assert.equal(configAccount.platformWallet.toString(), admin.publicKey.toString());
    assert.equal(configAccount.incomeSource.toString(), clmmLaunchState.toString());

    console.log("✅ Income-dispatcher config verified");
  });

  it("Claims CLMM fees through income-dispatcher", async () => {
    console.log("=== Claiming CLMM Fees through Income-Dispatcher ===");

    // Get required accounts for the claim
    const launchStateData = await sdk.fetchLaunch(clmmLaunchState);
    const escrowAuthority = sdk.getEscrowAuthorityPda(clmmLaunchState)[0];
    const escrowAccount = sdk.getEscrowPda(clmmLaunchState)[0];

    // Get position NFT accounts from the addLiquidityResultTx
    const positionNftMint = addLiquidityResultTx.positionNftMint;
    console.log("Position NFT mint:", positionNftMint.toString());
    const positionNftAccount = addLiquidityResultTx.positionNftAccount;

    // Get pool state and vaults from the createPoolResultTx and addLiquidityResultTx
    const poolState = createPoolResultTx.poolState;
    const tokenVault0 = addLiquidityResultTx.quoteVault; // WSOL vault
    const tokenVault1 = addLiquidityResultTx.baseVault; // Base token vault

    // Get tick arrays from the liquidity range used in add liquidity
    const liquidityRange = await sdk.getLiquidityRange({
      launch: clmmLaunchState
    });
    const ammConfigIndex = 4; // tickSpacing 60
    const tickArrayLowerStart = liquidityRange.tickArrayLowerStartIndex;
    const tickArrayUpperStart = liquidityRange.tickArrayUpperStartIndex;

    const [tickArrayLower] = txBuilder.getRaydiumTickArrayPda(poolState, tickArrayLowerStart);

    const [tickArrayUpper] = txBuilder.getRaydiumTickArrayPda(poolState, tickArrayUpperStart);

    // Get personal position account - use from addLiquidityResultTx if available, otherwise derive
    let personalPosition;
    if (addLiquidityResultTx.personalPosition) {
      personalPosition = addLiquidityResultTx.personalPosition;
      console.log("Using personalPosition from addLiquidityResultTx:", personalPosition.toString());
    } else {
      [personalPosition] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("position"),
          positionNftMint.toBuffer(),
        ],
        RAYDIUM_CLMM_PROGRAM_ID
      );
      console.log("Derived personalPosition:", personalPosition.toString());
    }

    // Get protocol position account
    const tickLowerBuffer = Buffer.alloc(4);
    tickLowerBuffer.writeInt32BE(liquidityRange.tickArrayLower, 0);
    const tickUpperBuffer = Buffer.alloc(4);
    tickUpperBuffer.writeInt32BE(liquidityRange.tickArrayUpper, 0);
    const [protocolPosition] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("protocol_position"),
        poolState.toBuffer(),
        tickLowerBuffer,
        tickUpperBuffer,
      ],
      RAYDIUM_CLMM_PROGRAM_ID
    );
    console.log("Protocol position:", protocolPosition.toString());

    // Get recipient token accounts (ATA for escrow authority)
    const recipientTokenAccount0 = getAssociatedTokenAddressSync(WSOL_MINT, escrowAuthority, true); // WSOL
    const recipientTokenAccount1 = getAssociatedTokenAddressSync(baseMintKeypair.publicKey, escrowAuthority, true); // Base token

    // Vault mints
    const vault0Mint = WSOL_MINT; // WSOL
    const vault1Mint = baseMintKeypair.publicKey; // Base token

    // Get remaining accounts for tick array bitmap extension (required for decrease_liquidity_v2)
    const [tickArrayBitmapExtension] = txBuilder.getRaydiumBitmapExtensionPda(poolState);

    const remainingAccounts: any[] = [
      {
        pubkey: tickArrayBitmapExtension,
        isWritable: true,
        isSigner: false,
      },
    ];

    // Create the claim transaction
    const claimTx = await incomeDispatcherProgram.methods
      .claimClmmFeesByAdmin()
      .accountsStrict({
        admin: admin.publicKey,
        config: getIncomeDispatcherConfigPda(),
        incomeDispatcherAuthority: getIncomeDispatcherAuthorityPda(),
        engineProgram: program.programId,
        raydiumProgram: RAYDIUM_CLMM_PROGRAM_ID,
        launchState: clmmLaunchState,
        baseMint: baseMintKeypair.publicKey,
        escrow: escrowAccount,
        escrowAuthority,
        positionNftMint,
        positionNftAccount,
        personalPosition,
        poolState,
        protocolPosition,
        tokenVault0,
        tokenVault1,
        tickArrayLower,
        tickArrayUpper,
        recipientTokenAccount0,
        recipientTokenAccount1,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenProgram2022: TOKEN_2022_PROGRAM_ID,
        baseTokenProgram: TOKEN_PROGRAM_ID,
        quoteTokenProgram: TOKEN_PROGRAM_ID,
        memoProgram: MEMO_PROGRAM_ID,
        vault0Mint,
        vault1Mint,
      })
      .remainingAccounts(remainingAccounts)
      .signers([adminKeypair])
      .transaction();

    try {
      const claimSig = await provider.sendAndConfirm(claimTx, [adminKeypair], {
        skipPreflight: true
      });
      console.log("✅ CLMM fees claimed:", claimSig);
      console.log("Explorer:", getExplorerUrl(provider, claimSig));

      console.log("✅ Fee claiming completed successfully");
    } catch (error) {
      console.error("❌ Fee claiming failed:", error.message);

      // Try to extract transaction signature from the error
      if (error.txid) {
        console.log("Transaction signature:", error.txid);
        console.log("Explorer:", getExplorerUrl(provider, error.txid));
      } else {
        // Fallback: try to extract from the message
        const txMatch = error.message.match(/([A-Za-z0-9]{88})/);
        if (txMatch) {
          console.log("Transaction signature:", txMatch[1]);
          console.log("Explorer:", getExplorerUrl(provider, txMatch[1]));
        }
      }

      throw error; // Re-throw to fail the test
    }
  });
});
