import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import { eq, journalEntries, journalLines, ledgerAccounts, sql, walletLimits } from "@gukirana/db";
import { coins, quoteBuy, quoteCashout, streakBonus } from "@gukirana/money";
import { DB, type Db } from "../../common/db.module.js";
import { kigaliDay } from "../../common/ids.js";
import { LedgerService } from "../ledger/ledger.service.js";
import { starsBudget, userCoins, userStars } from "../ledger/accounts.js";
import { EconomyService } from "../economy/economy.service.js";

const DAY_MS = 86_400_000;
/** raising a limit only takes effect after this cooling-off (lowering is immediate) */
const COOL_OFF_MS = DAY_MS;

export type Limits = { dailyStakeLimit: number | null; pendingStakeLimit: number | null; pendingFrom: string | null; reminderMinutes: number; selfExcludedUntil: string | null };

/**
 * Wallet rules around the ledger: daily claim + streak bonus, level-up gifts, coin quotes (honest breakdown, no
 * execution until the payment provider is integrated) and responsible-play limits enforced on every stake.
 */
@Injectable()
export class WalletService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly economy: EconomyService,
  ) {}

  /* ---------------- rewards ---------------- */

  /** Daily Stars + the streak bonus for consecutive days (both idempotent per Kigali day). */
  async claimDaily(userId: string) {
    const s = await this.economy.current();
    const day = kigaliDay();
    const r = await this.ledger.post({
      type: "stars_daily",
      idempotencyKey: `daily:${userId}:${day}`,
      ref: { type: "user", id: userId },
      createdBy: "wallet",
      economyVersion: s.version,
      lines: [
        { account: starsBudget(), amount: s.dailyStars, direction: "D" },
        { account: userStars(userId), amount: s.dailyStars, direction: "C" },
      ],
    });
    const streak = await this.streakDays(userId);
    const bonus = streakBonus(streak, s);
    let bonusGranted = 0;
    if (!r.replayed && bonus > 0) {
      const b = await this.ledger.post({
        type: "stars_streak",
        idempotencyKey: `streak:${userId}:${day}`,
        ref: { type: "user", id: userId },
        createdBy: "wallet",
        economyVersion: s.version,
        lines: [
          { account: starsBudget(), amount: bonus, direction: "D" },
          { account: userStars(userId), amount: bonus, direction: "C" },
        ],
      });
      if (!b.replayed) bonusGranted = bonus;
    }
    return { granted: r.replayed ? 0 : s.dailyStars, streak, streakBonus: bonusGranted, nextStreakBonus: streakBonus(streak + 1, s), stars: await this.ledger.balance(userStars(userId)) };
  }

  /** Has today's (Kigali day) daily claim been taken, and when does the next one open (next Kigali midnight, UTC+2)? */
  async claimStatus(userId: string, now = new Date()): Promise<{ claimedToday: boolean; nextClaimAt: string }> {
    const key = `daily:${userId}:${kigaliDay(now)}`;
    const rows = await this.db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.idempotencyKey, key)).limit(1);
    // Kigali has no DST: its midnight is 22:00 UTC of the previous calendar day
    const next = new Date(`${kigaliDay(new Date(now.getTime() + DAY_MS))}T00:00:00+02:00`);
    return { claimedToday: rows.length > 0, nextClaimAt: next.toISOString() };
  }

  /** Consecutive Kigali days (ending today or yesterday) with a daily claim. */
  async streakDays(userId: string): Promise<number> {
    const rows = await this.db.execute(sql`
      select distinct split_part(je.idempotency_key, ':', 3) as day
      from ${journalEntries} je
      where je.type = 'stars_daily' and je.idempotency_key like ${`daily:${userId}:%`}
      order by 1 desc limit 120`);
    const days = new Set((((rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[])) as { day: string }[]).map((r) => r.day));
    let n = 0;
    let d = new Date();
    if (!days.has(kigaliDay(d))) d = new Date(d.getTime() - DAY_MS); // not claimed yet today: the streak can still continue
    while (days.has(kigaliDay(d))) {
      n++;
      d = new Date(d.getTime() - DAY_MS);
    }
    return n;
  }

  /** Level-up gift (Stars) for each level gained; idempotent per level. */
  async grantLevelUps(userId: string, fromLevel: number, toLevel: number) {
    if (toLevel <= fromLevel) return 0;
    const s = await this.economy.current();
    if (s.levelUpStars <= 0) return 0;
    let total = 0;
    for (let lv = fromLevel + 1; lv <= toLevel; lv++) {
      const r = await this.ledger.post({
        type: "level_up",
        idempotencyKey: `levelup:${userId}:${lv}`,
        ref: { type: "user", id: userId },
        createdBy: "levels",
        economyVersion: s.version,
        lines: [
          { account: starsBudget(), amount: s.levelUpStars, direction: "D" },
          { account: userStars(userId), amount: s.levelUpStars, direction: "C" },
        ],
      });
      if (!r.replayed) total += s.levelUpStars;
    }
    return total;
  }

  /* ---------------- coins ---------------- */

  coinBalance(userId: string) {
    return this.ledger.balance(userCoins(userId));
  }

  /** Recent coin ledger lines (signed), for the wallet's Activity filter. Empty until the licensed pilot. */
  coinHistory(userId: string, limit = 20) {
    return this.ledger.history(userCoins(userId), limit);
  }

  /** Honest quote (what you pay / get, the spread and fee, the rate version). Execution needs the payment provider. */
  async quote(kind: "buy" | "cashout", currency: string, amount: number) {
    const s = await this.economy.current();
    const r = s.currencies.find((c) => c.code === currency);
    if (!r) throw new BadRequestException({ code: "UNKNOWN_CURRENCY" });
    try {
      if (kind === "buy") return { kind, currency, economyVersion: s.version, ...quoteBuy(amount, r), pilotEnabled: s.pilotEnabled };
      return { kind, currency, economyVersion: s.version, ...quoteCashout(coins(amount), r), pilotEnabled: s.pilotEnabled };
    } catch (e) {
      throw new BadRequestException({ code: (e as Error).message.split(":")[0], message: (e as Error).message });
    }
  }

  /* ---------------- responsible play ---------------- */

  async limits(userId: string): Promise<Limits> {
    const rows = await this.db.select().from(walletLimits).where(eq(walletLimits.userId, userId));
    const l = rows[0];
    if (!l) return { dailyStakeLimit: null, pendingStakeLimit: null, pendingFrom: null, reminderMinutes: 60, selfExcludedUntil: null };
    // a raised limit becomes active once its cooling-off has passed
    if (l.pendingFrom && l.pendingFrom.getTime() <= Date.now()) {
      await this.db.update(walletLimits).set({ dailyStakeLimit: l.pendingStakeLimit, pendingStakeLimit: null, pendingFrom: null, updatedAt: new Date() }).where(eq(walletLimits.userId, userId));
      return this.limits(userId);
    }
    return {
      dailyStakeLimit: l.dailyStakeLimit,
      pendingStakeLimit: l.pendingStakeLimit,
      pendingFrom: l.pendingFrom?.toISOString() ?? null,
      reminderMinutes: l.reminderMinutes,
      selfExcludedUntil: l.selfExcludedUntil && l.selfExcludedUntil.getTime() > Date.now() ? l.selfExcludedUntil.toISOString() : null,
    };
  }

  /** Lowering (or setting) a stake limit is immediate; raising or removing it waits 24 h. */
  async setLimits(userId: string, input: { dailyStakeLimit?: number | null; reminderMinutes?: number }) {
    const cur = await this.limits(userId);
    const patch: Partial<typeof walletLimits.$inferInsert> = { updatedAt: new Date() };
    if (input.reminderMinutes !== undefined) {
      if (![0, 30, 60, 90, 120].includes(input.reminderMinutes)) throw new BadRequestException({ code: "BAD_REMINDER" });
      patch.reminderMinutes = input.reminderMinutes;
    }
    if (input.dailyStakeLimit !== undefined) {
      const v = input.dailyStakeLimit;
      if (v !== null && (!Number.isSafeInteger(v) || v < 10)) throw new BadRequestException({ code: "BAD_LIMIT" });
      const stricter = v !== null && (cur.dailyStakeLimit === null || v <= cur.dailyStakeLimit);
      if (stricter) Object.assign(patch, { dailyStakeLimit: v, pendingStakeLimit: null, pendingFrom: null });
      else Object.assign(patch, { pendingStakeLimit: v, pendingFrom: new Date(Date.now() + COOL_OFF_MS) });
    }
    await this.db
      .insert(walletLimits)
      .values({ userId, reminderMinutes: 60, ...patch })
      .onConflictDoUpdate({ target: walletLimits.userId, set: patch });
    return this.limits(userId);
  }

  /** Take a break: no staked games until the time is up (cannot be shortened). */
  async takeBreak(userId: string, hours: number) {
    if (![24, 168, 720].includes(hours)) throw new BadRequestException({ code: "BAD_BREAK" });
    const cur = await this.limits(userId);
    const until = new Date(Math.max(Date.now() + hours * 3_600_000, cur.selfExcludedUntil ? new Date(cur.selfExcludedUntil).getTime() : 0));
    await this.db
      .insert(walletLimits)
      .values({ userId, reminderMinutes: 60, selfExcludedUntil: until })
      .onConflictDoUpdate({ target: walletLimits.userId, set: { selfExcludedUntil: until, updatedAt: new Date() } });
    return this.limits(userId);
  }

  /** Stakes locked today (Kigali day), across currencies, in their own units. */
  async stakedToday(userId: string): Promise<number> {
    const start = new Date(`${kigaliDay()}T00:00:00+02:00`);
    const r = await this.db.execute(sql`
      select coalesce(sum(jl.amount), 0)::bigint as s
      from ${journalLines} jl
      join ${journalEntries} je on je.id = jl.entry_id
      join ${ledgerAccounts} la on la.id = jl.account_id
      where je.type = 'stake_lock' and jl.direction = 'D' and la.owner_type = 'user' and la.owner_id = ${userId} and je.created_at >= ${start}`);
    const rows = ((r as unknown as { rows?: unknown[] }).rows ?? (r as unknown as unknown[])) as { s: unknown }[];
    return Number(rows[0]?.s ?? 0);
  }

  /** Called before a stake is locked: honours "take a break" and the daily stake limit. */
  async assertCanStake(userId: string, stake: number) {
    if (stake <= 0) return;
    const l = await this.limits(userId);
    if (l.selfExcludedUntil) throw new ConflictException({ code: "ON_A_BREAK", until: l.selfExcludedUntil });
    if (l.dailyStakeLimit !== null && (await this.stakedToday(userId)) + stake > l.dailyStakeLimit) throw new ConflictException({ code: "DAILY_LIMIT_REACHED", limit: l.dailyStakeLimit });
  }
}
