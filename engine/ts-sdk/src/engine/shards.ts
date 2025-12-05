import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
import type { Engine as EngineIDL } from "../../idl/engine";
import type { TxBuilder } from "./txBuilder";

function fnv1a64(input: Uint8Array): bigint {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input[i]);
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash;
}

function concat3(a: Uint8Array, b: Uint8Array, c: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length + c.length);
  out.set(a, 0);
  out.set(b, a.length);
  out.set(c, a.length + b.length);
  return out;
}

function hash16(tag: string, launch: anchor.web3.PublicKey, user: anchor.web3.PublicKey): number {
  const t = new TextEncoder().encode(tag);
  const bytes = concat3(t, launch.toBuffer(), user.toBuffer());
  const h = fnv1a64(bytes);
  return Number(h & 0xffffn);
}

export function pickShardId(launch: anchor.web3.PublicKey, user: anchor.web3.PublicKey, shardsTotal: number): number {
  if (!Number.isFinite(shardsTotal) || shardsTotal <= 0) throw new Error("Invalid shardsTotal");
  const h1 = hash16("shard-v1", launch, user);
  const h2 = hash16("shard-v2", launch, user) | 1;
  return (h1 + 0 * h2) % shardsTotal;
}

export function selectRosterShard(launch: anchor.web3.PublicKey, user: anchor.web3.PublicKey, shardsTotal: number): { start: number; step: number; order: number[] } {
  if (!Number.isFinite(shardsTotal) || shardsTotal <= 0) throw new Error("Invalid shardsTotal");
  const h1 = hash16("shard-v1", launch, user);
  const h2 = hash16("shard-v2", launch, user) | 1;
  const order: number[] = [];
  for (let j = 0; j < shardsTotal; j++) {
    order.push((h1 + j * h2) % shardsTotal);
  }
  return { start: h1 % shardsTotal, step: h2 % shardsTotal, order };
}

function isRosterShardFullError(e: any): boolean {
  const m = String(e?.message ?? "");
  if (m.includes("Roster shard is full") || m.includes("RosterShardFull")) return true;
  const logs: string[] = (e?.logs as any) || [];
  return Array.isArray(logs) && logs.some((l) => l.includes("RosterShardFull") || l.includes("Roster shard is full"));
}

