export type UserStatus = "winner" | "loser" | "failed" | "pending";

export type LaunchUserRow = {
  user: string;
  shardId: number;
  tickets: number;
  depositLamports: bigint;
  claimTokensAtomic: bigint;
  refundLamports: bigint;
  status: UserStatus;
  winningTickets?: number;
  losingTickets?: number;
  claimSig?: string;
  refundSig?: string;
  error?: string;
};

export type LaunchSummary = {
  totalUsers: number;
  winners: number;
  losers: number;
  failed: number;
  totalTickets: number;
  winningTickets: number;
  losingTickets: number;
  totalDepositedLamports: bigint;
  totalRefundedLamports: bigint;
  totalClaimedTokensAtomic: bigint;
};

const CSV_ESCAPED = /[,"\n]/;

function csvCell(value: unknown): string {
  const s = String(value ?? "");
  if (!CSV_ESCAPED.test(s)) return s;
  return `"${s.replaceAll('"', '""')}"`;
}

export class LaunchStatsCollector {
  private rows = new Map<string, LaunchUserRow>();

  registerUser(input: {
    user: string;
    shardId: number;
    tickets: number;
    depositLamports: bigint;
  }) {
    const prev = this.rows.get(input.user);
    const next: LaunchUserRow = {
      user: input.user,
      shardId: input.shardId,
      tickets: input.tickets,
      depositLamports: input.depositLamports,
      claimTokensAtomic: prev?.claimTokensAtomic ?? 0n,
      refundLamports: prev?.refundLamports ?? 0n,
      status: prev?.status ?? "pending",
      winningTickets: prev?.winningTickets ?? 0,
      losingTickets: prev?.losingTickets ?? 0,
      claimSig: prev?.claimSig,
      refundSig: prev?.refundSig,
      error: prev?.error,
    };
    this.rows.set(input.user, next);
  }

  recordWinner(input: { user: string; tokensAtomicDelta: bigint; claimSig?: string }) {
    const row = this.ensure(input.user);
    row.status = "winner";
    row.claimTokensAtomic += input.tokensAtomicDelta;
    if (input.claimSig) row.claimSig = input.claimSig;
    this.rows.set(input.user, row);
  }

  recordLoser(input: { user: string; refundLamportsDelta: bigint; refundSig?: string }) {
    const row = this.ensure(input.user);
    if (row.status !== "winner") {
      row.status = "loser";
    }
    row.refundLamports += input.refundLamportsDelta;
    if (input.refundSig) row.refundSig = input.refundSig;
    this.rows.set(input.user, row);
  }

  recordFailure(input: { user: string; phase: "claim" | "refund" | "deposit" | "other"; error: unknown }) {
    const row = this.ensure(input.user);
    row.status = "failed";
    const message = input.error instanceof Error ? input.error.message : String(input.error ?? "");
    row.error = `[${input.phase}] ${message}`.slice(0, 500);
    this.rows.set(input.user, row);
  }

  getRows(): LaunchUserRow[] {
    return Array.from(this.rows.values()).sort((a, b) => a.user.localeCompare(b.user));
  }

  getSummary(): LaunchSummary {
    const rows = this.getRows();
    let winners = 0;
    let losers = 0;
    let failed = 0;
    let totalTickets = 0;
    let winningTickets = 0;
    let losingTickets = 0;
    let totalDepositedLamports = 0n;
    let totalRefundedLamports = 0n;
    let totalClaimedTokensAtomic = 0n;

    for (const row of rows) {
      totalTickets += row.tickets;
      totalDepositedLamports += row.depositLamports;
      totalRefundedLamports += row.refundLamports;
      totalClaimedTokensAtomic += row.claimTokensAtomic;
      if (row.status === "winner") {
        winners += 1;
      } else if (row.status === "loser") {
        losers += 1;
      } else if (row.status === "failed") {
        failed += 1;
      }
      if (typeof row.winningTickets === "number") {
        winningTickets += row.winningTickets;
      } else if (row.status === "winner") {
        winningTickets += row.tickets;
      }
      if (typeof row.losingTickets === "number") {
        losingTickets += row.losingTickets;
      } else if (row.status === "loser") {
        losingTickets += row.tickets;
      }
    }

    return {
      totalUsers: rows.length,
      winners,
      losers,
      failed,
      totalTickets,
      winningTickets,
      losingTickets,
      totalDepositedLamports,
      totalRefundedLamports,
      totalClaimedTokensAtomic,
    };
  }

  toCSV(): string {
    const header = [
      "user",
      "shardId",
      "tickets",
      "ticketsWin",
      "ticketsLose",
      "depositLamports",
      "refundLamports",
      "netSolLamports",
      "claimTokensAtomic",
      "status",
      "claimSig",
      "refundSig",
      "error",
    ];
    const lines: string[] = [];
    lines.push(header.join(","));
    for (const row of this.getRows()) {
      const netSolLamports = row.refundLamports - row.depositLamports;
      lines.push(
        [
          csvCell(row.user),
          csvCell(row.shardId),
          csvCell(row.tickets),
          csvCell(typeof row.winningTickets === "number" ? row.winningTickets : ""),
          csvCell(typeof row.losingTickets === "number" ? row.losingTickets : ""),
          csvCell(row.depositLamports.toString()),
          csvCell(row.refundLamports.toString()),
          csvCell(netSolLamports.toString()),
          csvCell(row.claimTokensAtomic.toString()),
          csvCell(row.status),
          csvCell(row.claimSig ?? ""),
          csvCell(row.refundSig ?? ""),
          csvCell(row.error ?? ""),
        ].join(",")
      );
    }
    return lines.join("\n");
  }

  finalizeTickets(tokensPerTicketAtomic: bigint) {
    if (!tokensPerTicketAtomic || tokensPerTicketAtomic <= 0n) return;
    for (const [user, row] of this.rows.entries()) {
      const claimed = row.claimTokensAtomic;
      const rawWin = claimed > 0n ? claimed / tokensPerTicketAtomic : 0n;
      const win = Number(rawWin);
      const clampedWin = Math.max(0, Math.min(row.tickets, Number.isFinite(win) ? win : 0));
      const lose = Math.max(0, row.tickets - clampedWin);
      const updated: LaunchUserRow = {
        ...row,
        winningTickets: clampedWin,
        losingTickets: lose,
      };
      this.rows.set(user, updated);
    }
  }

  private ensure(user: string): LaunchUserRow {
    const existing = this.rows.get(user);
    if (existing) return { ...existing };
    return {
      user,
      shardId: 0,
      tickets: 0,
      depositLamports: 0n,
      claimTokensAtomic: 0n,
      refundLamports: 0n,
      status: "pending",
    };
  }
}


