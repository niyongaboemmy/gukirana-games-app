import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { accountBalances, desc, economySettings, journalEntries, journalLines, ledgerAccounts, sql } from "@gukirana/db";
import { DEFAULT_ECONOMY, validateEconomy, type EconomySettings } from "@gukirana/money";
import { DB, type Db } from "../../common/db.module.js";
import { newId } from "../../common/ids.js";

const CACHE_MS = 30_000;

/**
 * Economy settings from the database (versioned, append-only) + ledger-derived reports.
 * Settlement / claims call `current()` and record `version` on their journal entries.
 */
@Injectable()
export class EconomyService {
  private cache: { at: number; value: EconomySettings } | null = null;

  constructor(@Inject(DB) private readonly db: Db) {}

  /** Settings in effect now (latest version whose effective-from has passed). Seeds the defaults on first use. */
  async current(): Promise<EconomySettings> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const rows = await this.db
      .select({ version: economySettings.version, settings: economySettings.settings, effectiveFrom: economySettings.effectiveFrom })
      .from(economySettings)
      .where(sql`${economySettings.effectiveFrom} <= now()`)
      .orderBy(desc(economySettings.version))
      .limit(1);
    let value: EconomySettings;
    if (rows[0]) value = { ...(rows[0].settings as EconomySettings), version: rows[0].version, effectiveFrom: rows[0].effectiveFrom.toISOString() };
    else value = await this.seed();
    this.cache = { at: Date.now(), value };
    return value;
  }

  async versions(): Promise<{ version: number; effectiveFrom: string; note: string | null; createdBy: string; createdAt: string }[]> {
    const rows = await this.db
      .select({ version: economySettings.version, effectiveFrom: economySettings.effectiveFrom, note: economySettings.note, createdBy: economySettings.createdBy, createdAt: economySettings.createdAt })
      .from(economySettings)
      .orderBy(desc(economySettings.version));
    return rows.map((r) => ({ ...r, effectiveFrom: r.effectiveFrom.toISOString(), createdAt: r.createdAt.toISOString() }));
  }

  /** Admin edit → a NEW version (never edits history). Effective now, or at a future time; never in the past. */
  async publish(input: Omit<EconomySettings, "version" | "effectiveFrom"> & { effectiveFrom?: string }, by: string, note?: string): Promise<EconomySettings> {
    const now = new Date();
    const eff = input.effectiveFrom ? new Date(input.effectiveFrom) : now;
    if (Number.isNaN(eff.getTime()) || eff.getTime() < now.getTime() - 60_000) throw new BadRequestException({ code: "NOT_RETROACTIVE", message: "effectiveFrom must be now or later" });
    const latest = await this.db.select({ v: sql<number>`coalesce(max(${economySettings.version}), 0)` }).from(economySettings);
    const version = Number(latest[0]?.v ?? 0) + 1;
    const next: EconomySettings = { ...input, version, effectiveFrom: eff.toISOString() };
    const errs = validateEconomy(next);
    if (errs.length) throw new BadRequestException({ code: "INVALID_SETTINGS", errors: errs });
    const stored: Partial<EconomySettings> = { ...next };
    delete stored.version;
    delete stored.effectiveFrom;
    await this.db.insert(economySettings).values({ id: newId(), version, settings: stored, effectiveFrom: eff, note: note ?? null, createdBy: by });
    this.cache = null;
    return next;
  }

  private async seed(): Promise<EconomySettings> {
    const stored: Partial<EconomySettings> = { ...DEFAULT_ECONOMY };
    delete stored.version;
    delete stored.effectiveFrom;
    await this.db
      .insert(economySettings)
      .values({ id: newId(), version: DEFAULT_ECONOMY.version, settings: stored, effectiveFrom: new Date(DEFAULT_ECONOMY.effectiveFrom), note: "defaults", createdBy: "system" })
      .onConflictDoNothing();
    return DEFAULT_ECONOMY;
  }

  /* ---------------- reports (computed from the ledger: the source of truth) ---------------- */

  /** Platform revenue, Stars issued, escrow outstanding, player liabilities, per currency, for [from, to). */
  async summary(from: Date, to: Date) {
    const flows = await this.db.execute(sql`
      select la.currency, la.owner_type, la.kind, je.type,
             sum(case when jl.direction = 'C' then jl.amount else -jl.amount end)::bigint as net,
             count(distinct je.id)::int as entries
      from ${journalLines} jl
      join ${journalEntries} je on je.id = jl.entry_id
      join ${ledgerAccounts} la on la.id = jl.account_id
      where je.created_at >= ${from} and je.created_at < ${to}
      group by la.currency, la.owner_type, la.kind, je.type`);
    const balances = await this.db.execute(sql`
      select la.currency, la.owner_type, la.kind, sum(ab.balance)::bigint as total
      from ${accountBalances} ab join ${ledgerAccounts} la on la.id = ab.account_id
      group by la.currency, la.owner_type, la.kind`);
    const rows = (r: unknown) => ((r as { rows?: unknown[] }).rows ?? (r as unknown[])) as Record<string, unknown>[];
    const num = (v: unknown) => Number(v ?? 0);
    const out: Record<string, { revenue: number; starsIssued: number; dailyClaims: number; escrowOutstanding: number; playerBalances: number; matchesSettled: number }> = {};
    const cur = (c: string) => (out[c] ??= { revenue: 0, starsIssued: 0, dailyClaims: 0, escrowOutstanding: 0, playerBalances: 0, matchesSettled: 0 });
    for (const f of rows(flows)) {
      const c = cur(String(f.currency));
      if (f.owner_type === "platform" && f.kind === "revenue") c.revenue += num(f.net);
      if (f.owner_type === "platform" && f.kind === "budget") c.starsIssued += -num(f.net);
      if (f.type === "stars_daily" && f.owner_type === "user") c.dailyClaims += num(f.entries);
      if (f.type === "settle" && f.owner_type === "escrow") c.matchesSettled += num(f.entries);
    }
    for (const b of rows(balances)) {
      const c = cur(String(b.currency));
      if (b.owner_type === "escrow") c.escrowOutstanding += num(b.total);
      if (b.owner_type === "user") c.playerBalances += num(b.total);
    }
    return { from: from.toISOString(), to: to.toISOString(), byCurrency: out };
  }

  /** Daily revenue + volume per currency and entry type (CSV-friendly rows). */
  async daily(from: Date, to: Date) {
    const r = await this.db.execute(sql`
      select to_char(date_trunc('day', je.created_at at time zone 'Africa/Kigali'), 'YYYY-MM-DD') as day,
             la.currency, je.type,
             count(distinct je.id)::int as entries,
             sum(case when la.owner_type = 'platform' and la.kind = 'revenue' and jl.direction = 'C' then jl.amount else 0 end)::bigint as revenue,
             sum(case when jl.direction = 'D' then jl.amount else 0 end)::bigint as volume
      from ${journalLines} jl
      join ${journalEntries} je on je.id = jl.entry_id
      join ${ledgerAccounts} la on la.id = jl.account_id
      where je.created_at >= ${from} and je.created_at < ${to}
      group by 1, 2, 3 order by 1, 2, 3`);
    const rows = ((r as unknown as { rows?: unknown[] }).rows ?? (r as unknown as unknown[])) as Record<string, unknown>[];
    return rows.map((x) => ({ day: String(x.day), currency: String(x.currency), type: String(x.type), entries: Number(x.entries), revenue: Number(x.revenue), volume: Number(x.volume) }));
  }

  /** Double-entry integrity: every currency's lines net to zero, and stored balances equal the sum of postings. */
  async reconciliation() {
    const r1 = await this.db.execute(sql`
      select la.currency, sum(case when jl.direction = 'C' then jl.amount else -jl.amount end)::bigint as net
      from ${journalLines} jl join ${ledgerAccounts} la on la.id = jl.account_id group by la.currency`);
    const r2 = await this.db.execute(sql`
      select count(*)::int as mismatched from (
        select ab.account_id, ab.balance,
               coalesce(sum(case when jl.direction = 'C' then jl.amount else -jl.amount end), 0) as posted
        from ${accountBalances} ab left join ${journalLines} jl on jl.account_id = ab.account_id
        group by ab.account_id, ab.balance) t
      where t.balance <> t.posted`);
    const rows = (r: unknown) => ((r as { rows?: unknown[] }).rows ?? (r as unknown[])) as Record<string, unknown>[];
    const nets = rows(r1).map((x) => ({ currency: String(x.currency), net: Number(x.net) }));
    const mismatched = Number(rows(r2)[0]?.mismatched ?? 0);
    return { ok: nets.every((n) => n.net === 0) && mismatched === 0, currencyNets: nets, mismatchedAccounts: mismatched };
  }
}
