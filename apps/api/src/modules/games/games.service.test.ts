import "reflect-metadata";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { accessAudit, createDatabase, eq, friendlyPlays, matches, users, type Database } from "@gukirana/db";
import { keyFromSeed, signResult, type SignedMatchResult } from "@gukirana/signing";
import { DEFAULT_FIGHT_RULES, DEFAULT_GAME_SETTINGS, type GameId } from "@gukirana/contracts";
import { DEFAULT_ECONOMY } from "@gukirana/money";
import { LedgerService } from "../ledger/ledger.service.js";
import { matchEscrow, userStars } from "../ledger/accounts.js";
import { EconomyService } from "../economy/economy.service.js";
import { WalletService } from "../wallet/wallet.service.js";
import { LevelsService } from "../levels/levels.service.js";
import { env } from "../../common/env.js";
import { kigaliDay } from "../../common/ids.js";
import { GamesService, HEARTBEAT_STALE_MS } from "./games.service.js";
import { GameSettingsService } from "./game-settings.service.js";

/**
 * Match money + exit rules (P1-GAME-06, docs/GAME-EXIT-RULES.md) on an in-memory Postgres (PGlite): settle, forfeit,
 * draw, void, refund, idempotency, settle/void races, the stale-escrow sweep, friendly-per-day counters under parallel
 * creates, "already in a match", allowed stakes, settings validation + audit. After every test the books reconcile
 * (every currency nets to zero, stored balances equal postings).
 */
let db: Database;
let close: () => Promise<void>;
let ledger: LedgerService;
let wallet: WalletService;
let economy: EconomyService;
let settings: GameSettingsService;
let games: GamesService;
const { privateKey } = keyFromSeed(env().RESULT_SIGNING_SEED);

const uid = (n: number) => `66666666-0000-4000-8000-${String(n).padStart(12, "0")}`;
const a = uid(1);
const b = uid(2);
const brk = uid(3);
const poor = uid(4);
const c = uid(5);
const d = uid(6);
const crowd = [7, 8, 9, 10, 11, 12].map(uid);

beforeAll(async () => {
  const x = await createDatabase("pglite://memory");
  db = x.db;
  close = x.close;
  ledger = new LedgerService(db);
  economy = new EconomyService(db);
  // level-up gifts would blur the exact balances asserted below (they are covered by the wallet tests)
  const { version: _v, effectiveFrom: _e, ...eco } = DEFAULT_ECONOMY;
  void _v;
  void _e;
  await economy.current();
  await economy.publish({ ...eco, levelUpStars: 0 }, "test", "no level-up gifts in match tests");
  wallet = new WalletService(db, ledger, economy);
  settings = new GameSettingsService(db);
  await settings.seed();
  games = new GamesService(db, ledger, new LevelsService(db, wallet), economy, wallet, settings);
  const all = [a, b, brk, poor, c, d, ...crowd];
  await db.insert(users).values(all.map((id, i) => ({ id, email: `p${i}@example.test`, username: `p${i}` })));
  for (const u of all) if (u !== poor) await wallet.claimDaily(u); // 200 Stars each, through the ledger
  await wallet.takeBreak(brk, 168);
});
afterAll(() => close());
afterEach(async () => {
  const r = await economy.reconciliation();
  expect(r.ok, JSON.stringify(r)).toBe(true);
});

const create = (ids: string[], stake: number, game: GameId = "igisoro") =>
  games.create({ game, variant: "classic", stake, players: ids.map((userId, seat) => ({ userId, seat })) });
const code = (e: unknown) => (e as { getResponse?: () => unknown }).getResponse?.() as { code?: string; userId?: string; limit?: number } | undefined;
const fail = (p: Promise<unknown>) => p.then(() => undefined, (e: unknown) => code(e));
const stars = (u: string) => ledger.balance(userStars(u));
const result = (matchId: string, ranks: Record<string, number>, reason: SignedMatchResult["reason"] = "normal"): SignedMatchResult =>
  signResult({ matchId, game: "igisoro", ranks, reason, stateHash: "h", seedCommit: "c", seedReveal: "r", finishedAt: new Date().toISOString() }, privateKey);
