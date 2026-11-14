/**
 * The authoritative Boxing fight room (P3-FGT-01) over a real in-process server with a fake games API, short rules
 * and every exit-rules row of docs/GAME-EXIT-RULES.md "Boxing": a fight to the final bell (signed normal result),
 * Leave before / after the first move, no-show, disconnect = referee time-out (back → resume; budget used → forfeit;
 * before the first move → void; both gone → void), a silent connection, IDLE strikes (forfeit; nobody acting → void),
 * the match length limit, settlement retries → void, the heartbeat, a suspension, and input validation (bad input,
 * stale seq, presses outside a round, the rate limit, one press per tick).
 */
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { matchMaker, Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client, type Room } from "colyseus.js";
import { SignJWT } from "jose";
import { loadEnv } from "@gukirana/config";
import { keyFromSeed, verifyResult, type SignedMatchResult } from "@gukirana/signing";
import type { FightRules, MatchRules } from "@gukirana/contracts";

const settled: SignedMatchResult[] = [];
const voided: { id: string; cause?: string }[] = [];
const beats: string[][] = [];
const fail = { settle: 0, void: 0, inactive: [] as string[] };
vi.mock("../api-client.js", () => {
  class ApiError extends Error {}
  return {
    ApiError,
    api: {
      createMatch: vi.fn(),
      submitResult: vi.fn(async (r: SignedMatchResult) => {
        if (fail.settle-- > 0) throw new ApiError("API_503");
        settled.push(r);
        return { status: "settled", pot: 50, xp: {} };
      }),
      voidMatch: vi.fn(async (id: string, cause?: string) => {
        if (fail.void-- > 0) throw new Error("fetch failed");
        voided.push({ id, cause });
        return { status: "void" };
      }),
      heartbeat: vi.fn(async (ids: string[]) => {
        beats.push(ids);
        return { inactive: ids.filter((i) => fail.inactive.includes(i)) };
      }),
    },
  };
});

const { BoxingRoom, boxingConfig } = await import("./boxing-room.js");
const { matchConfig, heartbeatOnce } = await import("./match-room.js");
const { closeAccount } = await import("../social/accounts.js");

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const A = "00000000-0000-4000-8000-0000000000c1";
const B = "00000000-0000-4000-8000-0000000000d1";
let http: HttpServer;
let game: Server;
let url = "";
let n = 0;

async function token(uid: string) {
  return new SignJWT({ sub: uid, name: uid.slice(-2), color: "#3DA9FC", lvl: 3 })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("gukirana-api")
    .setAudience("gukirana")
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(loadEnv().JWT_SECRET));
}
interface Fighter {
  room: Room;
  inbox: { type: string; msg: unknown }[];
  last: (type: string) => Record<string, unknown> | undefined;
  all: (type: string) => unknown[];
  /** one input (seq increases by itself) */
  send: (a?: string, g?: boolean) => void;
  /** keep the connection "alive" (pings) and optionally act every interval */
  every: (ms: number, f: () => void) => () => void;
}
async function join(roomId: string, uid: string): Promise<Fighter> {
  const room = await new Client(url).joinById(roomId, { token: await token(uid) });
  const inbox: Fighter["inbox"] = [];
  room.onMessage("*", (type, msg) => inbox.push({ type: String(type), msg }));
  let seq = 0;
  const timers: ReturnType<typeof setInterval>[] = [];
  return {
    room,
    inbox,
    last: (t) => inbox.filter((m) => m.type === t).at(-1)?.msg as Record<string, unknown> | undefined,
    all: (t) => inbox.filter((m) => m.type === t).map((m) => m.msg),
    send: (a, g = true) => room.send("in", { seq: ++seq, g, ...(a ? { a } : {}) }),
    every: (ms, f) => {
      const t = setInterval(f, ms);
      timers.push(t);
      return () => clearInterval(t);
    },
  };
}
async function until(pred: () => boolean, ms = 8_000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await wait(25);
  }
}
const FAST: FightRules = { rounds: 1, roundSeconds: 1.5, restSeconds: 0.5, idleSeconds: 5 };
async function create(rules: Partial<MatchRules> = {}, fight: Partial<FightRules> = {}, stake = 25) {
  const matchId = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const room = await matchMaker.createRoom("boxing", {
    matchId,
    stake,
    ring: "R7",
    rules: { settingsVersion: 3, turnSeconds: 30, reconnectSeconds: 5, joinSeconds: 5, maxTimeouts: 3, maxMatchMinutes: 10, fight: { ...FAST, ...fight }, ...rules },
    players: [
      { userId: A, seat: 0, name: "A", color: "#f00", rating: 1500 },
      { userId: B, seat: 1, name: "B", color: "#0f0", rating: 1500 },
    ],
  });
  return { roomId: room.roomId, matchId };
}
const phase = (f: Fighter) => (f.last("snap") as { phase?: string } | undefined)?.phase;
/** both join + ready; resolves at the opening bell */
async function bell(roomId: string) {
  const a = await join(roomId, A);
  const b = await join(roomId, B);
  a.room.send("ready");
  b.room.send("ready");
  await until(() => phase(a) === "round");
  return { a, b };
}
const ping = (f: Fighter) => f.room.send("ping", { t: Date.now() });
const result = (f: Fighter) => f.last("result");

