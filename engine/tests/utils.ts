import { Clock } from "litesvm";
import * as anchor from "@coral-xyz/anchor";

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