const status = async (id: string) => (await db.select().from(matches).where(eq(matches.id, id)))[0]!;

describe("validations first (before any escrow)", () => {
  it("names the precise reason for the player concerned", async () => {
    expect(await games.eligibility(a, 25)).toEqual({ ok: true });
    expect(await games.eligibility(brk, 25)).toEqual({ ok: false, reason: "ON_A_BREAK" });
    expect(await games.eligibility(brk, 0)).toEqual({ ok: true }); // friendly stays allowed on a break
    expect(await games.eligibility(poor, 25)).toEqual({ ok: false, reason: "INSUFFICIENT_FUNDS" });
    expect(await games.eligibility(poor, 0, "ludo")).toEqual({ ok: true }); // no Stars: friendly only
    expect(await games.eligibility(uid(9999), 0)).toEqual({ ok: false, reason: "UNKNOWN_PLAYER" });
  });

  it("create() re-checks and names the player in the error; nothing is locked", async () => {
    expect(await fail(create([a, brk], 25))).toMatchObject({ code: "ON_A_BREAK", userId: brk });
    expect(await fail(create([poor, a], 25))).toMatchObject({ code: "INSUFFICIENT_FUNDS", userId: poor });
    expect(await stars(a)).toBe(200);
  });

  it("the stake must be one of the game's stakes; a closed game takes no new matches", async () => {
    expect(await fail(create([a, b], 30))).toMatchObject({ code: "STAKE_NOT_ALLOWED" });
    expect(await games.eligibility(a, 30, "igisoro")).toEqual({ ok: false, reason: "STAKE_NOT_ALLOWED" });
    await settings.update("pool", { ...DEFAULT_GAME_SETTINGS.pool, enabled: false }, "maintenance test", "test");
    expect(await fail(create([a, b], 0, "pool"))).toMatchObject({ code: "GAME_DISABLED" });
    await settings.update("pool", DEFAULT_GAME_SETTINGS.pool, "reopen", "test");
    expect(await stars(a)).toBe(200);
  });

  it("a player already in a live match can't start another (parallel creates book them once)", async () => {
    const tries = await Promise.allSettled(crowd.slice(0, 4).map((o) => create([c, o], 25)));
    const ok = tries.filter((t) => t.status === "fulfilled");
    expect(ok).toHaveLength(1);
    expect(tries.filter((t) => t.status === "rejected").map((t) => code((t as PromiseRejectedResult).reason)?.code)).toEqual(["ALREADY_IN_MATCH", "ALREADY_IN_MATCH", "ALREADY_IN_MATCH"]);
    expect(await stars(c)).toBe(175); // locked once
    expect(await games.eligibility(c, 0, "ludo")).toEqual({ ok: false, reason: "ALREADY_IN_MATCH" });
    await games.void((ok[0] as PromiseFulfilledResult<{ matchId: string }>).value.matchId, "NO_SHOW");
    expect(await stars(c)).toBe(200);
  });
});

describe("completed normally", () => {
  it("win: the winner gets the whole pot, ratings move, a replayed result pays nothing twice", async () => {
    const m = await create([a, b], 25);
    expect(m.rules).toMatchObject({ turnSeconds: 30, reconnectSeconds: 60, maxTimeouts: 3 });
    expect(await ledger.balance(matchEscrow(m.matchId, "STAR"))).toBe(50);
    const r = await games.settle(m.matchId, result(m.matchId, { [a]: 1, [b]: 2 }));
    expect(r).toMatchObject({ status: "settled", pot: 50 });
    expect(await stars(a)).toBe(225);
    expect(await stars(b)).toBe(175);
    expect(await games.settle(m.matchId, result(m.matchId, { [a]: 1, [b]: 2 }))).toEqual({ status: "settled", replayed: true });
    expect(await stars(a)).toBe(225);
    expect(await ledger.balance(matchEscrow(m.matchId, "STAR"))).toBe(0);
    expect((r as { ratings: Record<string, number> }).ratings[a]).toBeGreaterThan(1500);
  });

  it("draw: stakes split back evenly", async () => {
    const m = await create([a, b], 50);
    await games.settle(m.matchId, result(m.matchId, { [a]: 1, [b]: 1 }));
    expect(await stars(a)).toBe(225);
    expect(await stars(b)).toBe(175);
  });

  it("forfeit (leave / disconnect / timeouts): the opponent wins the pot, the leaver gets no XP", async () => {
    const m = await create([a, b], 25);
    const r = (await games.settle(m.matchId, result(m.matchId, { [a]: 2, [b]: 1 }, "forfeit"))) as { xp: Record<string, number> };
    expect(await stars(a)).toBe(200);
    expect(await stars(b)).toBe(200);
    expect(r.xp[a]).toBe(0);
    expect(r.xp[b]).toBeGreaterThan(0);
  });
});

