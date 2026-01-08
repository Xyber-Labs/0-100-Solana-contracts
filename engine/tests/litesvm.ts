import { fromWorkspace, LiteSVMProvider } from "anchor-litesvm";
import { FailedTransactionMetadata, LiteSVM } from "litesvm";
import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import bs58 from "bs58";
import { SendTransactionError } from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  unpackAccount
} from "@solana/spl-token";
import { assert } from "chai";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

import { Engine } from "../target/types/engine";
import EngineSDK from "../ts-sdk/src/engine";

import {
  advanceTime,
  createAndFundAccount,
  doAndCheckError,
  injectSlotHashesForRange,
  parsePresetParams
} from "./utils";
import { setupRaydiumCLMM } from "./raydium-setup";

function ensureRaydiumResources(): void {
  const dirA = path.resolve(__dirname, "resources");
  const dirB = path.resolve(__dirname, "recources");
  if (!fs.existsSync(dirA) && !fs.existsSync(dirB)) {
    const script = path.resolve(__dirname, "dump-raydium.sh");
    execSync(`bash "${script}"`, { stdio: "inherit", cwd: path.resolve(__dirname, "..") });
    const nested = path.resolve(__dirname, "tests", "resources");
    if (fs.existsSync(nested) && !fs.existsSync(dirA)) {
      fs.mkdirSync(path.dirname(dirA), { recursive: true });
      try { fs.renameSync(nested, dirA); } catch {}
      try { fs.rmdirSync(path.resolve(__dirname, "tests")); } catch {}
    }
  }
}

ensureRaydiumResources();

let client: LiteSVM;
let provider: LiteSVMProvider;
let program: Program<Engine>;
let admin: anchor.Wallet;
let sdk: ReturnType<typeof EngineSDK.create>;
let adminKeypair: anchor.web3.Keypair;
let xyberMint: anchor.web3.PublicKey;

function bigIntTo32BytesBE(x: bigint): Buffer {
  const buf = Buffer.alloc(32);
  let v = x;
  for (let i = 31; i >= 0; i--) {
    buf[i] = Number(v & BigInt(255));
    v = v >> BigInt(8);
  }
  return buf;
}

function encodeSignatureSafe(sigRaw: any): string {
  if (!sigRaw) throw new Error("Missing signature");
  if (typeof sigRaw === "string") return sigRaw;
  if (Array.isArray(sigRaw)) return bs58.encode(Uint8Array.from(sigRaw));
  if (sigRaw instanceof Uint8Array) return bs58.encode(sigRaw);
  if (Buffer.isBuffer(sigRaw)) return bs58.encode(new Uint8Array(sigRaw));
  if (sigRaw?.buffer && typeof sigRaw.byteLength === "number") {
    return bs58.encode(new Uint8Array(sigRaw.buffer, sigRaw.byteOffset ?? 0, sigRaw.byteLength));
  }
  if (sigRaw?.data) {
    try { return bs58.encode(Uint8Array.from(sigRaw.data)); } catch { }
  }
  throw new TypeError("Unsupported signature type for encoding");
}

function sendTxWithMeta(
  client: LiteSVM,
  feePayer: anchor.web3.PublicKey,
  signers: anchor.web3.Keypair[],
  instructions: anchor.web3.TransactionInstruction | anchor.web3.TransactionInstruction[] | anchor.web3.Transaction,
): { signature: string; computeUnitsConsumed: bigint } {
  let tx: anchor.web3.Transaction;
  if (instructions instanceof anchor.web3.Transaction) {
    tx = instructions;
  } else if (Array.isArray(instructions)) {
    tx = new anchor.web3.Transaction().add(...instructions);
  } else {
    tx = new anchor.web3.Transaction().add(instructions);
  }
  tx.feePayer = feePayer;
  tx.recentBlockhash = client.latestBlockhash();
  signers.forEach((s) => tx.partialSign(s));
  const sigRaw = tx.signature;
  const signature = encodeSignatureSafe(sigRaw);
  const res = client.sendTransaction(tx);
  if (res instanceof FailedTransactionMetadata) {
    throw new SendTransactionError({
      action: "send",
      signature,
      transactionMessage: res.err().toString(),
      logs: res.meta().logs(),
    } as any);
  }
  return { signature, computeUnitsConsumed: res.computeUnitsConsumed() };
}

function sendTx(
  client: LiteSVM,
  feePayer: anchor.web3.PublicKey,
  signers: anchor.web3.Keypair[],
  instructions: anchor.web3.TransactionInstruction | anchor.web3.TransactionInstruction[] | anchor.web3.Transaction,
): string {
  return sendTxWithMeta(client, feePayer, signers, instructions).signature;
}