beforeAll(async () => {
  Object.assign(matchConfig, { retryMs: 20, lingerMs: 3_000 });
  Object.assign(boxingConfig, { introMs: 50, staleMs: 60_000 });
  http = createServer();
  game = new Server({ transport: new WebSocketTransport({ server: http }) });
  game.define("boxing", BoxingRoom);
  await game.listen(0);
  url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}`;
}, 20_000);
afterAll(async () => {
  await game.gracefullyShutdown(false).catch(() => undefined);
}, 20_000);
beforeEach(() => {
  settled.length = 0;
  voided.length = 0;
  beats.length = 0;
  Object.assign(fail, { settle: 0, void: 0, inactive: [] });
  boxingConfig.staleMs = 60_000;
});

describe("rows 1-2: the fight runs to the final bell", () => {
  it("escrowed match → bell → round → signed normal result (points decide, draw = equal ranks)", async () => {
    const { roomId, matchId } = await create();
    const { a, b } = await bell(roomId);
    expect(a.last("init")).toMatchObject({ corner: "red", ring: "R7", stake: 25, fight: { rounds: 1 }, begun: false });
    expect(a.all("ev").flat()).toContainEqual(expect.objectContaining({ k: "bell", round: 1 }));
    // A walks in and throws; B stands there with the guard down
    const stop = a.every(60, () => a.send(["stepIn", "jab", "cross", "jab"][Math.floor(Date.now() / 60) % 4], true));
    const stopB = b.every(100, () => b.send(undefined, false));
    await until(() => !!result(a), 10_000);
    stop();
    stopB();
    const r = result(a)!;
    expect(r).toMatchObject({ reason: "normal", outcome: { decision: expect.stringMatching(/points|stoppage|draw/) } });
    const s = settled.at(-1)!;
    expect(s).toMatchObject({ matchId, game: "boxing", reason: "normal" });
    expect(verifyResult(s, keyFromSeed(loadEnv().RESULT_SIGNING_SEED).publicKey)).toBe(true);
    const o = r.outcome as { winner: 0 | 1 | null; points: [number, number] };
    if (o.winner === null) expect(s.ranks).toEqual({ [A]: 1, [B]: 1 });
    else expect(s.ranks[[A, B][o.winner]!]).toBe(1);
    expect(o.points[0]).toBeGreaterThanOrEqual(o.points[1]);
    await a.room.leave(true);
    await b.room.leave(true);
  }, 20_000);
});

describe("rows 3-4: Leave", () => {
  it("before the first move (gloving up / countdown): void, refund", async () => {
    const { roomId, matchId } = await create();
    const a = await join(roomId, A);
    const b = await join(roomId, B);
    await wait(150);
    a.room.send("resign");
    await until(() => !!result(b));
    expect(voided).toEqual([{ id: matchId, cause: "LEFT_BEFORE_START" }]);
    expect(result(b)).toMatchObject({ reason: "void", cause: "LEFT_BEFORE_START", ranks: { [A]: 1, [B]: 1 } });
    await b.room.leave(true);
  });

  it("after the first move: forfeit, the opponent wins", async () => {
    const { roomId } = await create({}, { roundSeconds: 30 });
    const { a, b } = await bell(roomId);
    a.send(undefined, true);
    await wait(100);
    await a.room.leave(true); // closing with Leave = consented
    await until(() => !!result(b));
    expect(settled.at(-1)).toMatchObject({ reason: "forfeit", ranks: { [A]: 2, [B]: 1 } });
    expect(result(b)).toMatchObject({ reason: "forfeit", cause: "RESIGN", loser: A, outcome: { decision: "forfeit", winner: 1 } });
    await b.room.leave(true);
  }, 15_000);
});

describe("row 11: no-show", () => {
  it("void after joinSeconds", async () => {
    const { roomId, matchId } = await create({ joinSeconds: 0.3 });
    const a = await join(roomId, A);
    await until(() => !!result(a));
    expect(voided).toEqual([{ id: matchId, cause: "NO_SHOW" }]);
    await a.room.leave(true).catch(() => undefined);
  });
});

describe("rows 5-8: disconnect = referee time-out", () => {
  it("back within the budget: the clock stopped for both, then a 3 s countdown resumes the round", async () => {
    const { roomId } = await create({ reconnectSeconds: 5 }, { roundSeconds: 30 });
    const { a, b } = await bell(roomId);
    a.send("jab");
    await wait(100);
    const before = (b.last("snap") as { left: number }).left;
    b.room.connection.close(4010);
    await until(() => (a.last("pause") as { connected?: boolean } | undefined)?.connected === false);
    expect(a.last("pause")).toMatchObject({ who: 1, connected: false });
    expect(phase(a)).toBe("paused");
    await wait(300);
    const b2 = await join(roomId, B); // a reload: fresh join by id
    await until(() => (a.last("pause") as { connected?: boolean }).connected === true);
    expect(phase(a)).toBe("countdown");
    await until(() => phase(a) === "round", 5_000);
    expect((a.last("snap") as { left: number }).left).toBeGreaterThan(before - 30); // resumed where it stopped
    expect(result(a)).toBeUndefined();
    a.room.send("resign");
    await until(() => !!result(b2));
    await a.room.leave(true);
    await b2.room.leave(true);
  }, 20_000);

  it("budget used after the first move: forfeit; before it: void; both gone: void", async () => {
    // forfeit
    let m = await create({ reconnectSeconds: 0.4 }, { roundSeconds: 30 });
    let f = await bell(m.roomId);
    f.a.send("jab");
    await wait(100);
    f.a.room.connection.close(4010);
    await until(() => !!result(f.b));
    expect(result(f.b)).toMatchObject({ reason: "forfeit", cause: "DISCONNECT", loser: A });
    expect(settled.at(-1)).toMatchObject({ reason: "forfeit", ranks: { [A]: 2, [B]: 1 } });
    await f.b.room.leave(true);
    // before the first move (nobody acted after the bell)
    m = await create({ reconnectSeconds: 0.3 }, { roundSeconds: 30 });
    f = await bell(m.roomId);
    f.a.room.connection.close(4010);
    await until(() => !!result(f.b));
    expect(voided.at(-1)).toEqual({ id: m.matchId, cause: "LEFT_BEFORE_START" });
    await f.b.room.leave(true);
    // both gone
    m = await create({ reconnectSeconds: 3 }, { roundSeconds: 30 });
    f = await bell(m.roomId);
    f.a.send("jab");
    await wait(100);
    f.a.room.connection.close(4010);
    f.b.room.connection.close(4010);
    await until(() => voided.some((v) => v.id === m.matchId));
    expect(voided.at(-1)).toEqual({ id: m.matchId, cause: "BOTH_DISCONNECTED" });
    expect(settled.filter((s) => s.matchId === m.matchId)).toHaveLength(0);
  }, 30_000);

  it("a connection that goes silent is a time-out too (no input, no ping)", async () => {
    const { roomId } = await create({ reconnectSeconds: 5 }, { roundSeconds: 30 });
    const { a, b } = await bell(roomId);
    boxingConfig.staleMs = 400;
    a.send("jab");
    const stop = a.every(100, () => ping(a)); // A pings, B is silent
    await until(() => (a.last("pause") as { who?: number } | undefined)?.who === 1);
    ping(b); // B speaks again → back
    await until(() => (a.last("pause") as { connected?: boolean }).connected === true);
    stop();
    boxingConfig.staleMs = 60_000;
    a.room.send("resign");
    await until(() => !!result(b));
    await a.room.leave(true);
    await b.room.leave(true);
  }, 15_000);
});

describe("rows 9-10: inactivity (IDLE strikes)", () => {
  it("maxTimeouts strikes in a row after the first move: forfeit by the idle fighter", async () => {
    const { roomId } = await create({ maxTimeouts: 2 }, { roundSeconds: 30, idleSeconds: 0.4 });
    const { a, b } = await bell(roomId);
    const stop = a.every(80, () => a.send(undefined, true)); // A keeps sending, B never does
    await until(() => !!result(a), 8_000);
    stop();
    expect(a.all("timeout")).toContainEqual({ userId: B, strikes: 1, max: 2 });
    expect(result(a)).toMatchObject({ reason: "forfeit", cause: "TIMEOUTS", loser: B });
    expect(settled.at(-1)).toMatchObject({ ranks: { [A]: 1, [B]: 2 } });
    await a.room.leave(true);
    await b.room.leave(true);
  }, 15_000);

  it("nobody acts after the bell: void NO_FIRST_MOVE", async () => {
    const { roomId, matchId } = await create({}, { roundSeconds: 30, idleSeconds: 0.3 });
    const { a, b } = await bell(roomId);
    await until(() => !!result(a));
    expect(voided).toEqual([{ id: matchId, cause: "NO_FIRST_MOVE" }]);
    await a.room.leave(true);
    await b.room.leave(true);
  }, 15_000);
});

describe("rows 12-17: safety nets", () => {
  it("past maxMatchMinutes: void", async () => {
    const { roomId, matchId } = await create({ maxMatchMinutes: 0.01 }, { roundSeconds: 30 });
    const a = await join(roomId, A);
    const b = await join(roomId, B);
    await until(() => !!result(a));
    expect(voided).toEqual([{ id: matchId, cause: "MATCH_TOO_LONG" }]);
    await a.room.leave(true);
    await b.room.leave(true);
  });

  it("settlement keeps failing: voided (SERVER_ERROR); API down for the void too: pending (the sweep refunds)", async () => {
    fail.settle = 99;
    let m = await create({}, { roundSeconds: 30 });
    let f = await bell(m.roomId);
    f.a.send("jab");
    await wait(80);
    f.b.room.send("resign");
    await until(() => !!result(f.a));
    expect(voided).toEqual([{ id: m.matchId, cause: "SERVER_ERROR" }]);
    expect(result(f.a)).toMatchObject({ reason: "void", cause: "SERVER_ERROR" });
    await f.a.room.leave(true);
    await f.b.room.leave(true);
    fail.settle = 99;
    fail.void = 99;
    m = await create({}, { roundSeconds: 30 });
    f = await bell(m.roomId);
    f.a.send("jab");
    await wait(80);
    f.b.room.send("resign");
    await until(() => !!result(f.a));
    expect(result(f.a)).toMatchObject({ reason: "void", pending: true, settlement: null });
    await f.a.room.leave(true);
    await f.b.room.leave(true);
  }, 20_000);

  it("heartbeat reports the fight; one the API voided ends here without another call; suspension voids", async () => {
    let m = await create();
    let a = await join(m.roomId, A);
    let b = await join(m.roomId, B);
    await wait(100);
    await heartbeatOnce();
    expect(beats.at(-1)).toContain(m.matchId);
    fail.inactive = [m.matchId];
    await heartbeatOnce();
    await until(() => !!result(b));
    expect(result(b)).toMatchObject({ reason: "void", cause: "STALE_ESCROW" });
    expect(voided).toHaveLength(0);
    await a.room.leave(true);
    await b.room.leave(true);
    m = await create();
    a = await join(m.roomId, A);
    b = await join(m.roomId, B);
    await wait(100);
    closeAccount(B);
    await until(() => !!result(a));
    expect(voided.at(-1)).toEqual({ id: m.matchId, cause: "PLAYER_SUSPENDED" });
    await a.room.leave(true);
  });
});

describe("inputs (plan §3.2)", () => {
  it("bad input, stale seq, presses outside a round, the rate limit; one press per tick", async () => {
    const { roomId } = await create({}, { roundSeconds: 30 });
    const a = await join(roomId, A);
    const b = await join(roomId, B);
    a.room.send("ready");
    b.room.send("ready");
    await until(() => phase(a) === "countdown");
    const rej = () => a.all("rejected").map((r) => (r as { reason: string }).reason);
    a.room.send("in", { seq: 1, g: true, a: "headbutt" });
    a.room.send("in", { seq: 5, g: true, a: "jab" }); // countdown: NOT_FIGHTING
    a.room.send("in", { seq: 5, g: true });
    await until(() => rej().length >= 3);
    expect(rej()).toEqual(["BAD_INPUT", "NOT_FIGHTING", "STALE_SEQ"]);
    await until(() => phase(a) === "round", 5_000);
    // a burst: past MAX_INPUTS_PER_SECOND messages are dropped (told once)
    for (let i = 0; i < 40; i++) a.room.send("in", { seq: 10 + i, g: true, a: i % 2 ? "jab" : "cross" });
    await until(() => rej().includes("RATE_LIMITED"));
    expect(rej().filter((r) => r === "RATE_LIMITED")).toHaveLength(1);
    // of the burst only one press per tick reached the engine: the fighter's act is a single punch, not a pile-up
    await wait(200);
    const snap = a.last("snap") as { fighters: { act: string }[] };
    expect(["jab", "cross", "idle"]).toContain(snap.fighters[0]!.act);
    a.room.send("resign");
    await until(() => !!result(b));
    await a.room.leave(true);
    await b.room.leave(true);
  }, 15_000);
});