describe("void + refund", () => {
  it("refunds every stake exactly once; a later result can't pay out", async () => {
    const m = await create([a, b], 100);
    expect(await stars(a)).toBe(100);
    expect(await games.void(m.matchId, "BOTH_DISCONNECTED")).toEqual({ status: "void", cause: "BOTH_DISCONNECTED" });
    expect(await games.void(m.matchId, "ROOM_CLOSED")).toMatchObject({ status: "void", replayed: true });
    expect(await stars(a)).toBe(200);
    expect(await stars(b)).toBe(200);
    expect((await status(m.matchId)).voidCause).toBe("BOTH_DISCONNECTED");
    expect(await fail(games.settle(m.matchId, result(m.matchId, { [a]: 1, [b]: 2 })))).toMatchObject({ code: "MATCH_NOT_ACTIVE" });
    expect(await stars(a)).toBe(200);
  });

  it("a void after the settlement changes nothing", async () => {
    const m = await create([a, b], 25);
    await games.settle(m.matchId, result(m.matchId, { [a]: 2, [b]: 1 }));
    expect(await games.void(m.matchId, "SERVER_ERROR")).toMatchObject({ status: "settled", replayed: true });
    expect(await stars(a)).toBe(175);
    expect(await stars(b)).toBe(225);
  });

  it("settlement and void racing: exactly one wins, escrow ends at zero", async () => {
    for (let i = 0; i < 4; i++) {
      const m = await create([a, b], 25);
      const [s, v] = await Promise.allSettled([games.settle(m.matchId, result(m.matchId, { [a]: 1, [b]: 2 })), games.void(m.matchId, "SERVER_ERROR")]);
      expect(s.status === "fulfilled" || v.status === "fulfilled").toBe(true);
      expect(await ledger.balance(matchEscrow(m.matchId, "STAR"))).toBe(0);
      const st = (await status(m.matchId)).status;
      expect(["settled", "void"]).toContain(st);
      // whichever won, the two players' Stars still sum to what they had (the pot never leaves them)
      await games.void(m.matchId);
    }
    expect((await stars(a)) + (await stars(b))).toBe(400);
  });

  it("a suspended player's live matches are voided and refunded (GAP-001)", async () => {
    const before = await stars(a);
    const m = await create([a, d], 25);
    await db.update(users).set({ status: "suspended" }).where(eq(users.id, d));
    expect(await games.eligibility(d, 0)).toEqual({ ok: false, reason: "ACCOUNT_INACTIVE" });
    expect(await games.voidActiveFor(d)).toEqual([m.matchId]);
    expect((await status(m.matchId)).voidCause).toBe("PLAYER_SUSPENDED");
    expect(await stars(a)).toBe(before);
    expect(await stars(d)).toBe(200);
    expect(await games.voidActiveFor(d)).toEqual([]); // idempotent
    expect(await fail(create([a, d], 0))).toMatchObject({ code: "ACCOUNT_INACTIVE", userId: d });
    await db.update(users).set({ status: "active" }).where(eq(users.id, d));
  });
});

