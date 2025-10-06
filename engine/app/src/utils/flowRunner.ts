import { BN, Program } from '@coral-xyz/anchor';
import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createInitializeMintInstruction } from '@solana/spl-token';
import EngineSDK from 'zero-hundred-engine-sdk';

interface LaunchConfig {
  hardCapLamports: number;
  minRaiseLamports: number;
  perWalletCap: number;
  tauLamports: number;
  saleAllocation: number;
  lpAllocation: number;
  fundingDurationDays: number;
  numBlocks: number;
}

// A simplified SDK type, as we don't have the full type in this context
type Sdk = any;

export async function runFullFlow(
  sdk: Sdk,
  program: Program,
  provider: any,
  config: LaunchConfig,
  addLog: (log: string) => void
): Promise<{ success: boolean; message: string; }> {

  const admin = provider.wallet;
  addLog(`--- Starting Full Flow ---`);
  addLog(`Admin wallet: ${admin.publicKey.toBase58()}`);

  let testLaunchState: PublicKey;

  try {
    // Helper to wait
    async function waitForFundingPeriodEnd(launchPda: PublicKey) {
      addLog('Fetching launch state to check funding period...');
      const state = await sdk.fetchLaunch(launchPda);
      const currentTime = Math.floor(Date.now() / 1000);
      const fundingEndTime = state.fundingPeriodEnd.toNumber();
      
      if (currentTime >= fundingEndTime) {
        addLog('Funding period has already ended.');
        return;
      }
      
      const waitTime = fundingEndTime - currentTime;
      if (waitTime > 0) {
        addLog(`Waiting ${waitTime + 2} seconds for funding period to end...`);
        await new Promise(resolve => setTimeout(resolve, (waitTime + 2) * 1000));
      }
    }

    // 1. Initialize Launch
    addLog(`[1/8] Initializing Launch...`);
    const testSaleMint = Keypair.generate();
    [testLaunchState] = sdk.getLaunchPda(testSaleMint.publicKey);
    const [mintAuth] = sdk.getMintAuthPda(testLaunchState);
    const [escrow] = sdk.getEscrowPda(testLaunchState);
    const [projectCounter] = sdk.getProjectCounterPda();

    const tx = new Transaction();

    // Add pre-instructions
    tx.add(
      SystemProgram.createAccount({
        fromPubkey: admin.publicKey,
        newAccountPubkey: testSaleMint.publicKey,
        space: 82,
        lamports: await provider.connection.getMinimumBalanceForRentExemption(82),
        programId: TOKEN_PROGRAM_ID,
      })
    );
    tx.add(
      createInitializeMintInstruction(testSaleMint.publicKey, 6, mintAuth, admin.publicKey)
    );
    
    // Add main instruction
    const initLaunchIx = await program.methods
      .initLaunch(
        new BN(config.hardCapLamports),
        new BN(config.minRaiseLamports),
        new BN(config.perWalletCap),
        new BN(config.tauLamports),
        new BN(config.saleAllocation),
        new BN(config.lpAllocation),
        1, // Use 30 seconds for testing instead of 10
        new BN(config.numBlocks)
      )
      .accountsStrict({
        admin: admin.publicKey,
        projectCounter,
        launchState: testLaunchState,
        saleMint: testSaleMint.publicKey,
        escrow,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    tx.add(initLaunchIx);
    
    // Set fee payer and recent blockhash
    tx.feePayer = admin.publicKey;
    tx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;

    // Explicitly sign with the keypairs we created
    tx.partialSign(testSaleMint);

    // Ask the provider's wallet to sign the transaction
    const signedTx = await provider.wallet.signTransaction(tx);

    // Send the fully signed transaction
    const rawTx = signedTx.serialize();
    const signature = await provider.connection.sendRawTransaction(rawTx);
    
    // Manually confirm the transaction
    const latestBlockhash = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        signature: signature,
    });

    addLog(`   -> Launch initialized. Signature: ${signature}`);
    addLog(`   -> Launch PDA: ${testLaunchState.toBase58()}`);


    // 2. Initialize Roster
    addLog(`\n[2/8] Initializing Roster...`);
    await sdk.initRoster({ launch: testLaunchState });
    addLog("   -> Roster initialized.");

    // 3. User Deposits (simulating 15 users)
    addLog(`\n[3/8] Simulating 15 User Deposits...`);
    const depositAmount = new BN(2 * 1e9); // 2 SOL
    for (let i = 0; i < 15; i++) {
      const user = Keypair.generate();
      
      // Airdrop funds to the simulated user
      addLog(`   -> Airdropping SOL to user ${i + 1}...`);
      const airdropSig = await provider.connection.requestAirdrop(user.publicKey, 20 * 1e9); // 20 SOL
      const latestBlockhash = await provider.connection.getLatestBlockhash();
      await provider.connection.confirmTransaction({
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          signature: airdropSig,
      });

      addLog(`   -> Depositing for user ${i + 1}...`);
      await sdk.deposit({
        launch: testLaunchState,
        amountLamports: depositAmount,
        userKeypair: user
      });
      addLog(`   -> User ${i + 1} deposited.`);
    }

    // 4. Wait for Funding to End
    addLog(`\n[4/8] Waiting for funding period to end...`);
    await waitForFundingPeriodEnd(testLaunchState);
    addLog("   -> Funding period closed.");

    // 5. Set VRF Seed
    addLog(`\n[5/8] Setting VRF Seed...`);
    await sdk.setSeed({ launch: testLaunchState });
    addLog("   -> VRF seed set.");

    // 6. Process Batches
    addLog(`\n[6/8] Processing batches (cranking)...`);
    const state = await sdk.fetchLaunch(testLaunchState);
    const totalTicketsToProcess = state.totalTickets;
    let processed = 0;
    while (processed < totalTicketsToProcess) {
      await sdk.processBatch({ launch: testLaunchState, maxItems: 10 });
      const selectionAccount = await sdk.fetchSelection(testLaunchState);
      processed = selectionAccount.processed;
      addLog(`   -> Processed ${processed}/${totalTicketsToProcess} tickets`);
    }

    // 7. Finalize & Open Claims
    addLog(`\n[7/8] Finalizing selection and opening claims...`);
    await sdk.finalizeSelection({ launch: testLaunchState });
    addLog("   -> Selection finalized.");
    await sdk.openClaims({ launch: testLaunchState });
    addLog("   -> Claims opened.");

    // 8. Create Pool
    addLog(`\n[8/8] Creating Pool (test mode)...`);
    await sdk.createPool({ launch: testLaunchState, useTestMode: true });
    addLog("   -> Pool created successfully!");
    const poolState = await sdk.fetchPoolState(testLaunchState);
    addLog(`      - Pool ID: ${poolState.poolId.toString()}`);

    addLog("\n✅ Full flow finished successfully!");
    return { success: true, message: "Flow completed successfully" };

  } catch (error: any) {
    addLog(`\n--- SCRIPT FAILED ---`);
    addLog(`Error: ${error.message}`);
    console.error("Full flow error details:", error);
    return { success: false, message: error.message };
  }
}
