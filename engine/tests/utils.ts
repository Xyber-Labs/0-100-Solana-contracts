import { Clock } from "solana-bankrun";
import * as anchor from "@coral-xyz/anchor";
import { BankrunProvider } from "anchor-bankrun";

export async function advanceTime(
  context: any,
  { slots = 0n, seconds = 0n }: { slots?: bigint; seconds?: bigint } = {}
) {
  const currentClock = await context.banksClient.getClock();
  context.setClock(
    new Clock(
      currentClock.slot + slots,
      currentClock.epochStartTimestamp,
      currentClock.epoch,
      currentClock.leaderScheduleEpoch,
      currentClock.unixTimestamp + seconds,
    ),
  );
}

export async function createAndFundAccount(
  context: any,
  provider: BankrunProvider,
  solAmount: number
): Promise<anchor.web3.Keypair> {
  const account = anchor.web3.Keypair.generate();
  const transferIx = anchor.web3.SystemProgram.transfer({
    fromPubkey: context.payer.publicKey,
    toPubkey: account.publicKey,
    lamports: solAmount * anchor.web3.LAMPORTS_PER_SOL,
  });
  await provider.sendAndConfirm(
    new anchor.web3.Transaction().add(transferIx),
    [context.payer]
  );
  return account;
}