describe("reconciliation sweep (never a stuck escrow)", () => {
  it("voids + refunds a match no game server is running, audited, idempotent", async () => {
    const m = await create([a, b], 50);
    const fresh = await create([c, d], 25);
    await db.update(matches).set({ heartbeatAt: new Date(Date.now() - HEARTBEAT_STALE_MS - 5_000) }).where(eq(matches.id, m.matchId));
    expect(await games.sweepStale()).toEqual([m.matchId]);
    expect(await stars(a)).toBeGreaterThanOrEqual(50);
    expect(await ledger.balance(matchEscrow(m.matchId, "STAR"))).toBe(0);
    expect((await status(m.matchId)).voidCause).toBe("STALE_ESCROW");
    expect((await status(fresh.matchId)).status).toBe("active"); // its room is alive
    const audit = await db.select().from(accessAudit).where(eq(accessAudit.target, `match:${m.matchId}`));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ who: "system:sweep", action: "match.void" });
    expect(await games.sweepStale()).toEqual([]);
    // a match past its maximum length is voided even with a live heartbeat
    await db.update(matches).set({ voidAfter: new Date(Date.now() - 1000) }).where(eq(matches.id, fresh.matchId));
    expect(await games.sweepStale()).toEqual([fresh.matchId]);
    expect(await stars(c)).toBe(200);
  });

  it("the heartbeat keeps a match alive and names the ones that ended", async () => {
    const m = await create([a, b], 0, "ludo");
    const r = await games.heartbeat([m.matchId, uid(424242)]);
    expect(r.inactive).toEqual([uid(424242)]);
    await games.void(m.matchId, "NO_SHOW");
    expect((await games.heartbeat([m.matchId])).inactive).toEqual([m.matchId]);
  });
});

describe("friendly games per day (per game, admin-editable)", () => {
  it("counts per player + game + Kigali day; a voided friendly gives its game back; the limit is enforced", async () => {
    await settings.update("ludo", { ...DEFAULT_GAME_SETTINGS.ludo, friendlyPerDay: 2 }, "test limit", "test");
    const used = async (u: string) => (await db.select().from(friendlyPlays).where(eq(friendlyPlays.userId, u))).find((r) => r.game === "ludo" && r.day === kigaliDay())?.count ?? 0;
    const start = await used(b);
    // b may have used some ludo friendlies above (the heartbeat test voided its one: given back)
    expect(start).toBe(0);
    const m1 = await create([b, c], 0, "ludo");
    await games.settle(m1.matchId, result(m1.matchId, { [b]: 1, [c]: 2 }));
    const m2 = await create([b, c], 0, "ludo");
    await games.void(m2.matchId, "NO_SHOW"); // never played: not counted
    expect(await used(b)).toBe(1);
    const m3 = await create([b, c], 0, "ludo");
    await games.settle(m3.matchId, result(m3.matchId, { [b]: 2, [c]: 1 }, "forfeit")); // a forfeit counts
    expect(await used(b)).toBe(2);
    expect(await games.eligibility(b, 0, "ludo")).toEqual({ ok: false, reason: "FRIENDLY_LIMIT_REACHED", limit: 2 });
    expect(await fail(create([b, d], 0, "ludo"))).toMatchObject({ code: "FRIENDLY_LIMIT_REACHED", userId: b, limit: 2 });
    expect(await fail(create([d, b], 0, "ludo"))).toMatchObject({ code: "FRIENDLY_LIMIT_REACHED", userId: b });
    expect(await used(d)).toBe(0); // the refused create took nothing from the other player (one transaction)
    // other games and staked play are separate
    expect(await games.eligibility(b, 0, "igisoro")).toEqual({ ok: true });
    expect(await games.eligibility(b, 25, "ludo")).toEqual({ ok: true });
    const offer = await games.offer(b);
    expect(offer.games.find((g) => g.game === "ludo")?.friendly).toEqual({ limit: 2, used: 2, left: 0, ok: false, reason: "FRIENDLY_LIMIT_REACHED" });
  });

  it("parallel friendly creates for different players never exceed anyone's limit", async () => {
    await settings.update("igisoro", { ...DEFAULT_GAME_SETTINGS.igisoro, friendlyPerDay: 1 }, "race test", "test");
    // three pairs at once, each player has one friendly left: all start; then nobody gets a second, even in parallel
    const pairs = [
      [crowd[0]!, crowd[1]!],
      [crowd[2]!, crowd[3]!],
      [crowd[4]!, crowd[5]!],
    ];
    const first = await Promise.all(pairs.map((p) => create(p, 0)));
    for (const [i, m] of first.entries()) await games.settle(m.matchId, result(m.matchId, { [pairs[i]![0]]: 1, [pairs[i]![1]]: 2 }));
    const second = await Promise.allSettled([create([crowd[0]!, crowd[2]!], 0), create([crowd[1]!, crowd[3]!], 0), create([crowd[4]!, crowd[0]!], 0)]);
    expect(second.every((r) => r.status === "rejected" && code(r.reason)?.code === "FRIENDLY_LIMIT_REACHED")).toBe(true);
    const rows = await db.select().from(friendlyPlays).where(eq(friendlyPlays.game, "igisoro"));
    for (const u of crowd) expect(rows.find((r) => r.userId === u)?.count).toBe(1);
    await settings.update("igisoro", DEFAULT_GAME_SETTINGS.igisoro, "restore", "test");
  });

  it("0 friendly games a day = friendly matches off for that game", async () => {
    await settings.update("pool", { ...DEFAULT_GAME_SETTINGS.pool, friendlyPerDay: 0 }, "staked only", "test");
    expect(await fail(create([a, b], 0, "pool"))).toMatchObject({ code: "FRIENDLY_LIMIT_REACHED", limit: 0 });
    await settings.update("pool", DEFAULT_GAME_SETTINGS.pool, "restore", "test");
  });
});