export function createShardsApi(params: {
  program: Program<EngineIDL>;
  provider: anchor.Provider;
  txBuilder: TxBuilder;
  payer: anchor.web3.PublicKey;
  getRosterPda: (launch: anchor.web3.PublicKey) => [anchor.web3.PublicKey, number];
  getRosterShardPda: (launch: anchor.web3.PublicKey, shardId: number) => [anchor.web3.PublicKey, number];
  fetchLaunch: (launch: anchor.web3.PublicKey) => Promise<any>;
}) {
  const { program, provider, txBuilder, payer, getRosterPda, getRosterShardPda, fetchLaunch } = params;
  const conn = program.provider.connection;

  async function getAccountInfoSafe(pubkey: anchor.web3.PublicKey): Promise<any | null> {
    try {
      return await conn.getAccountInfo(pubkey);
    } catch {
      return null;
    }
  }

  async function initMissingRosterShards(args: { launch: anchor.web3.PublicKey; payerKeypair?: anchor.web3.Keypair }): Promise<{ initialized: number[]; signature: string | null }> {
    const launchState: any = await fetchLaunch(args.launch);
    const total: number = Number(launchState.rosterShards);
    if (!Number.isFinite(total) || total <= 0) throw new Error("Invalid roster shards");
    const toInit: number[] = [];
    // On-chain shard IDs are 1-based (1..total)
    for (let id = 1; id <= total; id++) {
      const [pda] = getRosterShardPda(args.launch, id);
      const info = await getAccountInfoSafe(pda);
      if (!info) toInit.push(id);
    }
    if (toInit.length === 0) return { initialized: [], signature: null };
    const tx = new anchor.web3.Transaction();
    for (const id of toInit) {
      const { instruction } = await txBuilder.initRosterShardIx({ launch: args.launch, payer, shardId: id });
      tx.add(instruction);
    }
    const signers = args.payerKeypair ? [args.payerKeypair] : [];
    if (!(provider as any).sendAndConfirm) throw new Error("Provider does not support sendAndConfirm");
    const signature = await (provider as any).sendAndConfirm(tx, signers);
    return { initialized: toInit, signature };
  }

  async function initRosterAndAllShards(args: { launch: anchor.web3.PublicKey; payerKeypair?: anchor.web3.Keypair }): Promise<{ rosterPda: anchor.web3.PublicKey; initializedShardIds: number[]; signature: string[] }> {
    const [rosterPda] = getRosterPda(args.launch);
    const sigs: string[] = [];
    const rosterInfo = await getAccountInfoSafe(rosterPda);
    if (!rosterInfo) {
      const { transaction } = await txBuilder.initRosterTx({ launch: args.launch, payer });
      const signers = args.payerKeypair ? [args.payerKeypair] : [];
      if (!(provider as any).sendAndConfirm) throw new Error("Provider does not support sendAndConfirm");
      sigs.push(await (provider as any).sendAndConfirm(transaction, signers));
    }
    const res = await initMissingRosterShards({ launch: args.launch, payerKeypair: args.payerKeypair });
    if (res.signature) sigs.push(res.signature);
    return { rosterPda, initializedShardIds: res.initialized, signature: sigs };
  }

  async function depositAutoShard(args: {
    launch: anchor.web3.PublicKey;
    amountLamports: anchor.BN;
    userKeypair?: anchor.web3.Keypair;
    preferredShardId?: number;
  }): Promise<{ userPda: anchor.web3.PublicKey; signature: string; shardId: number; rosterShard: anchor.web3.PublicKey }> {
    const user = args.userKeypair?.publicKey ?? payer;
    const launchState: any = await fetchLaunch(args.launch);
    const total: number = Number(launchState.rosterShards);
    const cap: number = Number(launchState.rosterShardCap);
    if (!Number.isFinite(total) || total <= 0) throw new Error("Invalid roster shards");

    // If user already has a UserContribution with assigned shard_id, always reuse it.
    // This hides the "must stay in the same shard" constraint from the frontend.
    let existingShardId: number | null = null;
    try {
      const existing: any = (txBuilder as any).fetchUserContribution
        ? await (txBuilder as any).fetchUserContribution(args.launch, user)
        : null;
      const sid: any = existing?.shardId;
      // shardId is u16 on-chain; Anchor deserializes it to number.
      if (typeof sid === "number" && sid > 0) {
        existingShardId = sid;
      }
    } catch {
      // No existing contribution or fetch failed – treat as first deposit.
    }

    if (existingShardId !== null) {
      const id = existingShardId;
      const [rosterShardPda] = getRosterShardPda(args.launch, id);
      const info = await getAccountInfoSafe(rosterShardPda);
      if (!info) {
        throw new Error(`User has shardId=${id} but roster shard account is missing`);
      }
      try {
        const dep = await txBuilder.depositIx({
          launch: args.launch,
          user,
          amount: args.amountLamports,
          rosterShard: rosterShardPda,
          shardId: id,
        });
        const tx = new anchor.web3.Transaction().add(dep.instruction);
        const signers = args.userKeypair ? [args.userKeypair] : [];
        if (!(provider as any).sendAndConfirm) throw new Error("Provider does not support sendAndConfirm");
        const signature = await (provider as any).sendAndConfirm(tx, signers);
        return { userPda: dep.userContribution, signature, shardId: id, rosterShard: rosterShardPda };
      } catch (e: any) {
        // If the shard is somehow marked full for an existing user, surface a clear error.
        if (isRosterShardFullError(e)) {
          throw new Error(`Roster shard ${id} is full for existing user; on-chain state may be inconsistent`);
        }
        throw e;
      }
    }

    // First-time deposit (no shard assigned yet): respect on-chain sequential fill rule.
    // Active shard is:
    // - 1, if no shard has been used yet;
    // - the current highest-used shard if it is not full;
    // - otherwise the next shard (highest + 1), if within range AND already initialized.
    const highestUsed: number = Number(launchState.rosterHighestUsedShard ?? 0);
    let targetShardId: number;
    if (!Number.isFinite(highestUsed) || highestUsed <= 0) {
      targetShardId = 1;
    } else {
      const [currentShardPda] = getRosterShardPda(args.launch, highestUsed);
      const currentInfo = await getAccountInfoSafe(currentShardPda);
      if (!currentInfo) {
        throw new Error(`Expected roster shard ${highestUsed} to exist for launch ${args.launch.toBase58()}`);
      }
      const currentShard: any = await (program.account as any).rosterShard.fetch(currentShardPda);
      const used: number = (currentShard?.wallets?.length ?? 0) as number;
      if (used < cap) {
        targetShardId = highestUsed;
      } else {
        targetShardId = highestUsed + 1;
      }
    }

    if (!Number.isFinite(targetShardId) || targetShardId <= 0 || targetShardId > total) {
      throw new Error("All roster shards are full or target shard is out of range");
    }

    // If caller provided preferredShardId, enforce it matches the active shard to avoid surprises.
    if (typeof args.preferredShardId === "number" && args.preferredShardId !== targetShardId) {
      throw new Error(
        `preferredShardId=${args.preferredShardId} does not match active shard=${targetShardId}; ` +
        `deposits must follow sequential shard fill`
      );
    }

    const [rosterShardPda] = getRosterShardPda(args.launch, targetShardId);
    const info = await getAccountInfoSafe(rosterShardPda);
    if (!info) {
      throw new Error(
        `Active roster shard ${targetShardId} is not initialized for launch ${args.launch.toBase58()}; ` +
        `backend must create shards sequentially before deposits`
      );
    }

    const dep = await txBuilder.depositIx({
      launch: args.launch,
      user,
      amount: args.amountLamports,
      rosterShard: rosterShardPda,
      shardId: targetShardId,
    });
    const tx = new anchor.web3.Transaction().add(dep.instruction);
    const signers = args.userKeypair ? [args.userKeypair] : [];
    if (!(provider as any).sendAndConfirm) throw new Error("Provider does not support sendAndConfirm");
    const signature = await (provider as any).sendAndConfirm(tx, signers);
    return { userPda: dep.userContribution, signature, shardId: targetShardId, rosterShard: rosterShardPda };
  }

  return {
    initMissingRosterShards,
    initRosterAndAllShards,
    depositAutoShard,
  };
}


