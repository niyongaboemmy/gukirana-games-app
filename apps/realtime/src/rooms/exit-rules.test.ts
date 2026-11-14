/**
 * Every way a live match can end (P1-GAME-06, docs/GAME-EXIT-RULES.md), over a real in-process server with short
 * rules (the per-match snapshot the API sends): leave before / after the first move, opponent never joins, disconnect
 * past the reconnect window, both players gone, repeated timeouts (with and without a first move), the maximum match
 * length, settlement failure (void instead, or left to the sweep), and the heartbeat ending a match the API voided.
 */
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { matchMaker, Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client, type Room } from "colyseus.js";
import { SignJWT } from "jose";
import { loadEnv } from "@gukirana/config";
import type { SignedMatchResult } from "@gukirana/signing";
import type { MatchRules } from "@gukirana/contracts";

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

const { MatchRoom, matchConfig, heartbeatOnce } = await import("./match-room.js");

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b1";
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
interface Seat {
  room: Room;
  inbox: { type: string; msg: Record<string, unknown> }[];
  last: (type: string) => Record<string, unknown> | undefined;
}
async function join(roomId: string, uid: string): Promise<Seat> {
  const room = await new Client(url).joinById(roomId, { token: await token(uid), clientSeed: "abcdef0123456789" });
  const inbox: Seat["inbox"] = [];
  room.onMessage("*", (type, msg) => inbox.push({ type: String(type), msg: msg as Record<string, unknown> }));
  return { room, inbox, last: (t) => inbox.filter((m) => m.type === t).at(-1)?.msg };
}
/** fast rules: seconds as fractions so a whole scenario runs in about a second */
async function create(rules: Partial<MatchRules> = {}, stake = 25) {
  const matchId = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const room = await matchMaker.createRoom("match", {
    matchId,
    game: "igisoro",
    variant: "classic",
    stake,
    rules: { settingsVersion: 7, turnSeconds: 5, reconnectSeconds: 5, joinSeconds: 5, maxTimeouts: 3, maxMatchMinutes: 10, ...rules },
    players: [
      { userId: A, seat: 0, name: "A", color: "#f00", rating: 1500 },
      { userId: B, seat: 1, name: "B", color: "#0f0", rating: 1500 },
    ],
  });
  return { roomId: room.roomId, matchId };
}
const both = async (roomId: string) => {
  const a = await join(roomId, A);
  const b = await join(roomId, B);
  await wait(150);
  return { a, b };
};

beforeAll(async () => {
  Object.assign(matchConfig, { retryMs: 20, lingerMs: 5_000 });
  http = createServer();
  game = new Server({ transport: new WebSocketTransport({ server: http }) });
  game.define("match", MatchRoom);
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
});

describe("leaving voluntarily (Leave in the menu)", () => {
  it("before the first move: the match is voided and refunded, nobody wins", async () => {
    const { roomId, matchId } = await create();
    const { a, b } = await both(roomId);
    expect(a.last("init")).toMatchObject({ rules: { turnSeconds: 5, reconnectSeconds: 5, settingsVersion: 7 }, started: false });
    a.room.send("resign");
    await wait(200);
    expect(settled).toHaveLength(0);
    expect(voided).toEqual([{ id: matchId, cause: "LEFT_BEFORE_START" }]);
    expect(b.last("result")).toMatchObject({ reason: "void", cause: "LEFT_BEFORE_START", ranks: { [A]: 1, [B]: 1 } });
    await b.room.leave(true);
  });

  it("after the first move: a forfeit — the opponent wins, the result names the leaver", async () => {
    const { roomId } = await create();
    const { a, b } = await both(roomId);
    a.room.send("intent", { pit: 0 });
    await wait(150);
    await a.room.leave(true); // closing the match with Leave = consented leave
    await wait(250);
    expect(settled.at(-1)).toMatchObject({ reason: "forfeit", ranks: { [A]: 2, [B]: 1 } });
    expect(b.last("result")).toMatchObject({ reason: "forfeit", cause: "RESIGN", loser: A });
    await b.room.leave(true);
  });
});

describe("the opponent never joins", () => {
  it("void + refund after joinSeconds", async () => {
    const { roomId, matchId } = await create({ joinSeconds: 0.3 });
    const a = await join(roomId, A);
    await wait(500);
    expect(voided).toEqual([{ id: matchId, cause: "NO_SHOW" }]);
    expect(a.last("result")).toMatchObject({ reason: "void", cause: "NO_SHOW" });
    await a.room.leave(true).catch(() => undefined);
  });
});

describe("disconnects", () => {
  it("not back within reconnectSeconds: forfeit, the connected opponent wins", async () => {
    const { roomId } = await create({ reconnectSeconds: 0.4 });
    const { a, b } = await both(roomId);
    a.room.send("intent", { pit: 0 });
    await wait(150);
    a.room.connection.close(4010); // network drop, not a Leave
    await wait(250);
    expect(settled).toHaveLength(0); // still inside the window
    expect(b.last("presence")).toEqual({ userId: A, connected: false });
    await wait(500);
    expect(settled.at(-1)).toMatchObject({ reason: "forfeit", ranks: { [A]: 2, [B]: 1 } });
    expect(b.last("result")).toMatchObject({ reason: "forfeit", cause: "DISCONNECT", loser: A });
    await b.room.leave(true);
  });

  it("both players gone: void + full refund (nobody at the table to win)", async () => {
    const { roomId, matchId } = await create({ reconnectSeconds: 0.4 });
    const { a, b } = await both(roomId);
    a.room.send("intent", { pit: 0 });
    await wait(150);
    a.room.connection.close(4010);
    b.room.connection.close(4010);
    await wait(800);
    expect(settled).toHaveLength(0);
    expect(voided).toEqual([{ id: matchId, cause: "BOTH_DISCONNECTED" }]);
  });

  it("disconnected before the first move and not back: void", async () => {
    const { roomId, matchId } = await create({ reconnectSeconds: 0.3 });
    const { a, b } = await both(roomId);
    a.room.connection.close(4010);
    await wait(600);
    expect(voided).toEqual([{ id: matchId, cause: "LEFT_BEFORE_START" }]);
    expect(b.last("result")).toMatchObject({ reason: "void" });
    await b.room.leave(true);
  });
});

