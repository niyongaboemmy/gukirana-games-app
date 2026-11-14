import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import {
  and,
  eq,
  friendlyPlays,
  gte,
  inArray,
  journalEntries,
  matches,
  matchPlayers,
  or,
  ratings,
  sql,
  users,
  xpEvents,
} from "@gukirana/db";
import { keyFromSeed, verifyResult, type SignedMatchResult } from "@gukirana/signing";
import { coins, matchTableFee } from "@gukirana/money";
import { createLogger } from "@gukirana/observability";
import {
  GAME_IDS,
  rulesOf,
  type GameId,
  type MatchRefusal,
  type MatchRules,
  type PlayerOffer,
  type StakeOption,
  type VoidCause,
} from "@gukirana/contracts";
import { DB, type Db } from "../../common/db.module.js";
import { env } from "../../common/env.js";
import { kigaliDay, newId } from "../../common/ids.js";
import { LedgerService } from "../ledger/ledger.service.js";
import { EconomyService } from "../economy/economy.service.js";
import { WalletService } from "../wallet/wallet.service.js";
import { matchEscrow, platformRevenue, userStars } from "../ledger/accounts.js";
import { LevelsService } from "../levels/levels.service.js";
import { eloUpdate, xpForMatch } from "../levels/xp.js";
import { GameSettingsService, writeAudit } from "./game-settings.service.js";

const log = createLogger("games");

/** Why a player can't be put into a live match right now. Only that player is told a personal reason. */
export type IneligibleReason = MatchRefusal;
export type Eligibility = { ok: true } | { ok: false; reason: IneligibleReason; limit?: number };

export interface CreateMatchInput {
  game: GameId;
  variant: string;
  stake: number;
  players: { userId: string; seat: number }[];
}

/** a match whose game server stopped saying "still running" for this long is stale (heartbeat every ~20 s) */
export const HEARTBEAT_STALE_MS = 120_000;
/** extra time past the match's own maximum before the sweep voids it */
export const SWEEP_GRACE_MS = 10 * 60_000;
/** matches created before P1-GAME-06 carry no void_after: treat them as 4 h long */
const LEGACY_MAX_MS = 4 * 3600_000;
const SWEEP_MS = 60_000;
const CURRENCY = "STAR" as const;

const refusal = (reason: IneligibleReason, userId: string, extra: Record<string, unknown> = {}) =>
  reason === "UNKNOWN_PLAYER" ? new NotFoundException({ code: reason, userId }) : new ConflictException({ code: reason, userId, ...extra });

/**
 * Match money flow (SRS §6.5, plan Appendix A.4/A.5, docs/GAME-EXIT-RULES.md) — Stars only until the licensed Coins
 * pilot. Pot = Σ stakes, paid in full to the winner (FR-ESC-03). Settlement only from a signed result; a void refunds
 * every stake. Every posting is idempotent (`lock:` / `settle:` / `void:` + match id), and a match is settled OR voided,
 * never both: each path first looks for the other's journal entry. A sweep voids matches no game server is running.
 */