describe("engine litesvm", () => {

  let launchState: anchor.web3.PublicKey;

  const presetPath = path.resolve(__dirname, "litesvm-test-preset.json");
  const presetData = JSON.parse(fs.readFileSync(presetPath, "utf8"));
  const presetParams = parsePresetParams(presetData);

  let adminBKeypair: anchor.web3.Keypair;
  let treasuryPubkey: anchor.web3.PublicKey;

  before(async () => {
    client = fromWorkspace("./");
    provider = new LiteSVMProvider(client);
    anchor.setProvider(provider);
    program = anchor.workspace.engine as Program<Engine>;
    admin = provider.wallet;
    adminKeypair = (provider.wallet as any).payer;
    sdk = EngineSDK.create(provider as any, program as any, adminKeypair);

    client.airdrop(admin.publicKey, BigInt(500 * anchor.web3.LAMPORTS_PER_SOL));

    adminBKeypair = anchor.web3.Keypair.generate();

    // Initialize XYBER mint and engine config
    const mint = anchor.web3.Keypair.generate();
    const rent = await provider.connection.getMinimumBalanceForRentExemption(82);
    const creatorAta = sdk.getUserAta(mint.publicKey, admin.publicKey);
    const treasuryKeypair = anchor.web3.Keypair.generate();
    client.airdrop(treasuryKeypair.publicKey, BigInt(1_000_000));
    treasuryPubkey = treasuryKeypair.publicKey;

    const initMintTx = new anchor.web3.Transaction()
      .add(anchor.web3.SystemProgram.createAccount({ fromPubkey: admin.publicKey, newAccountPubkey: mint.publicKey, space: 82, lamports: rent, programId: TOKEN_PROGRAM_ID }))
      .add(createInitializeMintInstruction(mint.publicKey, 6, admin.publicKey, null))
      .add(sdk.buildCreateAtaIx({ payer: admin.publicKey, owner: admin.publicKey, mint: mint.publicKey }).ix)
      .add(sdk.buildCreateAtaIx({ payer: admin.publicKey, owner: treasuryPubkey, mint: mint.publicKey }).ix)
      .add(createMintToInstruction(mint.publicKey, creatorAta, admin.publicKey, BigInt(1_000_000_000)));
    sendTx(client, admin.publicKey, [adminKeypair, mint], initMintTx);

    const admins: [anchor.web3.PublicKey, anchor.web3.PublicKey, anchor.web3.PublicKey] = [admin.publicKey, adminBKeypair.publicKey, anchor.web3.Keypair.generate().publicKey];
    const { instruction: initConfigIx } = await (sdk as any).initEngineConfigIx({
      payer: admin.publicKey,
      treasury: treasuryPubkey,
      xyberMint: mint.publicKey,
      admins,
      threshold: 2,
      reallocFundLamports: new BN(100 * anchor.web3.LAMPORTS_PER_SOL),
      signerAdmins: [admin.publicKey, adminBKeypair.publicKey],
    });
    sendTx(client, admin.publicKey, [adminKeypair, adminBKeypair], initConfigIx);
    xyberMint = mint.publicKey;
  });

  it("Initializes engine config with XYBER mint", async () => {
    const { data: config } = await sdk.fetchEngineConfig();
    assert.ok(config, "EngineConfig should exist");
    assert.ok(config.xyberMint.equals(xyberMint));
    assert.ok(config.treasury.equals(treasuryPubkey));
    assert.equal(config.threshold, 2);
  });

  it("Initializes launch preset from file", async () => {
    const { instruction: presetIx } = await (sdk as any).initLaunchPresetIx({
      payer: admin.publicKey,
      id: Number(presetData.id),
      ...presetParams,
      signerAdmins: [admin.publicKey, adminBKeypair.publicKey],
    });
    sendTx(client, adminKeypair.publicKey, [adminKeypair, adminBKeypair], presetIx);

    const { data: preset } = await sdk.fetchLaunchPreset(Number(presetData.id));
    assert.ok(preset, "Preset should exist");
    assert.equal(preset.hardCapLamports.toNumber(), 450_000_000_000);
    assert.equal(preset.minRaiseLamports.toNumber(), 100_000_000_000);
    assert.equal(preset.tauLamports.toNumber(), 100_000_000);
    assert.equal(preset.fundingDurationSeconds, 3);
    assert.equal(preset.withdrawalLimit, 3);
  });

  it("Initializes the launch state correctly", async () => {
    const nextId = await sdk.getNextProjectId();

    const { instruction, launchState: launchPda } = await (sdk as any).initLaunchFromPresetIx({
      creator: admin.publicKey,
      presetId: Number(presetData.id),
      projectId: nextId,
      saleStartTimeTimestamp: 0,
      name: "TestToken",
      symbol: "TEST",
      uri: "https://example.com/metadata.json",
    });

    const initTx = sendTx(client, adminKeypair.publicKey, [adminKeypair], instruction);
    console.log("Init launch tx signature:", initTx);

    launchState = launchPda;
    const { data: state } = await sdk.fetchLaunch(launchState);

    assert.isTrue(state.projectId.toNumber() >= 0, "Project ID should be non-negative");
    assert.ok(state.creator.equals(admin.publicKey));
    assert.ok(state.preset, "Preset should be set");
    assert.isNull(state.baseMint);
  });

  it("Rejects initLaunch with wrong XYBER mint", async () => {
    const nextId = await sdk.getNextProjectId();
    const fee = new anchor.BN(presetData.creationFee);

    const wrongMintKp = anchor.web3.Keypair.generate();
    const wrongMint = wrongMintKp.publicKey;
    const rent = await provider.connection.getMinimumBalanceForRentExemption(82);
    const creatorAta = getAssociatedTokenAddressSync(wrongMint, admin.publicKey);
    const treasuryAta = getAssociatedTokenAddressSync(wrongMint, treasuryPubkey);
    {
      const tx = new anchor.web3.Transaction()
        .add(anchor.web3.SystemProgram.createAccount({ fromPubkey: admin.publicKey, newAccountPubkey: wrongMint, space: 82, lamports: rent, programId: TOKEN_PROGRAM_ID }))
        .add(createInitializeMintInstruction(wrongMint, 6, admin.publicKey, null))
        .add(createAssociatedTokenAccountInstruction(admin.publicKey, creatorAta, admin.publicKey, wrongMint))
        .add(createAssociatedTokenAccountInstruction(admin.publicKey, treasuryAta, treasuryPubkey, wrongMint))
        .add(createMintToInstruction(wrongMint, creatorAta, admin.publicKey, BigInt(fee.toString())));
      sendTx(client, adminKeypair.publicKey, [adminKeypair, wrongMintKp], tx);
    }

    const { instruction } = await (sdk as any).initLaunchFromPresetIx({
      creator: admin.publicKey,
      presetId: Number(presetData.id),
      projectId: nextId,
      saleStartTimeTimestamp: 0,
      name: "WrongMintTest",
      symbol: "WMT",
      uri: "https://example.com/wmt.json",
      xyberMint: wrongMint,
    });
    await doAndCheckError(
      (async () => sendTx(client, adminKeypair.publicKey, [adminKeypair], instruction))(),
      "InvalidMint"
    );
  });

  it("Allows deposits", async () => {
    const depositor = await createAndFundAccount(client, 20);
    const depositAmount = new anchor.BN(10 * anchor.web3.LAMPORTS_PER_SOL);

    const { instruction } = await sdk.depositIx({
      launch: launchState,
      contributor: depositor.publicKey,
      amount: depositAmount,
    });

    sendTx(client, depositor.publicKey, [depositor], instruction);

    const { data: userContrib } = await sdk.fetchContribution(launchState, depositor.publicKey);
    assert.equal(userContrib.ticketRanges.length, 1, "Should have 1 range");
    assert.equal(userContrib.ticketRanges[0].start.toNumber(), 0, "Range should start at 0");
    assert.equal(userContrib.ticketRanges[0].end.toNumber(), 100, "Range should end at 100");

    const totalTickets = userContrib.ticketRanges.reduce(
      (sum: number, r: any) => sum + (r.end.toNumber() - r.start.toNumber()),
      0
    );
    assert.equal(totalTickets, 100, "Should have 100 tickets for 10 SOL deposit");

    const { data: lottery } = await sdk.fetchLotteryControl(launchState);
    assert.equal(lottery.bitsAllocated.toNumber(), 100, "bits_allocated should be 100");
  });

  it("Allows withdrawals", async () => {
    const { data: lotteryInitial } = await sdk.fetchLotteryControl(launchState);
    const initialBitsAllocated = lotteryInitial.bitsAllocated.toNumber();
    assert.equal(initialBitsAllocated, 100, "Initial bits_allocated from previous test");

    const depositor = await createAndFundAccount(client, 20);
    const depositAmount = new anchor.BN(5 * anchor.web3.LAMPORTS_PER_SOL); // 50 tickets
    const withdrawAmount = new anchor.BN(2 * anchor.web3.LAMPORTS_PER_SOL); // 20 tickets

    const { instruction: depositIx } = await sdk.depositIx({
      launch: launchState,
      contributor: depositor.publicKey,
      amount: depositAmount,
    });
    sendTx(client, depositor.publicKey, [depositor], depositIx);

    const { data: contribBefore } = await sdk.fetchContribution(launchState, depositor.publicKey);
    assert.equal(contribBefore.ticketRanges.length, 1, "Should have 1 range after deposit");
    assert.equal(contribBefore.ticketRanges[0].start.toNumber(), 100, "Range start should be 100");
    assert.equal(contribBefore.ticketRanges[0].end.toNumber(), 150, "Range end should be 150");

    const { data: lotteryAfterDeposit } = await sdk.fetchLotteryControl(launchState);
    assert.equal(lotteryAfterDeposit.bitsAllocated.toNumber(), 150, "bits_allocated should be 150 after deposit");

    const balanceBefore = client.getBalance(depositor.publicKey);

    const { instruction: withdrawIx } = await sdk.withdrawIx({
      launch: launchState,
      contributor: depositor.publicKey,
      amount: withdrawAmount,
    });
    sendTx(client, depositor.publicKey, [depositor], withdrawIx);

    const balanceAfter = client.getBalance(depositor.publicKey);
    const balanceDiff = Number(balanceAfter) - Number(balanceBefore);
    const txFee = 5000; // LiteSVM transaction fee
    assert.equal(balanceDiff + txFee, 2 * anchor.web3.LAMPORTS_PER_SOL, "Should receive exactly 2 SOL back minus tx fee");

    const { data: contribAfter } = await sdk.fetchContribution(launchState, depositor.publicKey);
    assert.equal(contribAfter.ticketRanges.length, 1, "Should still have 1 range");
    assert.equal(contribAfter.ticketRanges[0].start.toNumber(), 100, "Range start unchanged at 100");
    assert.equal(contribAfter.ticketRanges[0].end.toNumber(), 130, "Range end should be 130 after withdraw");

    const { data: lotteryAfterWithdraw } = await sdk.fetchLotteryControl(launchState);
    assert.equal(lotteryAfterWithdraw.bitsAllocated.toNumber(), 150, "bits_allocated unchanged after withdrawal");
    assert.equal(lotteryAfterWithdraw.inactiveCount.toNumber(), 20, "inactive_count should be 20 after withdrawing 20 tickets");
  });

  it("Project ID increments correctly", async () => {
    const { data: counterBefore } = await sdk.fetchProjectCounter();
    const lastIdBefore = counterBefore.lastProjectId.toNumber();

    // Create project 1
    const projectId1 = await sdk.getNextProjectId();
    assert.equal(projectId1.toNumber(), lastIdBefore + 1, "Next project ID should be lastId + 1");

    const { instruction: ix1, launchState: launch1 } = await (sdk as any).initLaunchFromPresetIx({
      creator: admin.publicKey,
      presetId: Number(presetData.id),
      projectId: projectId1,
      saleStartTimeTimestamp: 0,
      name: "Project1",
      symbol: "P1",
      uri: "https://example.com/p1.json",
    });
    sendTx(client, adminKeypair.publicKey, [adminKeypair], ix1);

    const projectId2 = await sdk.getNextProjectId();
    assert.equal(projectId2.toNumber(), projectId1.toNumber() + 1, "Project 2 ID should be project1 + 1");

    const { instruction: ix2, launchState: launch2 } = await (sdk as any).initLaunchFromPresetIx({
      creator: admin.publicKey,
      presetId: Number(presetData.id),
      projectId: projectId2,
      saleStartTimeTimestamp: 0,
      name: "Project2",
      symbol: "P2",
      uri: "https://example.com/p2.json",
    });
    sendTx(client, adminKeypair.publicKey, [adminKeypair], ix2);

    const projectId3 = await sdk.getNextProjectId();
    assert.equal(projectId3.toNumber(), projectId2.toNumber() + 1, "Project 3 ID should be project2 + 1");

    const { instruction: ix3, launchState: launch3 } = await (sdk as any).initLaunchFromPresetIx({
      creator: admin.publicKey,
      presetId: Number(presetData.id),
      projectId: projectId3,
      saleStartTimeTimestamp: 0,
      name: "Project3",
      symbol: "P3",
      uri: "https://example.com/p3.json",
    });
    sendTx(client, adminKeypair.publicKey, [adminKeypair], ix3);

    const { data: state1 } = await sdk.fetchLaunch(launch1);
    const { data: state2 } = await sdk.fetchLaunch(launch2);
    const { data: state3 } = await sdk.fetchLaunch(launch3);

    assert.equal(state1.projectId.toNumber(), projectId1.toNumber(), "Launch 1 projectId mismatch");
    assert.equal(state2.projectId.toNumber(), projectId2.toNumber(), "Launch 2 projectId mismatch");
    assert.equal(state3.projectId.toNumber(), projectId3.toNumber(), "Launch 3 projectId mismatch");

    // Verify counter updated
    const { data: counterAfter } = await sdk.fetchProjectCounter();
    assert.equal(counterAfter.lastProjectId.toNumber(), projectId3.toNumber(), "Counter should equal last project ID");
  });

  it("Deposit respects perWalletCap limit", async () => {
    const perWalletCap = new anchor.BN(presetData.perWalletCap);
    const tau = new anchor.BN(presetData.tauLamports);
    const depositor = await createAndFundAccount(client, 300);

    const deposit1 = new anchor.BN(150 * anchor.web3.LAMPORTS_PER_SOL);
    const tickets1 = deposit1.div(tau).toNumber();
    const { instruction: depIx1 } = await sdk.depositIx({
      contributor: depositor.publicKey,
      launch: launchState,
      amount: deposit1,
    });
    sendTx(client, depositor.publicKey, [depositor], depIx1);

    const { data: contrib1 } = await sdk.fetchContribution(launchState, depositor.publicKey);
    const totalTickets1 = contrib1.ticketRanges.reduce((sum: number, r: any) => sum + (r.end.toNumber() - r.start.toNumber()), 0);
    assert.equal(totalTickets1, tickets1, "First deposit tickets mismatch");

    const deposit2 = new anchor.BN(100 * anchor.web3.LAMPORTS_PER_SOL);
    await doAndCheckError(
      (async () => {
        const { instruction: depIx2 } = await sdk.depositIx({
          contributor: depositor.publicKey,
          launch: launchState,
          amount: deposit2,
        });
        sendTx(client, depositor.publicKey, [depositor], depIx2);
      })(),
      "PerWalletCapExceeded"
    );

    const deposit3 = new anchor.BN(50 * anchor.web3.LAMPORTS_PER_SOL);
    const { instruction: depIx3 } = await sdk.depositIx({
      contributor: depositor.publicKey,
      launch: launchState,
      amount: deposit3,
    });
    sendTx(client, depositor.publicKey, [depositor], depIx3);

    const { data: contribFinal } = await sdk.fetchContribution(launchState, depositor.publicKey);
    const totalTicketsFinal = contribFinal.ticketRanges.reduce((sum: number, r: any) => sum + (r.end.toNumber() - r.start.toNumber()), 0);
    const expectedTickets = perWalletCap.div(tau).toNumber();
    assert.equal(totalTicketsFinal, expectedTickets, "Final tickets should equal perWalletCap / tau");
  });

  it("Blockhash verification in finalizeLottery", async () => {
    const SLOT_HASHES_SYSVAR = new anchor.web3.PublicKey("SysvarS1otHashes111111111111111111111111111");

    const nextId = await sdk.getNextProjectId();
    const { instruction, launchState: testLaunch } = await (sdk as any).initLaunchFromPresetIx({
      creator: admin.publicKey,
      presetId: Number(presetData.id),
      projectId: nextId,
      saleStartTimeTimestamp: 0,
      name: "BlockhashTest",
      symbol: "BHT",
      uri: "https://example.com/bht.json",
    });
    sendTx(client, adminKeypair.publicKey, [adminKeypair], instruction);

    const minRaise = new anchor.BN(presetData.minRaiseLamports);
    const perWallet = new anchor.BN(presetData.perWalletCap);
    let totalDeposited = new anchor.BN(0);

    while (totalDeposited.lt(minRaise)) {
      const depositor = await createAndFundAccount(client, 250);
      const remaining = minRaise.sub(totalDeposited);
      const amount = remaining.gt(perWallet) ? perWallet : remaining;

      const { instruction: depIx } = await sdk.depositIx({
        contributor: depositor.publicKey,
        launch: testLaunch,
        amount,
      });
      sendTx(client, depositor.publicKey, [depositor], depIx);
      totalDeposited = totalDeposited.add(amount);
    }

    await advanceTime(client, { slots: BigInt(100), seconds: BigInt(presetData.fundingDurationSeconds + 10) });

    const { instruction: seedIx } = await sdk.setSeedIx({ launch: testLaunch, payer: admin.publicKey });
    sendTx(client, adminKeypair.publicKey, [adminKeypair], seedIx);

    let { data: lottery } = await sdk.fetchLotteryControl(testLaunch);
    assert.ok(lottery.status.seeded, "Lottery should be seeded before finalizeLottery");

    const { data: launchAccount } = await sdk.fetchLaunch(testLaunch);
    const { data: presetAccount } = await sdk.fetchLaunchPreset(Number(presetData.id));
    const currentClock = client.getClock();

    const projectId = launchAccount.projectId.toNumber();
    const unlock = Number(presetAccount.unlockTimeSec);
    const computedN = BigInt(unlock > 0 ? unlock * 17 : 100);
    const width = ((BigInt(1) << BigInt(256)) - BigInt(1)) / computedN;
    const rangeStart = width * BigInt(projectId - 1);
    const rangeEnd = rangeStart + width;

    const numHashes = 512;
    const slotHashesDataInvalid = Buffer.alloc(8 + numHashes * 40);
    slotHashesDataInvalid.writeBigUInt64LE(BigInt(numHashes), 0);
    for (let i = 0; i < numHashes; i++) {
      const offset = 8 + i * 40;
      slotHashesDataInvalid.writeBigUInt64LE(currentClock.slot + BigInt(i + 1), offset);
      bigIntTo32BytesBE(rangeEnd).copy(slotHashesDataInvalid, offset + 8); // rangeEnd is outside valid range
    }
    client.setAccount(SLOT_HASHES_SYSVAR, {
      lamports: 1_000_000,
      data: slotHashesDataInvalid,
      owner: anchor.web3.SystemProgram.programId,
      executable: false,
    });

    await doAndCheckError(
      (async () => {
        const { transaction } = await sdk.finalizeLotteryTx({ payer: admin.publicKey, launch: testLaunch });
        sendTx(client, adminKeypair.publicKey, [adminKeypair], transaction);
      })(),
      "NoValidBlockhash"
    );


    ({ data: lottery } = await sdk.fetchLotteryControl(testLaunch));
    assert.ok(lottery.status.seeded, "Lottery should still be seeded after failed finalizeLottery");

    const slotHashesDataValid = Buffer.alloc(8 + numHashes * 40);
    slotHashesDataValid.writeBigUInt64LE(BigInt(numHashes), 0);
    for (let i = 0; i < numHashes; i++) {
      const offset = 8 + i * 40;
      slotHashesDataValid.writeBigUInt64LE(currentClock.slot + BigInt(i + 1), offset);
      if (i === numHashes - 1) {
        bigIntTo32BytesBE(rangeStart).copy(slotHashesDataValid, offset + 8); // rangeStart is valid
      } else {
        bigIntTo32BytesBE(rangeEnd).copy(slotHashesDataValid, offset + 8);
      }
    }

    client.setAccount(SLOT_HASHES_SYSVAR, {
      lamports: 1_000_000,
      data: slotHashesDataValid,
      owner: anchor.web3.SystemProgram.programId,
      executable: false,
    });

    const { transaction } = await sdk.finalizeLotteryTx({
      payer: admin.publicKey,
      launch: testLaunch,
      computeUnits: 2_000_000,
    });
    sendTx(client, adminKeypair.publicKey, [adminKeypair], transaction);

    ({ data: lottery } = await sdk.fetchLotteryControl(testLaunch));
    assert.ok(lottery.status.finalized, "Lottery should be finalized after finalizeLottery");

    const { data: launchAfter } = await sdk.fetchLaunch(testLaunch);
    assert.ok(launchAfter.claimsOpenedAt !== null, "claims_opened_at should be set");
  });

  it("Grace period: invalid hashes fail within grace; succeed after", async () => {
    const SLOT_HASHES_SYSVAR = new anchor.web3.PublicKey("SysvarS1otHashes111111111111111111111111111");

    // Create a fresh launch for this test
    const nextId = await sdk.getNextProjectId();
    const { instruction, launchState: testLaunch } = await (sdk as any).initLaunchFromPresetIx({
      creator: admin.publicKey,
      presetId: Number(presetData.id),
      projectId: nextId,
      saleStartTimeTimestamp: 0,
      name: "GracePeriodTest",
      symbol: "GPT",
      uri: "https://example.com/gpt.json",
    });
    sendTx(client, adminKeypair.publicKey, [adminKeypair], instruction);

    // Deposit enough to meet min_raise
    const minRaise = new anchor.BN(presetData.minRaiseLamports);
    const perWallet = new anchor.BN(presetData.perWalletCap);
    let totalDeposited = new anchor.BN(0);

    while (totalDeposited.lt(minRaise)) {
      const depositor = await createAndFundAccount(client, 250);
      const remaining = minRaise.sub(totalDeposited);
      const amount = remaining.gt(perWallet) ? perWallet : remaining;

      const { instruction: depIx } = await sdk.depositIx({
        contributor: depositor.publicKey,
        launch: testLaunch,
        amount,
      });
      sendTx(client, depositor.publicKey, [depositor], depIx);
      totalDeposited = totalDeposited.add(amount);
    }

    // Advance time beyond funding period
    await advanceTime(client, { slots: BigInt(100), seconds: BigInt(presetData.fundingDurationSeconds + 10) });

    // Set VRF seed
    const { instruction: seedIx } = await sdk.setSeedIx({ launch: testLaunch, payer: admin.publicKey });
    sendTx(client, adminKeypair.publicKey, [adminKeypair], seedIx);

    // Verify lottery is still in progress
    let { data: lottery } = await sdk.fetchLotteryControl(testLaunch);
    assert.ok(lottery.status.seeded, "Lottery should be seeded before finalizeLottery");

    // Get launch state for blockhash range calculation
    const { data: launchAccount } = await sdk.fetchLaunch(testLaunch);
    const { data: presetAccount } = await sdk.fetchLaunchPreset(Number(presetData.id));
    const currentClock = client.getClock();

    // Compute project's personal blockhash range
    const projectId = launchAccount.projectId.toNumber();
    const unlock = Number(presetAccount.unlockTimeSec);
    const computedN = BigInt(unlock > 0 ? unlock * 17 : 100);
    const width = ((BigInt(1) << BigInt(256)) - BigInt(1)) / computedN;
    const rangeStart = width * BigInt(projectId - 1);
    const rangeEnd = rangeStart + width;

    // Write INVALID SlotHashes (all hashes outside project's range)
    const numHashes = 512;
    const slotHashesDataInvalid = Buffer.alloc(8 + numHashes * 40);
    slotHashesDataInvalid.writeBigUInt64LE(BigInt(numHashes), 0);
    for (let i = 0; i < numHashes; i++) {
      const offset = 8 + i * 40;
      slotHashesDataInvalid.writeBigUInt64LE(currentClock.slot + BigInt(i + 1), offset);
      bigIntTo32BytesBE(rangeEnd).copy(slotHashesDataInvalid, offset + 8); // rangeEnd is outside valid range
    }
    client.setAccount(SLOT_HASHES_SYSVAR, {
      lamports: 1_000_000,
      data: slotHashesDataInvalid,
      owner: anchor.web3.SystemProgram.programId,
      executable: false,
    });

    // Within grace period: should fail with NoValidBlockhash
    await doAndCheckError(
      (async () => {
        const { transaction } = await sdk.finalizeLotteryTx({ payer: admin.publicKey, launch: testLaunch });
        sendTx(client, adminKeypair.publicKey, [adminKeypair], transaction);
      })(),
      "NoValidBlockhash"
    );

    // Verify lottery still seeded after failed attempt
    ({ data: lottery } = await sdk.fetchLotteryControl(testLaunch));
    assert.ok(lottery.status.seeded, "Lottery should still be seeded after failed finalizeLottery");

    // Advance time beyond grace period
    const gracePeriod = Number(presetAccount.poolCreationGracePeriodSec);
    await advanceTime(client, { slots: BigInt(100), seconds: BigInt(gracePeriod + 10) });

    // After grace period expires, finalizeLottery should succeed even with invalid hashes
    // (because random_pool_creation_expired becomes true)
    const { transaction } = await sdk.finalizeLotteryTx({
      payer: admin.publicKey,
      launch: testLaunch,
      computeUnits: 2_000_000,
    });
    sendTx(client, adminKeypair.publicKey, [adminKeypair], transaction);

    // Verify lottery is now finalized
    ({ data: lottery } = await sdk.fetchLotteryControl(testLaunch));
    assert.ok(lottery.status.finalized, "Lottery should be finalized after grace period expired");

    // Verify claims_opened_at is set
    const { data: launchAfter } = await sdk.fetchLaunch(testLaunch);
    assert.ok(launchAfter.claimsOpenedAt !== null, "claims_opened_at should be set");
  });

  it("Success flow: deposit → lottery → pool → claim → refund", async () => {
    // === Step 1: Create launch ===
    const nextId = await sdk.getNextProjectId();
    const { instruction, launchState: testLaunch } = await (sdk as any).initLaunchFromPresetIx({
      creator: admin.publicKey,
      presetId: Number(presetData.id),
      projectId: nextId,
      saleStartTimeTimestamp: 0,
      name: "SuccessFlowTest",
      symbol: "SFT",
      uri: "https://example.com/sft.json",
    });
    sendTx(client, adminKeypair.publicKey, [adminKeypair], instruction);
    console.log("✅ Step 1: Launch created");

    // === Step 2: Deposits ===
    const { data: preset } = await sdk.fetchLaunchPreset(Number(presetData.id));
    const tau = preset.tauLamports;

    // Creator deposits 10 tickets (1 SOL with tau=0.1 SOL)
    const creatorTickets = 10;
    const creatorDepositAmount = new BN(tau.toString()).muln(creatorTickets);
    const { instruction: creatorDepIx } = await sdk.depositIx({
      contributor: admin.publicKey,
      launch: testLaunch,
      amount: creatorDepositAmount,
    });
    sendTx(client, adminKeypair.publicKey, [adminKeypair], creatorDepIx);

    // Contributor deposits to meet min_raise
    const minRaise = preset.minRaiseLamports;
    const contributorDepositAmount = minRaise.sub(creatorDepositAmount);
    const contributorTickets = contributorDepositAmount.div(tau).toNumber();

    const contributor = await createAndFundAccount(client, 250);
    const { instruction: contribDepIx } = await sdk.depositIx({
      contributor: contributor.publicKey,
      launch: testLaunch,
      amount: contributorDepositAmount,
    });
    sendTx(client, contributor.publicKey, [contributor], contribDepIx);

    const totalTickets = creatorTickets + contributorTickets;
    console.log(`✅ Step 2: Deposits complete (creator: ${creatorTickets} tickets, contributor: ${contributorTickets} tickets, total: ${totalTickets})`);

    // === Step 3: Finalize lottery ===
    await advanceTime(client, { slots: BigInt(100), seconds: BigInt(preset.fundingDurationSeconds + 10) });

    const { instruction: seedIx } = await sdk.setSeedIx({ launch: testLaunch, payer: admin.publicKey });
    sendTx(client, adminKeypair.publicKey, [adminKeypair], seedIx);

    const { data: launchAccount } = await sdk.fetchLaunch(testLaunch);
    const projectId = launchAccount.projectId.toNumber();
    const unlock = Number(preset.unlockTimeSec);
    const computedN = BigInt(unlock > 0 ? unlock * 17 : 100);
    const width = ((BigInt(1) << BigInt(256)) - BigInt(1)) / computedN;
    const rangeStart = width * BigInt(projectId - 1);
    const rangeEnd = rangeStart + width;
    injectSlotHashesForRange(client, rangeStart, rangeEnd);

    const { transaction: prepTx } = await sdk.finalizeLotteryTx({
      payer: admin.publicKey,
      launch: testLaunch,
      computeUnits: 2_000_000,
    });
    sendTx(client, adminKeypair.publicKey, [adminKeypair], prepTx);

    const { data: lottery } = await sdk.fetchLotteryControl(testLaunch);
    assert.ok(lottery.status.finalized, "Lottery should be finalized");

    // Verify k_capacity >= totalTickets (all tickets win)
    const kCapacity = preset.hardCapLamports.div(tau).toNumber();
    assert.ok(kCapacity >= totalTickets, "All tickets should win when k_capacity >= totalTickets");

    // Calculate expected values using BigInt for precision
    // sale_allocation = baseTotalAllocation * baseSaleBasisPoints / 10000
    const baseTotalAllocationBigInt = BigInt("1000000000000000000");
    const saleAllocationBigInt = baseTotalAllocationBigInt * BigInt(preset.baseSaleBasisPoints) / BigInt(10000);
    // All tickets win, so winners = totalTickets
    // tokens_per_ticket = sale_allocation / winners
    const tokensPerTicket = saleAllocationBigInt / BigInt(totalTickets);

    console.log(`✅ Step 3: Lottery finalized (winners: ${totalTickets}, tokensPerTicket: ${tokensPerTicket.toString()})`);

    // === Step 4: Create CLMM pool ===
    const { raydiumProgramId, ammConfig } = await setupRaydiumCLMM(client);
    const WSOL_MINT = new anchor.web3.PublicKey("So11111111111111111111111111111111111111112");

    const clmmCreate = await sdk.createClmmPoolTx({
      payer: admin.publicKey,
      launch: testLaunch,
      quoteMint: WSOL_MINT,
      ammConfig,
      clmmProgram: raydiumProgramId,
      provider,
    });
    sendTx(client, admin.publicKey, [adminKeypair, ...clmmCreate.signers], clmmCreate.transaction);
    console.log(`✅ Step 4: CLMM pool created`);

    // === Step 5: Contributor claims Sale bucket ===
    // Vesting: contributorDurationSec=1, contributorPeriodSec=1
    // periods_count = 1, need elapsed >= 1 sec for periods_passed = 1
    // available = allocation * periods_passed / periods_count = allocation * 1 / 1 = full allocation
    const expectedContributorTokens = (tokensPerTicket * BigInt(contributorTickets)).toString();
    await advanceTime(client, { seconds: BigInt(preset.contributorDurationSec) });

    const { instruction: claimContribIx, participantAta: contribAta } = await sdk.claimIx({
      launch: testLaunch,
      baseMint: clmmCreate.baseMint,
      participant: contributor.publicKey,
      bucket: 0, // Sale
    });
    sendTx(client, contributor.publicKey, [contributor], [
      anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
      claimContribIx,
    ]);

    const contribAtaInfo = client.getAccount(contribAta);
    const unpacked = unpackAccount(contribAta, {
      ...(contribAtaInfo as any),
      data: Buffer.from(contribAtaInfo.data),
    } as any);
    const contribTokens = unpacked.amount.toString();
    assert.equal(contribTokens, expectedContributorTokens,
      `Contributor should receive exactly ${expectedContributorTokens} tokens`);
    console.log(`✅ Step 5: Contributor claimed ${contribTokens} tokens`);

    // === Step 6: Creator claims Team bucket ===
    // Vesting: teamDurationSec=60, teamPeriodSec=60
    // periods_count = 1, need elapsed >= 60 sec for periods_passed = 1
    // team_allocation = baseTotalAllocation * teamAllocationBasisPoints / 10000
    const expectedTeamTokens = (BigInt("1000000000000000000") * BigInt(preset.teamAllocationBasisPoints) / BigInt(10000)).toString();
    const creatorAta = getAssociatedTokenAddressSync(clmmCreate.baseMint, admin.publicKey, true);

    // Advance time to complete team vesting period
    await advanceTime(client, { slots: BigInt(100), seconds: BigInt(preset.teamDurationSec) });

    const { instruction: claimTeamIx } = await sdk.claimIx({
      launch: testLaunch,
      baseMint: clmmCreate.baseMint,
      participant: admin.publicKey,
      bucket: 1, // Team
    });
    sendTx(client, admin.publicKey, [adminKeypair], [
      anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
      claimTeamIx,
    ]);

    const teamAtaInfo = client.getAccount(creatorAta);
    const teamTokens = unpackAccount(creatorAta, {
      ...(teamAtaInfo as any),
      data: Buffer.from(teamAtaInfo.data),
    } as any).amount.toString();
    assert.equal(teamTokens, expectedTeamTokens,
      `Creator should receive exactly ${expectedTeamTokens} team tokens`);
    console.log(`✅ Step 6: Creator claimed ${teamTokens} team tokens`);

    // === Step 7: Creator claims Sale bucket ===
    // Creator sale has vesting based on deposit:
    // deposit = creatorTickets * tau = 10 * 0.1 SOL = 1 SOL
    // periods = deposit / creatorPeriodUnlock = 1_000_000_000 / 100_000_000 = 10
    // duration = periods * creatorPeriodSec = 10 * 60 = 600 seconds
    // We advanced 60 sec for team, need 540 more for full creator sale vesting
    const creatorSaleVestingRemaining = 10 * preset.creatorPeriodSec - preset.teamDurationSec;
    await advanceTime(client, { slots: BigInt(10), seconds: BigInt(creatorSaleVestingRemaining) });

    const expectedCreatorSaleTokens = tokensPerTicket * BigInt(creatorTickets);
    const expectedCreatorTotal = BigInt(expectedTeamTokens) + expectedCreatorSaleTokens;

    const { instruction: claimCreatorSaleIx } = await sdk.claimIx({
      launch: testLaunch,
      baseMint: clmmCreate.baseMint,
      participant: admin.publicKey,
      bucket: 0, // Sale
    });
    sendTx(client, admin.publicKey, [adminKeypair], [
      anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
      claimCreatorSaleIx,
    ]);

    const creatorAtaAfterSale = client.getAccount(creatorAta);
    const creatorTotalTokens = unpackAccount(creatorAta, {
      ...(creatorAtaAfterSale as any),
      data: Buffer.from(creatorAtaAfterSale.data),
    } as any).amount.toString();
    assert.equal(creatorTotalTokens, expectedCreatorTotal.toString(),
      `Creator total should be team + sale allocation`);
    console.log(`✅ Step 7: Creator claimed sale tokens. Total: ${creatorTotalTokens}`);

    // === Step 8: Verify no refund available (all tickets won) ===
    // When k_capacity >= active_tickets, all tickets win, so refund = 0
    const refundIx = (await sdk.refundTx({ launch: testLaunch, contributor: contributor.publicKey })).transaction.instructions[0];
    await doAndCheckError(
      (async () => sendTx(client, contributor.publicKey, [contributor], [
        anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
        refundIx,
      ]))(),
      "AlreadyRefunded"
    );
    console.log(`✅ Step 8: Refund correctly rejected (all tickets won)`);

    console.log("✅ SUCCESS FLOW COMPLETE");
  });

  // Stress test configuration loaded from JSON
  const stressConfigPath = path.resolve(__dirname, "stress-test-config.json");
  const STRESS_TEST_CONFIG = JSON.parse(fs.readFileSync(stressConfigPath, "utf8"));

  it("Stress test: overflow with withdrawals and full verification", async () => {
    console.log(`=== Stress Test: ${STRESS_TEST_CONFIG.participantCount} participants ===`);

    // Load and initialize stress preset
    const stressPresetPath = path.resolve(__dirname, "litesvm-stress-test-preset.json");
    const stressPresetData = JSON.parse(fs.readFileSync(stressPresetPath, "utf8"));
    const stressPresetParams = parsePresetParams(stressPresetData);

    const { instruction: stressPresetIx } = await (sdk as any).initLaunchPresetIx({
      payer: admin.publicKey,
      id: Number(stressPresetData.id),
      ...stressPresetParams,
      signerAdmins: [admin.publicKey, adminBKeypair.publicKey],
    });
    sendTx(client, adminKeypair.publicKey, [adminKeypair, adminBKeypair], stressPresetIx);

    const { data: preset } = await sdk.fetchLaunchPreset(Number(stressPresetData.id));
    const tau = preset.tauLamports;
    const hardCap = preset.hardCapLamports;
    const kCapacity = hardCap.div(tau).toNumber(); // 2000 tickets max

    console.log(`Hard cap: ${hardCap.div(new anchor.BN(1e9)).toString()} SOL (${kCapacity} tickets)`);
    console.log(`Per wallet: ${preset.perWalletCap.div(new anchor.BN(1e9)).toString()} SOL`);
    console.log(`Tau: ${tau.toString()} lamports (${tau.toNumber() / 1e9} SOL)`);

    // Create launch
    const nextId = await sdk.getNextProjectId();
    const { instruction, launchState: testLaunch } = await (sdk as any).initLaunchFromPresetIx({
      creator: admin.publicKey,
      presetId: Number(stressPresetData.id),
      projectId: nextId,
      saleStartTimeTimestamp: 0,
      name: "StressTest",
      symbol: "STR",
      uri: "https://example.com/stress.json",
    });
    sendTx(client, adminKeypair.publicKey, [adminKeypair], instruction);

    // Track all participants
    interface Participant {
      keypair: anchor.web3.Keypair;
      depositedTickets: number;
      withdrawnTickets: number;
      activeTickets: number;
      fundedLamports: bigint;
      txCount: number;
      refundedLamports: bigint;
      claimedTokens: bigint;
    }
    const participants: Participant[] = [];
    let totalDepositedTickets = 0;
    let totalWithdrawnTickets = 0;

    // Pseudo-random number generator for reproducibility
    let seed = 12345;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    // Track realloc funds balance
    const [reallocFundsPda] = sdk.getReallocFundsPda();
    const reallocFundsStart = client.getBalance(reallocFundsPda);
    console.log(`Realloc funds start: ${Number(reallocFundsStart) / 1e9} SOL`);

    console.log(`Depositing and withdrawing (interleaved for range reuse)...`);

    // Interleaved deposits and withdrawals for proper range reuse testing
    let withdrawCount = 0;

    // Calculate max tickets per wallet from preset
    const maxTicketsPerWallet = preset.perWalletCap.div(tau).toNumber();
    console.log(`Max tickets per wallet: ${maxTicketsPerWallet}`);

    for (let i = 0; i < STRESS_TEST_CONFIG.participantCount; i++) {
      // Random ticket count: 1 to maxTicketsPerWallet
      const ticketCount = Math.floor(1 + random() * maxTicketsPerWallet);
      const amount = new BN(tau.toString()).muln(ticketCount);
      const fundAmount = Number(amount.toString()) / 1e9 + 0.1; // deposit + rent + fees + buffer
      const participant = await createAndFundAccount(client, fundAmount);

      const { instruction: depIx } = await sdk.depositIx({
        contributor: participant.publicKey,
        launch: testLaunch,
        amount,
      });
      try {
        sendTx(client, participant.publicKey, [participant], depIx);
      } catch (e: any) {
        console.log(`\n❌ Deposit FAILED at i=${i}, tickets=${ticketCount}, amount=${Number(amount.toString())/1e9} SOL`);
        throw e;
      }

      participants.push({
        keypair: participant,
        depositedTickets: ticketCount,
        withdrawnTickets: 0,
        activeTickets: ticketCount,
        fundedLamports: BigInt(Math.floor(fundAmount * 1e9)),
        txCount: 1,
        refundedLamports: BigInt(0),
        claimedTokens: BigInt(0),
      });
      totalDepositedTickets += ticketCount;

      // Random withdrawal from existing participants (interleaved)
      if (participants.length > 10 && random() < STRESS_TEST_CONFIG.withdrawProbability) {
        const pIdx = Math.floor(random() * (participants.length - 1)); // не последний
        const p = participants[pIdx];
        if (p.activeTickets > 1) {
          const withdrawTickets = Math.floor(random() * (p.activeTickets - 1)) + 1;
          const withdrawAmount = new BN(tau.toString()).muln(withdrawTickets);

          const { instruction: withdrawIx } = await sdk.withdrawIx({
            contributor: p.keypair.publicKey,
            launch: testLaunch,
            amount: withdrawAmount,
          });
          sendTx(client, p.keypair.publicKey, [p.keypair], withdrawIx);

          p.withdrawnTickets += withdrawTickets;
          p.activeTickets -= withdrawTickets;
          p.txCount++;
          totalWithdrawnTickets += withdrawTickets;
          withdrawCount++;
        }
      }

      if ((i + 1) % 200 === 0) {
        console.log(`  Progress: ${i + 1}/${STRESS_TEST_CONFIG.participantCount} (deposits: ${totalDepositedTickets}, withdrawals: ${withdrawCount})`);
      }
    }

    const tauSol = Number(tau.toString()) / 1e9;
    console.log(`Total deposited: ${totalDepositedTickets} tickets (${(totalDepositedTickets * tauSol).toFixed(2)} SOL)`);
    console.log(`Total withdrawals: ${withdrawCount} (${totalWithdrawnTickets} tickets)`);
    const isOverflow = totalDepositedTickets > kCapacity;
    console.log(`Overflow: ${isOverflow ? 'YES' : 'NO'} (capacity: ${kCapacity})`);
    const activeTickets = totalDepositedTickets - totalWithdrawnTickets;
    console.log(`Active tickets after withdrawals: ${activeTickets}`);

    // Phase 3: Finalize lottery
    await advanceTime(client, { slots: BigInt(100), seconds: BigInt(preset.fundingDurationSeconds + 10) });

    // Inject random slot hashes BEFORE setSeedIx (which reads from them)
    const { data: launchAccount } = await sdk.fetchLaunch(testLaunch);
    const projectId = launchAccount.projectId.toNumber();
    const unlock = Number(preset.unlockTimeSec);
    const computedN = BigInt(unlock > 0 ? unlock * 17 : 100);
    const width = ((BigInt(1) << BigInt(256)) - BigInt(1)) / computedN;
    const rangeStart = width * BigInt(projectId - 1);
    const rangeEnd = rangeStart + width;
    const randomSeed = BigInt(Date.now()) * BigInt(Math.floor(Math.random() * 1_000_000));
    console.log(`Random seed: ${randomSeed}`);
    injectSlotHashesForRange(client, rangeStart, rangeEnd, 512, randomSeed);

    const { instruction: seedIx } = await sdk.setSeedIx({ launch: testLaunch, payer: admin.publicKey });
    sendTx(client, adminKeypair.publicKey, [adminKeypair], seedIx);

    const { transaction: prepTx } = await sdk.finalizeLotteryTx({
      payer: admin.publicKey,
      launch: testLaunch,
      computeUnits: 2_000_000,
    });
    const { computeUnitsConsumed } = sendTxWithMeta(client, admin.publicKey, [adminKeypair], prepTx);

    const { data: lottery } = await sdk.fetchLotteryControl(testLaunch);
    const winners = Math.min(kCapacity, activeTickets);
    console.log(`Lottery finalized: ${winners} winners out of ${activeTickets} active tickets (CU: ${computeUnitsConsumed.toLocaleString()})`);

    // Visualize bitmap distribution - read from winners_bitmap account
    const [winnersBitmapPda] = sdk.getWinnersBitmapPda(testLaunch);
    const winnersBitmapInfo = client.getAccount(winnersBitmapPda);
    const bitmapData = winnersBitmapInfo?.data ?? new Uint8Array(0);
    const totalWords = Math.ceil(bitmapData.length / 8);
    const numSegments = 64;
    console.log(`\nBitmap distribution (${totalWords} words, ${lottery.bitsAllocated.toString()} allocated, ${activeTickets} active):`);

    // Count winners per segment (divide evenly across allocated bits, not array length)
    const bitsAllocated = lottery.bitsAllocated.toNumber();
    const segmentCounts: number[] = [];
    const bitsPerSegment = Math.ceil(bitsAllocated / numSegments);

    for (let seg = 0; seg < numSegments; seg++) {
      let count = 0;
      const bitStart = seg * bitsPerSegment;
      const bitEnd = Math.min(bitStart + bitsPerSegment, bitsAllocated);

      for (let bitIdx = bitStart; bitIdx < bitEnd; bitIdx++) {
        const byteIdx = Math.floor(bitIdx / 8);
        const byteBit = bitIdx % 8;
        if (byteIdx < bitmapData.length && (bitmapData[byteIdx] >> byteBit) & 1) {
          count++;
        }
      }
      segmentCounts.push(count);
    }

    // Find max for normalization
    const maxCount = Math.max(...segmentCounts);
    const avgCount = segmentCounts.reduce((a, b) => a + b, 0) / segmentCounts.length;

    // Print histogram
    const barChars = '▁▂▃▄▅▆▇█';
    let histogram = '';
    for (const count of segmentCounts) {
      const normalized = maxCount > 0 ? count / maxCount : 0;
      const idx = Math.min(Math.floor(normalized * 8), 7);
      histogram += barChars[idx];
    }
    console.log(`Winners per segment: min=${Math.min(...segmentCounts)}, avg=${avgCount.toFixed(0)}, max=${maxCount}`);
    console.log(`Distribution: ${histogram}`);

    // Check account sizes and rent
    const [lotteryControlPda] = sdk.getLotteryControlPda(testLaunch);
    const lotteryAccountInfo = client.getAccount(lotteryControlPda);
    const lotteryRent = lotteryAccountInfo?.lamports ?? BigInt(0);
    const lotterySize = lotteryAccountInfo?.data.length ?? 0;
    const inactiveCount = lottery.inactiveCount.toNumber();
    console.log(`LotteryControl account: ${lotterySize} bytes, ${inactiveCount} inactive tickets, ${Number(lotteryRent) / 1e9} SOL rent`);

    const winnersBitmapRent = winnersBitmapInfo?.lamports ?? BigInt(0);
    const winnersBitmapSize = winnersBitmapInfo?.data.length ?? 0;
    console.log(`Winners bitmap: ${winnersBitmapSize} bytes, ${Number(winnersBitmapRent) / 1e9} SOL rent`);

    const [inactiveBitmapPda] = sdk.getInactiveBitmapPda(testLaunch);
    const inactiveBitmapInfo = client.getAccount(inactiveBitmapPda);
    const inactiveBitmapRent = inactiveBitmapInfo?.lamports ?? BigInt(0);
    const inactiveBitmapSize = inactiveBitmapInfo?.data.length ?? 0;
    console.log(`Inactive bitmap: ${inactiveBitmapSize} bytes, ${Number(inactiveBitmapRent) / 1e9} SOL rent`);

    const totalRent = Number(lotteryRent) + Number(winnersBitmapRent) + Number(inactiveBitmapRent);
    console.log(`Total rent on lottery accounts: ${totalRent / 1e9} SOL`);

    const reallocFundsEnd = client.getBalance(reallocFundsPda);
    const reallocFundsSpent = reallocFundsStart - reallocFundsEnd;
    console.log(`Realloc funds end: ${Number(reallocFundsEnd) / 1e9} SOL (spent: ${Number(reallocFundsSpent) / 1e9} SOL)`);

    // Create pool
    const { raydiumProgramId, ammConfig } = await setupRaydiumCLMM(client);
    const WSOL_MINT = new anchor.web3.PublicKey("So11111111111111111111111111111111111111112");
    const clmmCreate = await sdk.createClmmPoolTx({
      payer: admin.publicKey,
      launch: testLaunch,
      quoteMint: WSOL_MINT,
      ammConfig,
      clmmProgram: raydiumProgramId,
      provider,
    });
    sendTx(client, admin.publicKey, [adminKeypair, ...clmmCreate.signers], clmmCreate.transaction);

    // Phase 4: Advance time for full vesting
    await advanceTime(client, { slots: BigInt(100), seconds: BigInt(preset.contributorDurationSec + 60) });

    // Phase 5: Verify claims and refunds for all participants
    console.log(`Verifying claims and refunds for ${participants.length} participants...`);

    const baseTotalAllocationBigInt = BigInt("1000000000000000000");
    const saleAllocationBigInt = baseTotalAllocationBigInt * BigInt(preset.baseSaleBasisPoints) / BigInt(10000);
    const tokensPerTicket = saleAllocationBigInt / BigInt(winners);

    let totalClaimedTokens = BigInt(0);
    let totalRefundedLamports = BigInt(0);
    let claimSuccessCount = 0;
    let refundSuccessCount = 0;

    for (let i = 0; i < participants.length; i++) {
      const p = participants[i];

      // Try to claim
      if (p.activeTickets > 0) {
        try {
          const { instruction: claimIx, participantAta } = await sdk.claimIx({
            launch: testLaunch,
            baseMint: clmmCreate.baseMint,
            participant: p.keypair.publicKey,
            bucket: 0,
          });
          sendTx(client, p.keypair.publicKey, [p.keypair], [
            anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
            claimIx,
          ]);
          p.txCount++;

          const ataInfo = client.getAccount(participantAta);
          if (ataInfo) {
            const balance = BigInt(unpackAccount(participantAta, {
              ...(ataInfo as any),
              data: Buffer.from(ataInfo.data),
            } as any).amount);
            p.claimedTokens = balance;
            totalClaimedTokens += balance;
            claimSuccessCount++;
          }
        } catch (e: any) {
          // Some may have no winning tickets
          if (!e.message?.includes("NothingToClaim")) {
            console.log(`Participant ${i} claim error: ${e.message?.slice(0, 100)}`);
          }
        }
      }

      // Try to refund (for losing tickets)
      try {
        const balanceBefore = client.getBalance(p.keypair.publicKey);
        const { transaction: refundTx } = await sdk.refundTx({
          launch: testLaunch,
          contributor: p.keypair.publicKey,
        });
        refundTx.instructions.unshift(anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }));
        sendTx(client, p.keypair.publicKey, [p.keypair], refundTx);
        p.txCount++;

        const balanceAfter = client.getBalance(p.keypair.publicKey);
        const refunded = balanceAfter - balanceBefore;
        if (refunded > BigInt(0)) {
          p.refundedLamports = refunded;
          totalRefundedLamports += refunded;
          refundSuccessCount++;
        }
      } catch (e: any) {
        // AlreadyRefunded or no losing tickets
        if (!e.message?.includes("AlreadyRefunded")) {
          // Ignore
        }
      }

      if ((i + 1) % 200 === 0) {
        console.log(`  Verified: ${i + 1}/${participants.length}`);
      }
    }

    // Fee verification for all participants
    // Fee = contribution rent + tx fees + ATA rent (if claimed)
    // Formula: fees = funded - finalBalance - withdrawn*tau - refunded - winningValue
    // where winningValue = winningTickets * tau (locked for tokens, not "lost")
    // We compute winningTickets from refund: losingTickets ≈ refunded / tau
    console.log(`\nVerifying fees paid by participants...`);
    const tauLamports = BigInt(tau.toString());
    let totalFeesPaid = BigInt(0);
    let maxFee = BigInt(0);
    let minFee = BigInt(Number.MAX_SAFE_INTEGER);
    let feeErrors: string[] = [];

    for (let i = 0; i < participants.length; i++) {
      const p = participants[i];
      const finalBalance = client.getBalance(p.keypair.publicKey);

      // Money flows:
      // OUT: deposit (activeTickets * tau) + fees
      // IN: withdrawn (W * tau) + refund (losingTickets * tau - txfee)
      // finalBalance = funded - activeTickets*tau - fees + W*tau + refund
      // fees = funded - finalBalance - activeTickets*tau + W*tau + refund
      //      = funded - finalBalance - (activeTickets - W)*tau + refund
      //      but activeTickets = deposited - withdrawn, so activeTickets - W is wrong
      //
      // Simpler: total_out = funded - finalBalance
      //          total_in_from_protocol = withdrawn*tau + refund
      //          net_to_escrow = deposited*tau - withdrawn*tau = activeTickets*tau
      //          refund = losingTickets*tau (approx, minus tx fee)
      //          winning_value = activeTickets*tau - losingTickets*tau = winningTickets*tau
      //          fees = total_out - winning_value = funded - finalBalance - winningTickets*tau

      const activeTickets = BigInt(p.activeTickets);

      // Approximate losing tickets from refund (refund includes -txfee, so round up)
      const losingTickets = p.refundedLamports > BigInt(0)
        ? (p.refundedLamports + tauLamports - BigInt(1)) / tauLamports
        : BigInt(0);
      const winningTickets = activeTickets > losingTickets ? activeTickets - losingTickets : BigInt(0);
      const winningValue = winningTickets * tauLamports;

      // fees = funded - finalBalance - winningValue
      const totalOut = p.fundedLamports - finalBalance;
      const feesPaid = totalOut - winningValue;
      totalFeesPaid += feesPaid;

      if (feesPaid > maxFee) maxFee = feesPaid;
      if (feesPaid < minFee) minFee = feesPaid;

      // Expected fee: contribution rent (~0.00115 SOL) + tx fees (~5000 per tx)
      //              + ATA rent if claimed (~0.002 SOL) + TicketsClaimed rent (~0.001 SOL)
      const contributionRent = BigInt(1_150_000);
      const txFees = BigInt(p.txCount * 5000);
      const ataRent = p.claimedTokens > BigInt(0) ? BigInt(2_039_280) : BigInt(0);
      const ticketsClaimedRent = p.claimedTokens > BigInt(0) ? BigInt(1_002_240) : BigInt(0); // 8 + 8 = 16 bytes account
      const expectedFee = contributionRent + txFees + ataRent + ticketsClaimedRent;

      // Allow some tolerance for rounding
      const tolerance = BigInt(50_000); // 0.00005 SOL
      const diff = feesPaid - expectedFee;
      if (feesPaid < expectedFee - tolerance || feesPaid > expectedFee + tolerance) {
        feeErrors.push({
          idx: i,
          paid: feesPaid,
          expected: expectedFee,
          diff,
          txs: p.txCount,
          won: winningTickets,
          claimed: p.claimedTokens > BigInt(0),
          active: p.activeTickets,
          refunded: p.refundedLamports,
        });
      }
    }

    const avgFee = totalFeesPaid / BigInt(participants.length);
    console.log(`Fee stats (SOL): min=${(Number(minFee)/1e9).toFixed(6)}, avg=${(Number(avgFee)/1e9).toFixed(6)}, max=${(Number(maxFee)/1e9).toFixed(6)}`);
    console.log(`Total fees paid: ${Number(totalFeesPaid)/1e9} SOL`);

    if (feeErrors.length > 0) {
      console.log(`Fee anomalies (${feeErrors.length}):`);
      // Group by diff to understand pattern
      const diffGroups = new Map<string, number>();
      for (const e of feeErrors) {
        const key = `${(Number(e.diff)/1e6).toFixed(1)}m`;
        diffGroups.set(key, (diffGroups.get(key) || 0) + 1);
      }
      console.log(`  Diff distribution:`, Object.fromEntries(diffGroups));

      // Show first 5 details
      feeErrors.slice(0, 5).forEach(e => {
        console.log(`  P${e.idx}: paid=${(Number(e.paid)/1e9).toFixed(6)} exp=${(Number(e.expected)/1e9).toFixed(6)} diff=${(Number(e.diff)/1e9).toFixed(6)} SOL`);
        console.log(`         txs=${e.txs}, active=${e.active}, won=${e.won}, claimed=${e.claimed}, refund=${(Number(e.refunded)/1e9).toFixed(4)}`);
      });
    } else {
      console.log(`✅ All participant fees within expected range`);
    }

    // Summary
    console.log(`\n=== Stress Test Results ===`);
    console.log(`Participants: ${participants.length}`);
    console.log(`Total deposited: ${totalDepositedTickets} tickets`);
    console.log(`Total withdrawn: ${totalWithdrawnTickets} tickets`);
    console.log(`Active tickets: ${activeTickets}`);
    console.log(`Winners: ${winners}`);
    console.log(`Losers: ${activeTickets - winners}`);
    console.log(`Claims successful: ${claimSuccessCount}`);
    console.log(`Refunds successful: ${refundSuccessCount}`);
    console.log(`Total claimed tokens: ${totalClaimedTokens}`);
    console.log(`Total refunded: ${Number(totalRefundedLamports) / 1e9} SOL`);
    console.log(`Total fees: ${Number(totalFeesPaid) / 1e9} SOL (avg ${Number(avgFee) / 1e9} SOL per participant)`);
    console.log(`LotteryControl account: ${lotterySize} bytes (${Number(lotteryRent) / 1e9} SOL)`);
    console.log(`Realloc funds spent: ${Number(reallocFundsSpent) / 1e9} SOL`);

    // Verify total claimed is approximately sale_allocation (accounting for rounding)
    const expectedTotalClaim = tokensPerTicket * BigInt(winners);
    const claimDiff = totalClaimedTokens > expectedTotalClaim
      ? totalClaimedTokens - expectedTotalClaim
      : expectedTotalClaim - totalClaimedTokens;
    const claimDiffPercent = Number(claimDiff * BigInt(10000) / expectedTotalClaim) / 100;
    console.log(`Expected total claim: ${expectedTotalClaim}`);
    console.log(`Claim difference: ${claimDiff} (${claimDiffPercent}%)`);

    assert.ok(claimDiffPercent < 1, `Claim difference should be < 1%, got ${claimDiffPercent}%`);


    console.log(`✅ Stress test complete`);
  });

  it("Cancel flow: min_raise not met → full refund", async () => {
    // === Step 1: Create launch ===
    const nextId = await sdk.getNextProjectId();
    const { instruction, launchState: testLaunch } = await (sdk as any).initLaunchFromPresetIx({
      creator: admin.publicKey,
      presetId: Number(presetData.id),
      projectId: nextId,
      saleStartTimeTimestamp: 0,
      name: "CancelTest",
      symbol: "CNL",
      uri: "https://example.com/cnl.json",
    });
    sendTx(client, adminKeypair.publicKey, [adminKeypair], instruction);
    console.log("✅ Step 1: Launch created");

    // === Step 2: Small deposit (below min_raise) ===
    const { data: preset } = await sdk.fetchLaunchPreset(Number(presetData.id));
    const tau = preset.tauLamports;
    const minRaise = preset.minRaiseLamports;

    // Deposit only 10% of min_raise
    const depositAmount = minRaise.divn(10);
    const depositTickets = depositAmount.div(tau).toNumber();

    const contributor = await createAndFundAccount(client, 250);
    const balanceBefore = client.getBalance(contributor.publicKey);

    const { instruction: depositIx } = await sdk.depositIx({
      contributor: contributor.publicKey,
      launch: testLaunch,
      amount: depositAmount,
    });
    sendTx(client, contributor.publicKey, [contributor], depositIx);
    console.log(`✅ Step 2: Deposited ${depositTickets} tickets (${Number(depositAmount) / 1e9} SOL, min_raise: ${Number(minRaise) / 1e9} SOL)`);

    // === Step 3: Wait for funding to end ===
    await advanceTime(client, { slots: BigInt(100), seconds: BigInt(preset.fundingDurationSeconds + 10) });

    // === Step 4: Call setSeed - should cancel due to min_raise not met ===
    const { instruction: seedIx } = await sdk.setSeedIx({ launch: testLaunch, payer: admin.publicKey });
    sendTx(client, adminKeypair.publicKey, [adminKeypair], seedIx);

    // Verify lottery is cancelled (setSeed cancels when min_raise not met)
    const { data: lottery } = await sdk.fetchLotteryControl(testLaunch);
    assert.ok(lottery.status.cancelled, "Lottery should be cancelled when min_raise not met");
    console.log("✅ Step 3: Lottery cancelled via setSeed (min_raise not met)");

    // === Step 5: Full refund ===
    const { transaction: refundTx } = await sdk.refundTx({
      launch: testLaunch,
      contributor: contributor.publicKey,
    });
    sendTx(client, contributor.publicKey, [contributor], refundTx);

    const balanceAfter = client.getBalance(contributor.publicKey);
    const refunded = balanceAfter - balanceBefore;

    // Should get back full deposit minus tx fees and contribution rent
    // Allow for tx fees (~10k each) + contribution account rent (~1.1M lamports)
    const feeAllowance = BigInt(1_500_000); // ~0.0015 SOL
    const actualLoss = balanceBefore - balanceAfter;

    console.log(`Balance before: ${Number(balanceBefore) / 1e9} SOL`);
    console.log(`Balance after: ${Number(balanceAfter) / 1e9} SOL`);
    console.log(`Actual loss: ${Number(actualLoss) / 1e9} SOL (fees + rent)`);

    // Loss should be only tx fees + rent, not the deposit
    assert.ok(actualLoss < feeAllowance, `Should only lose fees+rent, but lost ${Number(actualLoss) / 1e9} SOL`);

    console.log("✅ Step 4: Full refund received (cancelled launch)");
  });

});
