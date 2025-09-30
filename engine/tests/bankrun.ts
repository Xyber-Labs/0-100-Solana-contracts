import { startAnchor } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import * as anchor from "@coral-xyz/anchor";
import { assert } from "chai";
import { TxBuilder } from "../ts-sdk/src/txBuilder";
import { Program } from "@coral-xyz/anchor";
import { Engine } from "../target/types/engine";

describe("engine bankrun", () => {
  let context: any;
  let provider: BankrunProvider;
  let program: Program<Engine>;
  let admin: anchor.Wallet;
  let txBuilder: TxBuilder;

  let saleMint: anchor.web3.Keypair;
  let launchState: anchor.web3.PublicKey;

  const HARD_CAP_LAMPORTS = new anchor.BN(100 * anchor.web3.LAMPORTS_PER_SOL);
  const MIN_RAISE_LAMPORTS = new anchor.BN(10 * anchor.web3.LAMPORTS_PER_SOL);
  const PER_WALLET_CAP = new anchor.BN(5 * anchor.web3.LAMPORTS_PER_SOL);
  const TAU_LAMPORTS = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);
  const SALE_ALLOCATION = new anchor.BN(1000000);
  const LP_ALLOCATION = new anchor.BN(500000);

  before(async () => {
    context = await startAnchor("./", [], []);
    provider = new BankrunProvider(context);
    anchor.setProvider(provider);
    program = anchor.workspace.engine as Program<Engine>;
    admin = provider.wallet;
    txBuilder = new TxBuilder(program);
  });

  it("Initializes the launch state correctly", async () => {
    saleMint = anchor.web3.Keypair.generate();

    const result = await txBuilder.initLaunchTx({
      admin: admin.publicKey,
      saleMint: saleMint,
      hardCapLamports: HARD_CAP_LAMPORTS,
      minRaiseLamports: MIN_RAISE_LAMPORTS,
      perWalletCap: PER_WALLET_CAP,
      tauLamports: TAU_LAMPORTS,
      saleAllocation: SALE_ALLOCATION,
      lpAllocation: LP_ALLOCATION,
      provider,
    });

    const initTx = await provider.sendAndConfirm(result.transaction, [admin.payer, ...result.signers]);
    console.log("Init launch tx signature:", initTx);

    launchState = result.launchState;
    const state = await txBuilder.fetchLaunchState(launchState, provider);

    assert.isTrue(state.projectId.toNumber() >= 0, "Project ID should be non-negative");
    assert.ok(state.admin.equals(admin.publicKey));
    assert.equal(state.hardCapLamports.toNumber(), HARD_CAP_LAMPORTS.toNumber());
    assert.equal(state.minRaiseLamports.toNumber(), MIN_RAISE_LAMPORTS.toNumber());
    assert.equal(state.perWalletCap.toNumber(), PER_WALLET_CAP.toNumber());
    assert.equal(state.tauLamports.toNumber(), TAU_LAMPORTS.toNumber());
    assert.equal(state.saleAllocation.toNumber(), SALE_ALLOCATION.toNumber());
    assert.equal(state.lpAllocation.toNumber(), LP_ALLOCATION.toNumber());
    assert.isFalse(state.fundingOpen);
    assert.isFalse(state.depositsClosed);
    assert.equal(state.totalDeposited.toNumber(), 0);
    assert.equal(state.totalTickets, 0);
    assert.equal(state.kCapacity, 0);
    assert.isFalse(state.selectionFinalized);
    assert.equal(state.selectionProcessed, 0);
    assert.isNull(state.thresholdScore);
    assert.isNull(state.vrfSeed);
    assert.isFalse(state.claimsOpen);
    assert.isNull(state.tokensPerTicket);
    assert.ok(state.saleMint.equals(saleMint.publicKey));
  });

  it("Opens funding", async () => {
    const openFundingTx = await txBuilder.openFundingTx({
      launch: launchState,
      admin: admin.publicKey,
    });

    const openTx = await provider.sendAndConfirm(openFundingTx, [admin.payer]);
    console.log("Open funding tx signature:", openTx);

    const state = await txBuilder.fetchLaunchState(launchState, provider);
    assert.isTrue(state.fundingOpen);
  });


  it("Closes funding", async () => {
    const { transaction: initRosterTx, rosterPda } = await txBuilder.initRosterTx({
      launch: launchState,
      admin: admin.publicKey,
    });

    const rosterTx = await provider.sendAndConfirm(initRosterTx, [admin.payer]);
    console.log("Init roster tx signature:", rosterTx);

    const closeDepositsTx = await txBuilder.closeDepositsTx({
      launch: launchState,
      admin: admin.publicKey,
      roster: rosterPda,
    });

    const closeTx = await provider.sendAndConfirm(closeDepositsTx, [admin.payer]);
    console.log("Close deposits tx signature:", closeTx);

    const state = await txBuilder.fetchLaunchState(launchState, provider);
    assert.isFalse(state.fundingOpen);
    assert.isTrue(state.depositsClosed);
  });

  it("Sets the VRF seed", async () => {
    const testSeed = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      testSeed[i] = i + 1;
    }

    const { transaction: setSeedTx, selectionPda } = await txBuilder.setSeedTx({
      launch: launchState,
      admin: admin.publicKey,
      seed: testSeed,
    });

    const seedTx = await provider.sendAndConfirm(setSeedTx, [admin.payer]);
    console.log("Set VRF seed tx signature:", seedTx);

    const state = await txBuilder.fetchLaunchState(launchState, provider);
    assert.isNotNull(state.vrfSeed);
    
    const selectionState = await txBuilder.fetchSelectionState(selectionPda, provider);
    assert.deepEqual(Array.from(selectionState.vrfSeed), Array.from(testSeed));
  });


  it("Allows deposits", async () => {
    const testSaleMint = anchor.web3.Keypair.generate();

    const testResult = await txBuilder.initLaunchTx({
      admin: admin.publicKey,
      saleMint: testSaleMint,
      hardCapLamports: HARD_CAP_LAMPORTS,
      minRaiseLamports: MIN_RAISE_LAMPORTS,
      perWalletCap: PER_WALLET_CAP,
      tauLamports: TAU_LAMPORTS,
      saleAllocation: SALE_ALLOCATION,
      lpAllocation: LP_ALLOCATION,
      provider,
    });

    await provider.sendAndConfirm(testResult.transaction, [admin.payer, ...testResult.signers]);

    const testOpenTx = await txBuilder.openFundingTx({
      launch: testResult.launchState,
      admin: admin.publicKey,
    });
    await provider.sendAndConfirm(testOpenTx, [admin.payer]);

    const testRosterResult = await txBuilder.initRosterTx({
      launch: testResult.launchState,
      admin: admin.publicKey,
    });
    await provider.sendAndConfirm(testRosterResult.transaction, [admin.payer]);

    const depositAmount = TAU_LAMPORTS;
    const { transaction: depositTx, userContribution } = await txBuilder.depositTx({
      launch: testResult.launchState,
      user: admin.publicKey,
      amount: depositAmount,
    });

    const depTx = await provider.sendAndConfirm(depositTx, [admin.payer]);
    console.log("Deposit tx signature:", depTx);

    const userContrib = await txBuilder.fetchUserContribution(userContribution, provider);
    assert.equal(userContrib.deposited.toNumber(), depositAmount.toNumber());
    assert.equal(userContrib.ticketCount, 1);

    const state = await txBuilder.fetchLaunchState(testResult.launchState, provider);
    assert.equal(state.totalDeposited.toNumber(), depositAmount.toNumber());
    assert.equal(state.totalTickets, 1);
  });
  
});