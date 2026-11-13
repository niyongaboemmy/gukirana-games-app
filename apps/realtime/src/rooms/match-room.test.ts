/**
 * Server-authoritative match room, in process on a random port (test-only clients; the API is mocked).
 * Covers the live-match lifecycle the web client relies on: init + sync, intents and rejections, the deciding
 * state before the result, StrictMode-style re-mounts, a page reload mid-game (fresh join by id), the
 * reconnection token, resign = forfeit, draw by agreement, and signed results.
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

const settled: SignedMatchResult[] = [];
const voided: string[] = [];
vi.mock("../api-client.js", () => ({
  api: {
    createMatch: vi.fn(),
    submitResult: vi.fn(async (r: SignedMatchResult) => {
      settled.push(r);
      return { status: "settled", pot: 50, xp: {} };
    }),
    voidMatch: vi.fn(async (id: string) => {
      voided.push(id);
      return { status: "void" };
    }),
  },
}));

const { MatchRoom } = await import("./match-room.js");

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

let http: HttpServer;
let game: Server;
let url = "";
let n = 0;

async function token(uid: string) {
  return new SignJWT({ sub: uid, name: uid.slice(-1), color: "#3DA9FC", lvl: 3 })
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
function track(room: Room): Seat {
  const inbox: Seat["inbox"] = [];
  room.onMessage("*", (type, msg) => inbox.push({ type: String(type), msg: msg as Record<string, unknown> }));
  return { room, inbox, last: (t) => inbox.filter((m) => m.type === t).at(-1)?.msg };
}
async function join(roomId: string, uid: string): Promise<Seat> {
  return track(await new Client(url).joinById(roomId, { token: await token(uid), clientSeed: "abcdef0123456789" }));
}
async function create(g: "igisoro" | "ludo" | "pool", stake = 25) {
  const matchId = `m-${++n}`;
  const room = await matchMaker.createRoom("match", {
    matchId,
    game: g,
    variant: "classic",
    stake,
    players: [
      { userId: A, seat: 0, name: "A", color: "#f00", rating: 1500 },
      { userId: B, seat: g === "ludo" ? 2 : 1, name: "B", color: "#0f0", rating: 1500 },
    ],
  });
  return { roomId: room.roomId, matchId };
}

beforeAll(async () => {
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
});

describe("match room", () => {
  it("starts when both players join, answers sync, rejects bad intents", async () => {
    const { roomId } = await create("igisoro");
    const a = await join(roomId, A);
    const b = await join(roomId, B);
    await wait(200);
    expect(a.last("init")).toMatchObject({ you: A, game: "igisoro", stake: 25 });
    expect(a.last("state")).toMatchObject({ turn: A });
    b.room.send("intent", { pit: 3 });
    await wait(100);
    expect(b.last("rejected")).toEqual({ reason: "NOT_YOUR_TURN" });
    a.room.send("intent", { pit: 99 });
    await wait(100);
    expect(a.last("rejected")).toEqual({ reason: "BAD_INTENT" });
    a.inbox.length = 0;
    a.room.send("sync");
    await wait(100);
    expect(a.inbox.map((m) => m.type)).toEqual(["init", "state"]);
    await a.room.leave(true);
    await b.room.leave(true);
  });

  it("a page reload mid-game re-joins by id (room unlocked) and never forfeits", async () => {
    const { roomId } = await create("igisoro");
    const a = await join(roomId, A);
    const b = await join(roomId, B);
    await wait(150);
    a.room.send("intent", { pit: 0 });
    await wait(150);
    await a.room.leave(false); // tab closed / reloaded: not consented
    await wait(100);
    expect(b.last("presence")).toEqual({ userId: A, connected: false });
    const a2 = await join(roomId, A); // the reloaded page joins fresh
    await wait(150);
    expect(a2.last("state")).toBeDefined();
    expect(b.last("presence")).toEqual({ userId: A, connected: true });
    expect(settled).toHaveLength(0);
    await a2.room.leave(true);
    await wait(300);
    expect(settled.at(-1)?.reason).toBe("forfeit");
    expect(settled.at(-1)?.ranks).toEqual({ [A]: 2, [B]: 1 });
    await b.room.leave(true);
  });

  it("reconnects with the reconnection token after a dropped connection", async () => {
    const { roomId } = await create("ludo");
    const a = await join(roomId, A);
    const b = await join(roomId, B);
    await wait(150);
    const tokenA = a.room.reconnectionToken;
    a.room.connection.close(4010); // abnormal close (network drop); 4000 would mean "consented"
    await wait(200);
    const back = track(await new Client(url).reconnect(tokenA));
    back.room.send("sync");
    await wait(200);
    expect(back.last("state")).toMatchObject({ turn: A });
    expect(b.last("presence")).toEqual({ userId: A, connected: true });
    expect(settled).toHaveLength(0);
    await back.room.leave(true);
    await b.room.leave(true);
  });

  it("resign is a forfeit with a signed result", async () => {
    const { roomId, matchId } = await create("pool");
    const a = await join(roomId, A);
    const b = await join(roomId, B);
    await wait(150);
    b.room.send("resign");
    await wait(300);
    const r = settled.at(-1)!;
    expect(r.matchId).toBe(matchId);
    expect(r.reason).toBe("forfeit");
    expect(r.ranks).toEqual({ [A]: 1, [B]: 2 });
    expect(verifyResult(r, keyFromSeed(loadEnv().RESULT_SIGNING_SEED).publicKey)).toBe(true);
    expect(a.last("result")).toMatchObject({ reason: "forfeit" });
    await a.room.leave(true);
    await b.room.leave(true);
  });

  it("draw by agreement: offer, decline, then accept → equal ranks", async () => {
    const { roomId } = await create("igisoro");
    const a = await join(roomId, A);
    const b = await join(roomId, B);
    await wait(150);
    a.room.send("draw-offer");
    await wait(100);
    expect(b.last("draw-offer")).toEqual({ from: A });
    a.room.send("draw-reply", { accept: true }); // cannot accept your own offer
    await wait(100);
    expect(settled).toHaveLength(0);
    b.room.send("draw-reply", { accept: false });
    await wait(100);
    expect(a.last("draw-declined")).toEqual({ by: B });
    b.room.send("draw-offer");
    await wait(100);
    a.room.send("draw-reply", { accept: true });
    await wait(300);
    expect(settled.at(-1)?.ranks).toEqual({ [A]: 1, [B]: 1 });
    expect(settled.at(-1)?.reason).toBe("normal");
    await a.room.leave(true);
    await b.room.leave(true);
  });

  it("sends the deciding state before the result (Igisoro, last move)", async () => {
    const { roomId } = await create("igisoro", 0);
    const a = await join(roomId, A);
    const b = await join(roomId, B);
    await wait(150);
    // drive a full game with the bot for both sides until the server reports a result
    const { igisoroBotMove } = await import("@gukirana/igisoro");
    for (let i = 0; i < 400 && !a.last("result"); i++) {
      const st = a.last("state") as { state: Parameters<typeof igisoroBotMove>[0]; turn: string } | undefined;
      if (!st) break;
      const before = a.inbox.length;
      (st.turn === A ? a : b).room.send("intent", { pit: igisoroBotMove(st.state, 1) });
      for (let k = 0; k < 40 && a.inbox.length === before; k++) await wait(10);
    }
    await wait(300);
    const types = a.inbox.map((m) => m.type);
    expect(types).toContain("result");
    const lastState = a.inbox.filter((m) => m.type === "state").at(-1)!.msg as { turn: string | null; state: { winner: number | null; draw?: boolean } };
    expect(lastState.turn).toBeNull();
    expect(lastState.state.winner !== null || lastState.state.draw).toBe(true);
    expect(types.lastIndexOf("state")).toBeLessThan(types.indexOf("result"));
    await a.room.leave(true);
    await b.room.leave(true);
  }, 30_000);
});
