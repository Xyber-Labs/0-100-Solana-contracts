import { Clock } from "litesvm";
import * as anchor from "@coral-xyz/anchor";

export async function advanceTime(
  client: any,
  { slots = 0n, seconds = 0n }: { slots?: bigint; seconds?: bigint } = {}
) {
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