describe("the offer the sheets show (stake + fee, reasons)", () => {
  it("no Stars: every stake disabled with INSUFFICIENT_FUNDS, friendly offered", async () => {
    const o = await games.offer(poor);
    expect(o.stars).toBe(0);
    const ig = o.games.find((g) => g.game === "igisoro")!;
    expect(ig.friendly.ok).toBe(true);
    expect(ig.stakes.map((s) => [s.stake, s.fee, s.total, s.ok, s.reason])).toEqual([
      [25, 0, 25, false, "INSUFFICIENT_FUNDS"],
      [50, 0, 50, false, "INSUFFICIENT_FUNDS"],
      [100, 0, 100, false, "INSUFFICIENT_FUNDS"],
      [200, 0, 200, false, "INSUFFICIENT_FUNDS"],
    ]);
    expect((await games.offer(brk)).games[0]!.stakes.every((s) => s.reason === "ON_A_BREAK")).toBe(true);
  });
});

describe("game settings (versioned, bounded, audited)", () => {
  it("rejects out-of-bounds values; saves a new version with the reason; running matches keep their rules", async () => {
    const bad = await fail(settings.update("igisoro", { ...DEFAULT_GAME_SETTINGS.igisoro, turnSeconds: 5, stakes: [25, 25] }, "bad", "test"));
    expect(bad?.code).toBe("INVALID_SETTINGS");
    expect(await fail(settings.update("igisoro", { ...DEFAULT_GAME_SETTINGS.igisoro, stakes: [5] }, "bad", "test"))).toMatchObject({ code: "INVALID_SETTINGS" });
    expect(await fail(settings.update("igisoro", { ...DEFAULT_GAME_SETTINGS.igisoro, friendlyPerDay: 1.5 }, "bad", "test"))).toMatchObject({ code: "INVALID_SETTINGS" });
    const running = await create([a, b], 25);
    const before = (await settings.current("igisoro")).version;
    const row = await settings.update("igisoro", { ...DEFAULT_GAME_SETTINGS.igisoro, turnSeconds: 45, stakes: [100, 50] }, "slower turns", "staff-1");
    expect(row).toMatchObject({ version: before + 1, reason: "slower turns", updatedBy: "staff-1", settings: { turnSeconds: 45, stakes: [50, 100] } });
    const fresh = await games.offer(c);
    expect(fresh.games.find((g) => g.game === "igisoro")?.rules.turnSeconds).toBe(45); // new matches: at once
    expect(((await status(running.matchId)).rules as { turnSeconds: number }).turnSeconds).toBe(30); // running: unchanged
    expect(await fail(create([c, d], 25))).toMatchObject({ code: "STAKE_NOT_ALLOWED" }); // 25 was removed
    const audit = await db.select().from(accessAudit).where(eq(accessAudit.target, "game:igisoro"));
    expect(audit.at(-1)?.detail).toMatch(/turnSeconds: 30 → 45.*reason: slower turns/);
    expect((await settings.history("igisoro")).length).toBeGreaterThanOrEqual(2);
    await games.void(running.matchId, "SERVER_ERROR");
    await settings.update("igisoro", DEFAULT_GAME_SETTINGS.igisoro, "restore", "test");
  });
});

