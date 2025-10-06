import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Engine } from "../target/types/engine";
import {
  createInitializeMintInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import EngineSDK from "../ts-sdk/src/engine";

async function runLocalFlow() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.engine as Program<Engine>;
  const admin = provider.wallet;
  const sdk = EngineSDK.create(provider, program);

  console.log(`--- Starting Full Flow on ${provider.connection.rpcEndpoint} ---`);
  console.log(`Admin wallet: ${admin.publicKey.toBase58()}`);

  const results: { success: boolean; message: string; error?: string }[] = [];
  let testLaunchState: anchor.web3.PublicKey;

  try {
    // Helper to wait
    async function waitForFundingPeriodEnd(launchPda: anchor.web3.PublicKey) {
      const state = await sdk.fetchLaunch(launchPda);
      const currentTime = Math.floor(Date.now() / 1000);
      const fundingEndTime = state.fundingPeriodEnd.toNumber();
      if (currentTime >= fundingEndTime) return;
      const waitTime = fundingEndTime - currentTime;
      if (waitTime > 0) {
        console.log(`Waiting ${waitTime + 2} seconds for funding period to end...`);
        await new Promise(resolve => setTimeout(resolve, (waitTime + 2) * 1000));
      }
    }

    // --- Steps ---

    // 1. Initialize Launch
    try {
      const step = "[1/8] Initialize Launch";
      console.log(`\n${step}`);
      const testSaleMint = anchor.web3.Keypair.generate();
      [testLaunchState] = sdk.getLaunchPda(testSaleMint.publicKey);
      const [mintAuth] = sdk.getMintAuthPda(testLaunchState);
      const testHardCap = new anchor.BN(20 * anchor.web3.LAMPORTS_PER_SOL);
      const testMinRaise = new anchor.BN(5 * anchor.web3.LAMPORTS_PER_SOL);
      const testPerWalletCap = new anchor.BN(3 * anchor.web3.LAMPORTS_PER_SOL);
      const testTau = new anchor.BN(0.5 * anchor.web3.LAMPORTS_PER_SOL);
      await sdk.initLaunch({
        saleMint: testSaleMint.publicKey,
        hardCapLamports: testHardCap, minRaiseLamports: testMinRaise, perWalletCap: testPerWalletCap,
        tauLamports: testTau, saleAllocation: new anchor.BN(1000000), lpAllocation: new anchor.BN(500000),
        fundingDurationDays: 1,
        numBlocks: 150, // ~1 minute window
        preInstructions: [
          anchor.web3.SystemProgram.createAccount({
            fromPubkey: admin.publicKey, newAccountPubkey: testSaleMint.publicKey, space: 82,
            lamports: await provider.connection.getMinimumBalanceForRentExemption(82), programId: TOKEN_PROGRAM_ID,
          }),
          createInitializeMintInstruction(testSaleMint.publicKey, 6, mintAuth, admin.publicKey),
        ],
        signers: [admin.payer, testSaleMint],
      });
      console.log(`   -> Launch initialized. PDA: ${testLaunchState.toBase58()}`);
      
      // Helper function to serialize the state object for readability
      const serializeState = (state) => {
        const replacer = (key, value) => {
          // Check if the value is a BN instance and convert to a decimal string
          if (value && value._bn && typeof value.toString === 'function') {
            // Check if it's a PublicKey to avoid converting it to a number
            if (typeof value.toBase58 === 'function') {
              return value.toBase58();
            }
            return value.toString(10); // Explicitly use base 10
          }
          return value;
        };
        return JSON.stringify(state, replacer, 2);
      };

      // Fetch and log the full state for the backend developer
      const launchStateData = await sdk.fetchLaunch(testLaunchState);
      console.log("   -> Full Launch State Details (Serialized):");
      console.log(serializeState(launchStateData));
      
      results.push({ success: true, message: step });
    } catch (e) {
      results.push({ success: false, message: "[1/8] Initialize Launch", error: e.message });
      throw e;
    }

    // 2. Initialize Roster
    try {
      const step = "[2/8] Initialize Roster";
      console.log(`\n${step}`);
      await sdk.initRoster({ launch: testLaunchState });
      console.log("   -> Roster initialized.");
      results.push({ success: true, message: step });
    } catch (e) {
      results.push({ success: false, message: "[2/8] Initialize Roster", error: e.message });
      throw e;
    }

    // 3. User Deposits
    try {
      const step = "[3/8] Simulate User Deposits";
      console.log(`\n${step}`);
      const depositAmount = new anchor.BN(2 * anchor.web3.LAMPORTS_PER_SOL);
      for (let i = 0; i < 15; i++) {
        const user = anchor.web3.Keypair.generate();
        const airdropSig = await provider.connection.requestAirdrop(user.publicKey, 20 * anchor.web3.LAMPORTS_PER_SOL);
        const latestBlockhash = await provider.connection.getLatestBlockhash();
        await provider.connection.confirmTransaction({
            blockhash: latestBlockhash.blockhash, lastValidBlockHeight: latestBlockhash.lastValidBlockHeight, signature: airdropSig,
        });
        await sdk.deposit({ launch: testLaunchState, amountLamports: depositAmount, userKeypair: user });
        console.log(`   -> User ${i + 1} deposited.`);
      }
      results.push({ success: true, message: step });
    } catch (e) {
      results.push({ success: false, message: "[3/8] Simulate User Deposits", error: e.message });
      throw e;
    }

    // 4. Wait for Funding to End
    try {
      const step = "[4/8] Wait for funding period";
      console.log(`\n${step}`);
      await waitForFundingPeriodEnd(testLaunchState);
      console.log("   -> Funding period closed.");
      results.push({ success: true, message: step });
    } catch (e) {
      results.push({ success: false, message: "[4/8] Wait for funding period", error: e.message });
      throw e;
    }

    // 5. Set VRF Seed
    try {
      const step = "[5/8] Set VRF Seed";
      console.log(`\n${step}`);
      await sdk.setSeed({ launch: testLaunchState });
      console.log("   -> VRF seed set.");
      results.push({ success: true, message: step });
    } catch (e) {
      results.push({ success: false, message: "[5/8] Set VRF Seed", error: e.message });
      throw e;
    }

    // 6. Process Batches
    try {
      const step = "[6/8] Process batches (cranking)";
      console.log(`\n${step}`);
      const state = await sdk.fetchLaunch(testLaunchState);
      const totalTicketsToProcess = state.totalTickets;
      let processed = 0;
      while (processed < totalTicketsToProcess) {
        await sdk.processBatch({ launch: testLaunchState, maxItems: 10 });
        const selectionAccount = await sdk.fetchSelection(testLaunchState);
        processed = selectionAccount.processed;
        console.log(`   -> Processed ${processed}/${totalTicketsToProcess} tickets`);
      }
      results.push({ success: true, message: step });
    } catch (e) {
      results.push({ success: false, message: "[6/8] Process batches (cranking)", error: e.message });
      throw e;
    }

    // 7. Finalize & Open Claims
    try {
      const step = "[7/8] Finalize selection and open claims";
      console.log(`\n${step}`);
      await sdk.finalizeSelection({ launch: testLaunchState });
      console.log("   -> Selection finalized.");
      await sdk.openClaims({ launch: testLaunchState });
      console.log("   -> Claims opened.");
      results.push({ success: true, message: step });
    } catch (e) {
      results.push({ success: false, message: "[7/8] Finalize selection and open claims", error: e.message });
      throw e;
    }

    // 8. Create Pool
    try {
      const step = "[8/8] Create Pool (test mode)";
      console.log(`\n${step}`);
      await sdk.createPool({ launch: testLaunchState });
      console.log("   -> Pool created successfully!");
      const poolState = await sdk.fetchPoolState(testLaunchState);
      console.log(`      - Pool ID: ${poolState.poolId.toString()}`);
      results.push({ success: true, message: step });
    } catch (e) {
      results.push({ success: false, message: "[8/8] Create Pool (test mode)", error: e.message });
    }

  } catch (error) {
    console.error("\n--- SCRIPT FAILED ---");
    // Error is already captured in the results array
  } finally {
    console.log("\n--- Flow Summary ---");
    results.forEach(result => {
      if (result.success) {
        console.log(`✅ ${result.message}`);
      } else {
        console.log(`❌ ${result.message}`);
        console.log(`   - Error: ${result.error}`);
      }
    });
    console.log("--------------------");

    const failures = results.filter(r => !r.success).length;
    if (failures > 0) {
        console.log(`\nScript finished with ${failures} failed step(s).`);
        process.exit(1);
    } else {
        console.log("\n✅ Script finished successfully!");
    }
  }
}

runLocalFlow();