@Injectable()
export class GamesService implements OnModuleInit, OnModuleDestroy {
  private readonly publicKey = keyFromSeed(env().RESULT_SIGNING_SEED).publicKey;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly settings: GameSettingsService;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly levels: LevelsService,
    private readonly economy: EconomyService,
    private readonly wallet: WalletService,
    @Optional() settings?: GameSettingsService,
  ) {
    this.settings = settings ?? new GameSettingsService(db);
  }

  onModuleInit(): void {
    // reconciliation safety: on start and every minute, void + refund what no game server is running (idempotent)
    const run = () => void this.sweepStale().catch((e) => log.warn({ err: String(e) }, "stale match sweep failed"));
    setTimeout(run, 5_000).unref?.();
    this.timer = setInterval(run, SWEEP_MS);
    this.timer.unref?.();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async create(input: CreateMatchInput): Promise<{ matchId: string; rules: MatchRules; players: { userId: string; seat: number; rating: number; name: string; color: string }[] }> {
    const ids = input.players.map((p) => p.userId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException({ code: "DUPLICATE_PLAYER" });
    const { version, settings } = await this.settings.current(input.game);
    // the table first (both players hear these), then every player again — realtime pre-checks when the challenge /
    // quick match is made, this is the authoritative re-check at accept time. The error names the player (`userId`)
    // so realtime tells only that player the precise reason (GAP-005).
    if (!settings.enabled) throw new ConflictException({ code: "GAME_DISABLED" });
    if (input.stake > 0 && !settings.stakes.includes(input.stake)) throw new ConflictException({ code: "STAKE_NOT_ALLOWED" });
    for (const id of ids) {
      const r = await this.eligibility(id, input.stake, input.game);
      if (!r.ok) throw refusal(r.reason, id, r.limit !== undefined ? { limit: r.limit, game: input.game } : {});
    }
    const found = await this.db.select().from(users).where(inArray(users.id, ids));
    if (found.length !== ids.length) throw new NotFoundException({ code: "UNKNOWN_PLAYER" });

    const fee = matchTableFee(CURRENCY, coins(input.stake), (await this.economy.current()).feeBands);
    const rules = rulesOf(settings, version);
    const matchId = newId();
    const day = kigaliDay();
    const r = await this.db.select().from(ratings).where(and(inArray(ratings.userId, ids), eq(ratings.game, input.game)));
    const ratingOf = (u: string) => r.find((x) => x.userId === u)?.rating ?? 1500;

    // one transaction: the players' rows are locked (id order, no deadlocks), so two creates for the same player run
    // one after the other — "already in a match" and the friendly counter can't be raced past.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.db as any).transaction(async (tx: Db) => {
      await tx.select({ id: users.id }).from(users).where(inArray(users.id, [...ids].sort())).orderBy(users.id).for("update");
      for (const id of ids) if (await this.inActiveMatch(id, tx)) throw refusal("ALREADY_IN_MATCH", id);
      if (input.stake === 0) {
        for (const id of ids) {
          if (settings.friendlyPerDay <= 0) throw refusal("FRIENDLY_LIMIT_REACHED", id, { limit: 0, game: input.game });
          const took = await tx
            .insert(friendlyPlays)
            .values({ userId: id, game: input.game, day, count: 1 })
            .onConflictDoUpdate({
              target: [friendlyPlays.userId, friendlyPlays.game, friendlyPlays.day],
              set: { count: sql`${friendlyPlays.count} + 1` },
              setWhere: sql`${friendlyPlays.count} < ${settings.friendlyPerDay}`,
            })
            .returning();
          if (!took.length) throw refusal("FRIENDLY_LIMIT_REACHED", id, { limit: settings.friendlyPerDay, game: input.game });
        }
      }
      const now = Date.now();
      await tx.insert(matches).values({
        id: matchId,
        game: input.game,
        variant: input.variant,
        currency: CURRENCY,
        stake: input.stake,
        fee,
        status: "active",
        rules,
        voidAfter: new Date(now + rules.maxMatchMinutes * 60_000 + SWEEP_GRACE_MS),
        heartbeatAt: new Date(now),
      });
      await tx.insert(matchPlayers).values(input.players.map((p) => ({ matchId, userId: p.userId, seat: p.seat, ratingBefore: ratingOf(p.userId) })));
    });

    if (input.stake > 0) {
      try {
        // FR-ESC-01: stakes (+ the table fee, from packages/money) are in escrow before the first move
        await this.ledger.post({
          economyVersion: (await this.economy.current()).version,
          type: "stake_lock",
          idempotencyKey: `lock:${matchId}`,
          ref: { type: "match", id: matchId },
          createdBy: "games",
          lines: [
            ...input.players.map((p) => ({ account: userStars(p.userId), amount: input.stake + fee, direction: "D" as const })),
            { account: matchEscrow(matchId, CURRENCY), amount: (input.stake + fee) * input.players.length, direction: "C" as const },
          ],
        });
      } catch (e) {
        // nothing was locked (the posting is all-or-nothing): the match never existed for the players
        await this.db.update(matches).set({ status: "void", endedAt: new Date() }).where(eq(matches.id, matchId));
        throw e;
      }
    }
    return {
      matchId,
      rules,
      players: input.players.map((p) => {
        const u = found.find((x) => x.id === p.userId)!;
        return { userId: p.userId, seat: p.seat, rating: ratingOf(p.userId), name: u.username ?? "Player", color: u.color };
      }),
    };
  }

  private async inActiveMatch(userId: string, db: Db = this.db): Promise<boolean> {
    const rows = await db
      .select({ id: matches.id })
      .from(matchPlayers)
      .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(and(eq(matchPlayers.userId, userId), eq(matches.status, "active")))
      .limit(1);
    return rows.length > 0;
  }

  private async friendlyUsed(userId: string, game: GameId, day = kigaliDay()): Promise<number> {
    const [row] = await this.db
      .select({ count: friendlyPlays.count })
      .from(friendlyPlays)
      .where(and(eq(friendlyPlays.userId, userId), eq(friendlyPlays.game, game), eq(friendlyPlays.day, day)));
    return row?.count ?? 0;
  }

  /** stake + fee this player must hold; the responsible-play refusal for this stake, if any */
  private async stakeRefusal(userId: string, stake: number): Promise<IneligibleReason | null> {
    try {
      await this.wallet.assertCanStake(userId, stake);
    } catch (e) {
      const body = e instanceof ConflictException ? (e.getResponse() as { code?: string }) : undefined;
      if (body?.code === "ON_A_BREAK" || body?.code === "DAILY_LIMIT_REACHED") return body.code;
      throw e;
    }
    const fee = matchTableFee(CURRENCY, coins(stake), (await this.economy.current()).feeBands);
    if ((await this.ledger.balance(userStars(userId))) < stake + fee) return "INSUFFICIENT_FUNDS";
    return null;
  }

  /**
   * May this player be put into a live match at this stake now? (docs/GAME-EXIT-RULES.md §Validations.) Active
   * account; not in another live match; with `game`: the game is open, the stake is one of its stakes and, for a
   * friendly, a friendly game is left today; for stake > 0: not on a break, under their own daily stake limit and
   * holding stake + fee. Read-only: create() re-checks inside its transaction.
   */
  async eligibility(userId: string, stake: number, game?: GameId): Promise<Eligibility> {
    const [u] = await this.db.select({ status: users.status }).from(users).where(eq(users.id, userId));
    if (!u) return { ok: false, reason: "UNKNOWN_PLAYER" };
    if (u.status !== "active") return { ok: false, reason: "ACCOUNT_INACTIVE" };
    if (game) {
      const { settings } = await this.settings.current(game);
      if (!settings.enabled) return { ok: false, reason: "GAME_DISABLED" };
      if (stake > 0 && !settings.stakes.includes(stake)) return { ok: false, reason: "STAKE_NOT_ALLOWED" };
      if (stake === 0 && (await this.friendlyUsed(userId, game)) >= settings.friendlyPerDay) return { ok: false, reason: "FRIENDLY_LIMIT_REACHED", limit: settings.friendlyPerDay };
    }
    if (await this.inActiveMatch(userId)) return { ok: false, reason: "ALREADY_IN_MATCH" };
    if (stake > 0) {
      const why = await this.stakeRefusal(userId, stake);
      if (why) return { ok: false, reason: why };
    }
    return { ok: true };
  }

  /** GET /games/offer: every option this player has right now, with the reason a disabled one is disabled */
  async offer(userId: string): Promise<PlayerOffer> {
    const [u] = await this.db.select({ status: users.status }).from(users).where(eq(users.id, userId));
    if (!u) throw new NotFoundException({ code: "UNKNOWN_PLAYER" });
    const active = u.status === "active";
    const inMatch = await this.inActiveMatch(userId);
    const stars = await this.ledger.balance(userStars(userId));
    const bands = (await this.economy.current()).feeBands;
    const byStake = new Map<number, IneligibleReason | null>();
    const day = kigaliDay();
    const games: PlayerOffer["games"] = [];
    for (const game of GAME_IDS) {
      const { version, settings } = await this.settings.current(game);
      const used = await this.friendlyUsed(userId, game, day);
      const left = Math.max(0, settings.friendlyPerDay - used);
      const common: IneligibleReason | null = !active ? "ACCOUNT_INACTIVE" : !settings.enabled ? "GAME_DISABLED" : inMatch ? "ALREADY_IN_MATCH" : null;
      const friendlyWhy = common ?? (left <= 0 ? "FRIENDLY_LIMIT_REACHED" : null);
      const stakes: StakeOption[] = [];
      for (const stake of settings.stakes) {
        const fee = matchTableFee(CURRENCY, coins(stake), bands);
        let why: IneligibleReason | null = common;
        if (!why) {
          if (!byStake.has(stake)) byStake.set(stake, await this.stakeRefusal(userId, stake));
          why = byStake.get(stake)!;
        }
        stakes.push({ stake, fee, total: stake + fee, ok: !why, ...(why ? { reason: why } : {}) });
      }
      games.push({
        game,
        enabled: settings.enabled,
        friendly: { limit: settings.friendlyPerDay, used, left, ok: !friendlyWhy, ...(friendlyWhy ? { reason: friendlyWhy } : {}) },
        stakes,
        rules: rulesOf(settings, version),
      });
    }
    return { stars, inMatch, day, games };
  }

  /**
   * A player was suspended: every active match they are in is voided and every stake refunded through the ledger
   * (the same `refund` entry as any void; idempotent). The realtime match room also voids when it sees the suspension.
   */
  async voidActiveFor(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: matches.id })
      .from(matchPlayers)
      .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(and(eq(matchPlayers.userId, userId), eq(matches.status, "active")));
    for (const r of rows) await this.void(r.id, "PLAYER_SUSPENDED");
    return rows.map((r) => r.id);
  }

  private async posted(key: string): Promise<boolean> {
    const rows = await this.db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.idempotencyKey, key)).limit(1);
    return rows.length > 0;
  }

  /** active → `to`, once: only the caller that flips the row goes on to ratings / counters (returns false otherwise) */
  private async flip(matchId: string, to: "settled" | "void", extra: { result?: unknown; voidCause?: string | null } = {}): Promise<boolean> {
    const rows = await this.db
      .update(matches)
      .set({ status: to, endedAt: new Date(), ...(extra.result !== undefined ? { result: extra.result } : {}), ...(extra.voidCause !== undefined ? { voidCause: extra.voidCause } : {}) })
      .where(and(eq(matches.id, matchId), eq(matches.status, "active")))
      .returning();
    return rows.length > 0;
  }

  async settle(matchId: string, result: SignedMatchResult) {
    if (result.matchId !== matchId) throw new BadRequestException({ code: "MATCH_MISMATCH" });
    if (!verifyResult(result, this.publicKey)) throw new UnauthorizedException({ code: "BAD_RESULT_SIGNATURE" });
    const [m] = await this.db.select().from(matches).where(eq(matches.id, matchId));
    if (!m) throw new NotFoundException();
    if (m.status === "settled") return { status: "settled", replayed: true };
    if (m.status !== "active") throw new ConflictException({ code: "MATCH_NOT_ACTIVE", status: m.status });
    const players = await this.db.select().from(matchPlayers).where(eq(matchPlayers.matchId, matchId));
    if (players.some((p) => !(p.userId in result.ranks))) throw new BadRequestException({ code: "RANKS_INCOMPLETE" });
    if (result.reason === "void") return this.void(matchId);
    // a refund already went out (sweep / void raced this result): the match stays void, nobody is paid twice
    if (m.stake > 0 && (await this.posted(`void:${matchId}`))) {
      await this.flip(matchId, "void");
      throw new ConflictException({ code: "MATCH_NOT_ACTIVE", status: "void" });
    }

    const perPlayer = m.stake + m.fee;
    const pot = m.stake * players.length;
    const fees = m.fee * players.length;
    if (pot > 0) {
      const best = Math.min(...players.map((p) => result.ranks[p.userId]!));
      const winners = players.filter((p) => result.ranks[p.userId] === best);
      const share = Math.floor(pot / winners.length);
      const remainder = pot - share * winners.length; // draws: split evenly, remainder to the first seat
      await this.ledger.post({
        economyVersion: (await this.economy.current()).version,
        type: "settle",
        idempotencyKey: `settle:${matchId}`,
        ref: { type: "match", id: matchId },
        createdBy: "games",
        lines: [
          { account: matchEscrow(matchId, "STAR"), amount: perPlayer * players.length, direction: "D" },
          ...winners.map((w, i) => ({ account: userStars(w.userId), amount: share + (i === 0 ? remainder : 0), direction: "C" as const })),
          // Stars carry no fee today (matchTableFee); a Coins fee would be credited to platform revenue here
          ...(fees > 0 ? [{ account: platformRevenue("STAR"), amount: fees, direction: "C" as const }] : []),
        ],
      });
    }
    // exactly one caller applies ratings + XP (a replayed result after a crash only re-posts, idempotently)
    if (!(await this.flip(matchId, "settled", { result }))) return { status: "settled", replayed: true };

    const before = players.map((p) => ({ id: p.userId, rating: p.ratingBefore ?? 1500, rank: result.ranks[p.userId]! }));
    const after = eloUpdate(before);
    const xpOut: Record<string, number> = {};
    for (const p of players) {
      const rank = result.ranks[p.userId]!;
      const won = rank === 1 && players.filter((q) => result.ranks[q.userId] === 1).length === 1;
      const draw = players.every((q) => result.ranks[q.userId] === rank);
      await this.db
        .insert(ratings)
        .values({ userId: p.userId, game: m.game, rating: after[p.userId]!, games: 1, wins: won ? 1 : 0 })
        .onConflictDoUpdate({
          target: [ratings.userId, ratings.game],
          set: { rating: after[p.userId]!, games: sql`${ratings.games} + 1`, wins: sql`${ratings.wins} + ${won ? 1 : 0}` },
        });
      await this.db.update(matchPlayers).set({ rank, ratingAfter: after[p.userId]! }).where(and(eq(matchPlayers.matchId, matchId), eq(matchPlayers.userId, p.userId)));

      const winsToday = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(xpEvents)
        .where(and(eq(xpEvents.userId, p.userId), eq(xpEvents.day, kigaliDay()), eq(xpEvents.reason, "match_win")));
      const opp = players.find((q) => q.userId !== p.userId)!;
      const vsOpp = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(matchPlayers)
        .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
        .where(and(eq(matchPlayers.userId, opp.userId), gte(matches.createdAt, new Date(Date.now() - 24 * 3600_000))));
      const xp = xpForMatch(
        {
          outcome: result.reason === "forfeit" && !won ? "forfeit" : won ? "win" : draw ? "draw" : "loss",
          beatHigherRated: won && (opp.ratingBefore ?? 1500) > (p.ratingBefore ?? 1500),
          firstWinToday: won && Number(winsToday[0]?.n ?? 0) === 0,
          sameOpponentCountToday: Math.max(0, Number(vsOpp[0]?.n ?? 0) - 1),
        },
        await this.levels.todayXp(p.userId),
      );
      xpOut[p.userId] = await this.levels.award(p.userId, xp, won ? "match_win" : "match", matchId);
    }
    return { status: "settled", pot, ratings: after, xp: xpOut };
  }

  /**
   * Void: every player gets back exactly what was locked (stake + fee), no rating, no XP, and a voided friendly
   * match gives the friendly game back. Idempotent (a second call is a no-op); never after a settlement.
   */
  async void(matchId: string, cause: VoidCause | null = null) {
    const [m] = await this.db.select().from(matches).where(eq(matches.id, matchId));
    if (!m) throw new NotFoundException();
    if (m.status !== "active") return { status: m.status, replayed: true };
    const players = await this.db.select().from(matchPlayers).where(eq(matchPlayers.matchId, matchId));
    if (m.stake > 0) {
      // the pot was already paid (settlement raced this void, or crashed before marking the match): it stays settled
      if (await this.posted(`settle:${matchId}`)) {
        await this.flip(matchId, "settled");
        return { status: "settled", replayed: true };
      }
      const perPlayer = m.stake + m.fee;
      await this.ledger.post({
        economyVersion: (await this.economy.current()).version,
        type: "refund",
        idempotencyKey: `void:${matchId}`,
        ref: { type: "match", id: matchId },
        createdBy: "games",
        lines: [
          { account: matchEscrow(matchId, "STAR"), amount: perPlayer * players.length, direction: "D" },
          ...players.map((p) => ({ account: userStars(p.userId), amount: perPlayer, direction: "C" as const })),
        ],
      });
    }
    if (!(await this.flip(matchId, "void", { voidCause: cause }))) {
      const [now] = await this.db.select({ status: matches.status }).from(matches).where(eq(matches.id, matchId));
      return { status: now?.status ?? "void", replayed: true };
    }
    if (m.stake === 0) {
      const day = kigaliDay(m.createdAt);
      for (const p of players)
        await this.db
          .update(friendlyPlays)
          .set({ count: sql`greatest(${friendlyPlays.count} - 1, 0)` })
          .where(and(eq(friendlyPlays.userId, p.userId), eq(friendlyPlays.game, m.game), eq(friendlyPlays.day, day)));
    }
    return { status: "void", cause };
  }

  /** realtime → API every ~20 s: these matches are running. Returns the ones that are no longer active (end them). */
  async heartbeat(matchIds: string[]): Promise<{ inactive: string[] }> {
    if (!matchIds.length) return { inactive: [] };
    const alive = await this.db
      .update(matches)
      .set({ heartbeatAt: new Date() })
      .where(and(inArray(matches.id, matchIds), eq(matches.status, "active")))
      .returning();
    const ok = new Set(alive.map((r) => r.id));
    return { inactive: matchIds.filter((id) => !ok.has(id)) };
  }

  /**
   * Reconciliation (FR-ESC-06, docs/GAME-EXIT-RULES.md §Safety): an active match that no game server has reported for
   * HEARTBEAT_STALE_MS (crash, restart, lost room) or that ran past its maximum length is voided and refunded —
   * idempotently, with an audit row each. Runs on start and every minute.
   */
  async sweepStale(now = new Date()): Promise<string[]> {
    const stale = new Date(now.getTime() - HEARTBEAT_STALE_MS);
    const legacy = new Date(now.getTime() - LEGACY_MAX_MS);
    const rows = await this.db
      .select({ id: matches.id, createdAt: matches.createdAt, heartbeatAt: matches.heartbeatAt, voidAfter: matches.voidAfter, stake: matches.stake })
      .from(matches)
      .where(
        and(
          eq(matches.status, "active"),
          or(
            sql`${matches.voidAfter} < ${now.toISOString()}::timestamptz`,
            sql`coalesce(${matches.heartbeatAt}, ${matches.createdAt}) < ${stale.toISOString()}::timestamptz`,
            sql`${matches.voidAfter} is null and ${matches.createdAt} < ${legacy.toISOString()}::timestamptz`,
          ),
        ),
      );
    const out: string[] = [];
    for (const r of rows) {
      try {
        const v = await this.void(r.id, "STALE_ESCROW");
        if (v.status === "void" && !("replayed" in v)) {
          out.push(r.id);
          const why = r.voidAfter && r.voidAfter < now ? "ran past its maximum length" : "no game server is running it";
          await writeAudit(this.db, "system:sweep", "match.void", `match:${r.id}`, `stale escrow: ${why}; stake ${r.stake} Stars each refunded`);
        }
      } catch (e) {
        log.warn({ err: String(e), matchId: r.id }, "stale match void failed");
      }
    }
    if (out.length) log.info({ matches: out.length }, "stale matches voided and refunded");
    return out;
  }
}