describe("turn timeouts", () => {
  it("maxTimeouts in a row after the first move: forfeit by the player who kept timing out", async () => {
    const { roomId } = await create({ turnSeconds: 0.25, maxTimeouts: 2 });
    const { a, b } = await both(roomId);
    a.room.send("intent", { pit: 0 });
    // B never plays; A answers every turn it gets (so only B collects timeouts)
    for (let i = 0; i < 12 && !b.last("result"); i++) {
      await wait(120);
      const st = a.last("state") as { turn?: string; state?: { pits?: number[][] } } | undefined;
      if (st?.turn === A) {
        const pits = st.state?.pits?.[0] ?? [];
        const pit = pits.findIndex((s) => s > 1);
        if (pit >= 0) a.room.send("intent", { pit });
      }
    }
    await wait(200);
    expect(b.inbox.filter((m) => m.type === "timeout").map((m) => m.msg)).toContainEqual({ userId: B, strikes: 1, max: 2 });
    expect(settled.at(-1)).toMatchObject({ reason: "forfeit", ranks: { [A]: 1, [B]: 2 } });
    expect(a.last("result")).toMatchObject({ cause: "TIMEOUTS", loser: B });
    await a.room.leave(true);
    await b.room.leave(true);
  });

  it("nobody ever moves (inactivity before the first move): void, not a forfeit", async () => {
    const { roomId, matchId } = await create({ turnSeconds: 0.2, maxTimeouts: 2 });
    const { a, b } = await both(roomId);
    await wait(900);
    expect(settled).toHaveLength(0);
    expect(voided).toEqual([{ id: matchId, cause: "NO_FIRST_MOVE" }]);
    expect(a.last("result")).toMatchObject({ reason: "void", cause: "NO_FIRST_MOVE" });
    await a.room.leave(true);
    await b.room.leave(true);
  });
});

describe("safety nets (never a stuck escrow)", () => {
  it("past maxMatchMinutes: void + refund", async () => {
    const { roomId, matchId } = await create({ maxMatchMinutes: 0.01 }); // 0.6 s
    const { a, b } = await both(roomId);
    a.room.send("intent", { pit: 0 });
    await wait(800);
    expect(voided).toEqual([{ id: matchId, cause: "MATCH_TOO_LONG" }]);
    expect(b.last("result")).toMatchObject({ reason: "void", cause: "MATCH_TOO_LONG" });
    await a.room.leave(true);
    await b.room.leave(true);
  });

  it("settlement keeps failing: retried, then voided (refund) and the players are told", async () => {
    fail.settle = 99;
    const { roomId, matchId } = await create();
    const { a, b } = await both(roomId);
    a.room.send("intent", { pit: 0 });
    await wait(150);
    b.room.send("resign");
    await wait(400);
    expect(settled).toHaveLength(0);
    expect(voided).toEqual([{ id: matchId, cause: "SERVER_ERROR" }]);
    expect(a.last("result")).toMatchObject({ reason: "void", cause: "SERVER_ERROR" });
    await a.room.leave(true);
    await b.room.leave(true);
  });

  it("a transient settlement error is retried and the match settles normally", async () => {
    fail.settle = 1;
    const { roomId } = await create();
    const { a, b } = await both(roomId);
    a.room.send("intent", { pit: 0 });
    await wait(150);
    b.room.send("resign");
    await wait(300);
    expect(settled).toHaveLength(1);
    expect(voided).toHaveLength(0);
    expect(a.last("result")).toMatchObject({ reason: "forfeit" });
    await a.room.leave(true);
    await b.room.leave(true);
  });

  it("API unreachable for the void too: the result says pending (the API's sweep refunds it)", async () => {
    fail.settle = 99;
    fail.void = 99;
    const { roomId } = await create();
    const { a, b } = await both(roomId);
    a.room.send("intent", { pit: 0 });
    await wait(150);
    b.room.send("resign");
    await wait(500);
    expect(a.last("result")).toMatchObject({ reason: "void", cause: "SERVER_ERROR", pending: true, settlement: null });
    await a.room.leave(true);
    await b.room.leave(true);
  });

  it("heartbeat: live matches are reported; one the API already voided ends here without paying anyone", async () => {
    const { roomId, matchId } = await create();
    const { a, b } = await both(roomId);
    a.room.send("intent", { pit: 0 });
    await wait(100);
    await heartbeatOnce();
    expect(beats.at(-1)).toContain(matchId);
    fail.inactive = [matchId];
    await heartbeatOnce();
    await wait(150);
    expect(b.last("result")).toMatchObject({ reason: "void", cause: "STALE_ESCROW" });
    expect(settled).toHaveLength(0);
    expect(voided).toHaveLength(0); // the API voided it already; no second call
    b.room.send("resign");
    await wait(150);
    expect(settled).toHaveLength(0);
    const before = beats.length;
    await heartbeatOnce();
    expect(beats.slice(before).flat()).not.toContain(matchId); // no longer reported
    await a.room.leave(true);
    await b.room.leave(true);
  });
});
