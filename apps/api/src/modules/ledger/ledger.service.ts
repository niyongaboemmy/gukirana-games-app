import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { accountBalances, and, desc, eq, inArray, journalEntries, journalLines, ledgerAccounts, outbox } from "@gukirana/db";
import { DB, type Db } from "../../common/db.module.js";
import { newId } from "../../common/ids.js";
import type { AccountRef } from "./accounts.js";

export interface PostLine {
  account: AccountRef;
  amount: number;
  direction: "D" | "C";
}

export interface PostEntry {
  type: string;
  idempotencyKey: string;
  ref?: { type: string; id: string };
  createdBy: string;
  lines: PostLine[];
  /** economy settings version in effect (fees / rates used) — recorded for audit */
  economyVersion?: number;
}

export class InsufficientFunds extends ConflictException {
  constructor(public readonly account: AccountRef) {
    super({ code: "INSUFFICIENT_FUNDS", ownerType: account.ownerType, ownerId: account.ownerId, currency: account.currency });
  }
}

const accKey = (a: AccountRef) => `${a.ownerType}:${a.ownerId}:${a.kind}:${a.currency}`;

/**
 * The ONLY code that changes balances (plan §4.3, Appendix A.2).
 * Balanced, idempotent, lock-ordered postings with non-negative enforcement and an outbox event.
 * Convention: every account is credit-normal → credit increases, debit decreases the balance.
 */
@Injectable()
export class LedgerService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async post(cmd: PostEntry): Promise<{ entryId: string; replayed: boolean }> {
    if (cmd.lines.length < 2) throw new Error("ENTRY_NEEDS_TWO_LINES");
    let debit = 0;
    let credit = 0;
    for (const l of cmd.lines) {
      if (!Number.isSafeInteger(l.amount) || l.amount <= 0) throw new Error(`INVALID_AMOUNT:${l.amount}`);
      if (l.direction === "D") debit += l.amount;
      else credit += l.amount;
    }
    if (debit !== credit) throw new Error(`UNBALANCED_ENTRY:${debit}!=${credit}`);
    const currencies = new Set(cmd.lines.map((l) => l.account.currency));
    if (currencies.size !== 1) throw new Error("MIXED_CURRENCY_ENTRY");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.db as any).transaction(async (tx: Db) => {
      const existing = await tx.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.idempotencyKey, cmd.idempotencyKey));
      if (existing[0]) return { entryId: existing[0].id, replayed: true };

      // resolve (or create) accounts, then lock balances in a fixed order (no deadlocks)
      const ids = new Map<string, { id: string; ref: AccountRef }>();
      for (const l of cmd.lines) {
        const k = accKey(l.account);
        if (!ids.has(k)) ids.set(k, { id: await this.ensureAccount(tx, l.account), ref: l.account });
      }
      const sorted = [...ids.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
      const rows = await tx
        .select({ accountId: accountBalances.accountId, balance: accountBalances.balance, allowNegative: ledgerAccounts.allowNegative })
        .from(accountBalances)
        .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, accountBalances.accountId))
        .where(inArray(accountBalances.accountId, sorted.map((s) => s.id)))
        .orderBy(accountBalances.accountId)
        .for("update", { of: accountBalances });
      const balances = new Map(rows.map((r) => [r.accountId, { balance: Number(r.balance), allowNegative: r.allowNegative }]));

      for (const l of cmd.lines) {
        const id = ids.get(accKey(l.account))!.id;
        const b = balances.get(id)!;
        b.balance += l.direction === "C" ? l.amount : -l.amount;
      }
      for (const s of sorted) {
        const b = balances.get(s.id)!;
        if (!b.allowNegative && b.balance < 0) throw new InsufficientFunds(s.ref);
      }

      const entryId = newId();
      await tx.insert(journalEntries).values({ id: entryId, type: cmd.type, idempotencyKey: cmd.idempotencyKey, refType: cmd.ref?.type, refId: cmd.ref?.id, createdBy: cmd.createdBy, economyVersion: cmd.economyVersion ?? null });
      await tx.insert(journalLines).values(cmd.lines.map((l) => ({ entryId, accountId: ids.get(accKey(l.account))!.id, amount: l.amount, direction: l.direction })));
      for (const s of sorted) {
        await tx.update(accountBalances).set({ balance: balances.get(s.id)!.balance }).where(eq(accountBalances.accountId, s.id));
      }
      await tx.insert(outbox).values({ id: newId(), type: `ledger.${cmd.type}`, payload: JSON.stringify({ entryId, ref: cmd.ref ?? null }) });
      return { entryId, replayed: false };
    });
  }

  async balance(ref: AccountRef): Promise<number> {
    const rows = await this.db
      .select({ balance: accountBalances.balance })
      .from(ledgerAccounts)
      .innerJoin(accountBalances, eq(accountBalances.accountId, ledgerAccounts.id))
      .where(and(eq(ledgerAccounts.ownerType, ref.ownerType), eq(ledgerAccounts.ownerId, ref.ownerId), eq(ledgerAccounts.kind, ref.kind), eq(ledgerAccounts.currency, ref.currency)));
    return rows[0] ? Number(rows[0].balance) : 0;
  }

  async history(ref: AccountRef, limit = 20): Promise<{ type: string; amount: number; at: Date; refType: string | null }[]> {
    const rows = await this.db
      .select({ type: journalEntries.type, amount: journalLines.amount, direction: journalLines.direction, at: journalEntries.createdAt, refType: journalEntries.refType })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
      .where(and(eq(ledgerAccounts.ownerType, ref.ownerType), eq(ledgerAccounts.ownerId, ref.ownerId), eq(ledgerAccounts.kind, ref.kind), eq(ledgerAccounts.currency, ref.currency)))
      .orderBy(desc(journalEntries.createdAt))
      .limit(limit);
    return rows.map((r) => ({ type: r.type, amount: r.direction === "C" ? Number(r.amount) : -Number(r.amount), at: r.at, refType: r.refType }));
  }

  /** Sum of every balance — must always be 0 (plan Appendix A.6 invariant 4). */
  async totalOfAllBalances(): Promise<number> {
    const rows = await this.db.select({ balance: accountBalances.balance }).from(accountBalances);
    return rows.reduce((s, r) => s + Number(r.balance), 0);
  }

  private async ensureAccount(tx: Db, ref: AccountRef): Promise<string> {
    const where = and(eq(ledgerAccounts.ownerType, ref.ownerType), eq(ledgerAccounts.ownerId, ref.ownerId), eq(ledgerAccounts.kind, ref.kind), eq(ledgerAccounts.currency, ref.currency));
    const found = await tx.select({ id: ledgerAccounts.id }).from(ledgerAccounts).where(where);
    if (found[0]) return found[0].id;
    const id = newId();
    await tx.insert(ledgerAccounts).values({ id, ownerType: ref.ownerType, ownerId: ref.ownerId, kind: ref.kind, currency: ref.currency, allowNegative: ref.allowNegative ?? false }).onConflictDoNothing();
    const again = await tx.select({ id: ledgerAccounts.id }).from(ledgerAccounts).where(where);
    await tx.insert(accountBalances).values({ accountId: again[0]!.id, balance: 0 }).onConflictDoNothing();
    return again[0]!.id;
  }
}
