import { Clock } from "litesvm";
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { assert } from "chai";
import * as fs from "fs";

export function loadKeypair(path: string): anchor.web3.Keypair {
  const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf8")));
  return anchor.web3.Keypair.fromSecretKey(secretKey);
}

export function parsePresetParams(p: any) {
  return {
    hardCapLamports: new BN(String(p.hardCapLamports)),
    minRaiseLamports: new BN(String(p.minRaiseLamports)),
    perWalletCap: new BN(String(p.perWalletCap)),
    tauLamports: new BN(String(p.tauLamports)),
    baseTotalAllocation: new BN(String(p.baseTotalAllocation)),
    baseSaleBasisPoints: new BN(String(p.baseSaleBasisPoints)),
    teamAllocationBasisPoints: Number(p.teamAllocationBasisPoints),
    fundingDurationSeconds: Number(p.fundingDurationSeconds),
    unlockTimeSec: Number(p.unlockTimeSec),
    creatorPeriodUnlock: new BN(String(p.creatorPeriodUnlock)),
    creatorPeriodSec: Number(p.creatorPeriodSec),
    creatorMaxDeposit: new BN(String(p.creatorMaxDeposit)),
    poolCreationGracePeriodSec: Number(p.poolCreationGracePeriodSec),
    teamDurationSec: Number(p.teamDurationSec),
    teamPeriodSec: Number(p.teamPeriodSec),
    contributorDurationSec: Number(p.contributorDurationSec ?? 1),
    contributorPeriodSec: Number(p.contributorPeriodSec ?? 1),
    withdrawalLimit: Number(p.withdrawalLimit),
    creationFee: new BN(String(p.creationFee)),
  };
}

export function getExplorerUrl(
  provider: anchor.AnchorProvider,
  signature: string
): string {
  const cluster = provider.connection.rpcEndpoint.includes("devnet")
    ? "devnet"
    : provider.connection.rpcEndpoint.includes("testnet")
    ? "testnet"
    : provider.connection.rpcEndpoint.includes("localhost") ||
      provider.connection.rpcEndpoint.includes("127.0.0.1")
    ? "custom&customUrl=" + encodeURIComponent(provider.connection.rpcEndpoint)
    : "mainnet-beta";

  return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
}

export async function advanceTime(
  client: any,
  params: { slots?: bigint; seconds?: bigint } = {}
) {
  const slots = params.slots ?? BigInt(0);
  const seconds = params.seconds ?? BigInt(0);
  const currentClock = client.getClock();
  client.setClock(
    new Clock(
      currentClock.slot + slots,
      currentClock.epochStartTimestamp,
      currentClock.epoch,
      currentClock.leaderScheduleEpoch,
      currentClock.unixTimestamp + seconds
    )
  );
}

export async function createAndFundAccount(
  client: any,
  solAmount: number
): Promise<anchor.web3.Keypair> {
  const account = anchor.web3.Keypair.generate();
  client.airdrop(account.publicKey, BigInt(Math.floor(solAmount * anchor.web3.LAMPORTS_PER_SOL)));
  return account;
}

function toUint256BE(x: bigint): Buffer {
  const buf = Buffer.alloc(32);
  let v = x;
  for (let i = 31; i >= 0; i--) {
    buf[i] = Number(v & BigInt(255));
    v = v >> BigInt(8);
  }
  return buf;
}

export function injectSlotHashesForRange(
  client: any,
  rangeStart: bigint,
  rangeEnd: bigint,
  numHashes = 512
) {
  const sysvar = new anchor.web3.PublicKey("SysvarS1otHashes111111111111111111111111111");
  const currentClock = client.getClock();
  const data = Buffer.alloc(8 + numHashes * 40);
  data.writeBigUInt64LE(BigInt(numHashes), 0);
  for (let i = 0; i < numHashes; i++) {
    const offset = 8 + i * 40;
    data.writeBigUInt64LE(currentClock.slot + BigInt(i + 1), offset);
    const h = i === numHashes - 1 ? rangeStart : rangeEnd;
    toUint256BE(h).copy(data, offset + 8);
  }
  client.setAccount(sysvar, {
    lamports: 1_000_000,
    data,
    owner: anchor.web3.SystemProgram.programId,
    executable: false,
  });
}

export function checkAnchorError(error: any, errMsg: string) {
  if (error instanceof anchor.AnchorError) {
    assert.equal((error as anchor.AnchorError).error.errorMessage, errMsg);
  } else if (error.message && error.message.includes(errMsg)) {
    return;
  } else if (error.logs && Array.isArray(error.logs)) {
    const logsStr = error.logs.join(" ");
    if (logsStr.includes(errMsg)) {
      return;
    }
  } else {
    const errorStr = JSON.stringify(error);
    assert.fail(`Expected error message containing "${errMsg}", got: ${error.message || errorStr}`);
  }
}

export async function doAndCheckError(promise: Promise<any>, errMsg: string) {
  try {
    await promise;
    assert.fail(`Should have failed with error: ${errMsg}`);
  } catch (error: any) {
    checkAnchorError(error, errMsg);
  }
}

export async function withNoLogging<T>(fn: () => Promise<T>): Promise<T> {
  const originalLog = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = originalLog;
  }
}

export class EventsFetcher {
  static parse(
    logs: string[],
    program: anchor.Program<any>
  ): { name: string; data: any }[] {
    const parser = new anchor.EventParser(program.programId, program.coder);
    return [...parser.parseLogs(logs)].map(e => ({ name: e.name, data: e.data }));
  }

  static filter<T>(
    events: { name: string; data: any }[],
    eventName: string
  ): T[] {
    return events.filter(e => e.name === eventName).map(e => e.data as T);
  }

  static async fetch<T>(
    connection: anchor.web3.Connection,
    signature: string,
    program: anchor.Program<any>,
    eventName: string
  ): Promise<T[]> {
    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    return EventsFetcher.filter<T>(EventsFetcher.parse(tx?.meta?.logMessages ?? [], program), eventName);
  }
}