describe("boxing (P3-FGT-01): a fight game on the same money paths", () => {
  it("seeded disabled; the fight block is bounded; a row without one runs with the defaults; matches copy it", async () => {
    const off = (await games.offer(c)).games.find((g) => g.game === "boxing")!;
    expect(off).toMatchObject({ enabled: false, friendly: { ok: false, reason: "GAME_DISABLED" }, rules: { fight: DEFAULT_FIGHT_RULES, maxMatchMinutes: 15 } });
    expect(await fail(create([c, d], 25, "boxing"))).toMatchObject({ code: "GAME_DISABLED" });
    const bad = await fail(settings.update("boxing", { ...DEFAULT_GAME_SETTINGS.boxing, fight: { ...DEFAULT_FIGHT_RULES, rounds: 9 } }, "bad", "test"));
    expect(bad?.code).toBe("INVALID_SETTINGS");
    expect(await fail(settings.update("boxing", { ...DEFAULT_GAME_SETTINGS.boxing, fight: { ...DEFAULT_FIGHT_RULES, roundSeconds: 20 } }, "bad", "test"))).toMatchObject({ code: "INVALID_SETTINGS" });
    // saved without the fight block (older editor): the defaults fill it in; a turn game never carries one
    const { fight: _f, ...noFight } = DEFAULT_GAME_SETTINGS.boxing;
    void _f;
    const row = await settings.update("boxing", { ...noFight, enabled: true }, "open boxing", "staff-1");
    expect(row.settings.fight).toEqual(DEFAULT_FIGHT_RULES);
    expect((await settings.update("ludo", { ...DEFAULT_GAME_SETTINGS.ludo, fight: DEFAULT_FIGHT_RULES }, "noop", "test")).settings.fight).toBeUndefined();
    await settings.update("boxing", { ...DEFAULT_GAME_SETTINGS.boxing, enabled: true, fight: { ...DEFAULT_FIGHT_RULES, rounds: 2, roundSeconds: 45 } }, "short fights", "staff-1");
    const audit = await db.select().from(accessAudit).where(eq(accessAudit.target, "game:boxing"));
    expect(audit.at(-1)?.detail).toMatch(/fight: .*rounds=3.* → .*rounds=2/);
    const before = [await stars(c), await stars(d)];
    const m = await create([c, d], 25, "boxing");
    expect(m.rules).toMatchObject({ fight: { rounds: 2, roundSeconds: 45, restSeconds: 15, idleSeconds: 20 }, maxMatchMinutes: 15 });
    expect([await stars(c), await stars(d)]).toEqual([before[0]! - 25, before[1]! - 25]); // escrow before the bell
    await games.void(m.matchId, "LEFT_BEFORE_START");
    expect([await stars(c), await stars(d)]).toEqual(before);
    await settings.update("boxing", DEFAULT_GAME_SETTINGS.boxing, "restore", "test");
    await settings.update("ludo", DEFAULT_GAME_SETTINGS.ludo, "restore", "test");
  });
});
