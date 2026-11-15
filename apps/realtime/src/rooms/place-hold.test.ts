/**
 * Holding your place through a reload (P2-NET-06, docs/GAME-EXIT-RULES.md "Holding your place"), over a real
 * in-process server: a table chair (Ludo hall) and a Boxing ring are kept for a signed-in player whose connection
 * ended without a deliberate leave, shown as held to others, given back to the same account only, released when the
 * hold runs out, released at once on a deliberate leave, paused Quick Match tickets, the abuse limit, and the
 * hand-over to a fight.
 */
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client, type Room } from "colyseus.js";
import { SignJWT } from "jose";
import { loadEnv } from "@gukirana/config";
import { BoxingHallEvt, BoxingHallMsg, HELD_SEAT, PLACE_HOLD, type RingState } from "@gukirana/contracts";
import { WorldRoom } from "./world-room.js";
import { boxingHallConfig } from "./boxing-hall.js";
import { setAccountSources } from "../social/accounts.js";
import { placeHoldConfig, placeHolds } from "../social/place-holds.js";
import { quickMatch } from "../matchmaking.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let http: HttpServer;
let game: Server;
let url = "";
let n = 0;

interface Person {
  room: Room;
  uid: string;
  inbox: { type: string; msg: Record<string, unknown> }[];
  of: (type: string) => Record<string, unknown>[];
  last: (type: string) => Record<string, unknown> | undefined;
}
async function token(uid: string) {
  return new SignJWT({ sub: uid, name: `P${uid.slice(-2)}`, color: "#3DA9FC", lvl: 4 })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("gukirana-api")
    .setAudience("gukirana")
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(loadEnv().JWT_SECRET));
}
const newUid = () => `00000000-0000-4000-8000-${String(900 + ++n).padStart(12, "0")}`;
/** join a hall as `uid` (signed in; `uid` null = guest); `roomId` rejoins that instance like the web does */
async function enter(hall: string, uid: string | null, roomId?: string): Promise<Person> {
  const opts = { ...(uid ? { token: await token(uid) } : { name: "Guest" }), game: hall };
  const client = new Client(url);
  const room = roomId ? await client.joinById(roomId, opts) : await client.joinOrCreate("hall", opts);
  const inbox: Person["inbox"] = [];
  room.onMessage("*", (type, msg) => inbox.push({ type: String(type), msg: msg as Record<string, unknown> }));
  const of = (t: string) => inbox.filter((m) => m.type === t).map((m) => m.msg);
  return { room, uid: uid ?? "", inbox, of, last: (t) => of(t).at(-1) };
}
/** a reload / closed tab / network loss: the socket ends without a deliberate leave */
const drop = (p: Person) => p.room.leave(false);

beforeAll(async () => {
  setAccountSources({ eligibility: async () => ({ ok: true }) });
  http = createServer();
  game = new Server({ transport: new WebSocketTransport({ server: http }) });
  game.define("hall", WorldRoom).filterBy(["game"]);
  await game.listen(0);
  url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}`;
}, 20_000);
afterAll(async () => {
  await game.gracefullyShutdown(false).catch(() => undefined);
}, 20_000);
beforeEach(() => {
  placeHolds.reset();
  Object.assign(placeHoldConfig, { enabled: true, seatMs: 60_000, ringWaitingMs: 60_000, ringPracticeMs: 30_000, maxHolds: PLACE_HOLD.maxHolds, windowMs: 15 * 60_000 });
  boxingHallConfig.checkReach = false;
});

describe("table chair (Ludo hall)", () => {
  it("held on a reload, shown as held, refused to others, given back to the same account", async () => {
    const a = await enter("ludo", newUid());
    const b = await enter("ludo", newUid());
    a.room.send("sit", { seat: "t0s0" });
    await wait(150);
    expect(b.last("seats")).toEqual({ t0s0: a.room.sessionId });
    const roomId = a.room.roomId;
    await drop(a);
    await wait(200);
    // others: the chair is held (not free), with the time left
    expect(b.last("seats")).toEqual({ t0s0: HELD_SEAT });
    const ms = b.last("seat-holds")!.t0s0 as number;
    expect(ms).toBeGreaterThan(55_000);
    expect(ms).toBeLessThanOrEqual(60_000);
    // nobody else may take it
    b.room.send("sit", { seat: "t0s0" });
    await wait(150);
    expect(b.of("seat-taken").length).toBe(1);
    // another account joining is not given it
    const c = await enter("ludo", newUid());
    await wait(150);
    expect(c.last("place")).toEqual({ status: "none" });
    // the same account comes back: the same chair, same state
    const a2 = await enter("ludo", a.uid, roomId);
    await wait(200);
    expect(a2.last("place")).toMatchObject({ status: "restored", hall: "ludo", kind: "seat", place: "t0s0", state: "seated", roomId });
    expect(b.last("seats")).toEqual({ t0s0: a2.room.sessionId });
    expect(b.last("seat-holds")).toEqual({});
    for (const p of [a2, b, c]) await p.room.leave();
  });

  it("the room stays alive while it holds a place, even with nobody inside", async () => {
    const a = await enter("ludo", newUid());
    a.room.send("sit", { seat: "t1s0" });
    await wait(150);
    const roomId = a.room.roomId;
    await drop(a);
    await wait(1600); // longer than Colyseus' 1 s auto-dispose
    const a2 = await enter("ludo", a.uid);
    await wait(200);
    expect(a2.room.roomId).toBe(roomId);
    expect(a2.last("place")).toMatchObject({ status: "restored", place: "t1s0" });
    await a2.room.leave();
  });

  it("the hold runs out: the chair is free for others, the returning player hears it was released", async () => {
    placeHoldConfig.seatMs = 300;
    const a = await enter("ludo", newUid());
    const b = await enter("ludo", newUid());
    a.room.send("sit", { seat: "t2s1" });
    await wait(150);
    const roomId = a.room.roomId;
    await drop(a);
    await wait(150);
    expect(b.last("seats")).toEqual({ t2s1: HELD_SEAT });
    await wait(400);
    expect(b.last("seats")).toEqual({});
    b.room.send("sit", { seat: "t2s1" });
    await wait(150);
    expect(b.last("seats")).toEqual({ t2s1: b.room.sessionId });
    const a2 = await enter("ludo", a.uid, roomId);
    await wait(150);
    expect(a2.last("place")).toEqual({ status: "released", hall: "ludo", kind: "seat", place: "t2s1", reason: "EXPIRED", heldS: 0 });
    for (const p of [a2, b]) await p.room.leave();
  });

  it("a deliberate leave (Leave / door) and standing up release at once", async () => {
    const a = await enter("ludo", newUid());
    const b = await enter("ludo", newUid());
    a.room.send("sit", { seat: "t3s0" });
    await wait(100);
    a.room.send("stand");
    await wait(100);
    expect(b.last("seats")).toEqual({});
    a.room.send("sit", { seat: "t3s0" });
    await wait(100);
    const roomId = a.room.roomId;
    await a.room.leave(true);
    await wait(150);
    expect(b.last("seats")).toEqual({});
    const a2 = await enter("ludo", a.uid, roomId);
    await wait(150);
    expect(a2.last("place")).toEqual({ status: "none" });
    for (const p of [a2, b]) await p.room.leave();
  });

  it("guests are never held", async () => {
    const g = await enter("ludo", null);
    const b = await enter("ludo", newUid());
    g.room.send("sit", { seat: "t4s0" });
    await wait(100);
    await drop(g);
    await wait(150);
    expect(b.last("seats")).toEqual({});
    await b.room.leave();
  });

  it("waiting for an opponent: the Quick Match ticket is paused (nothing can start), then resumed with its waiting time", async () => {
    const a = await enter("ludo", newUid());
    a.room.send("sit", { seat: "t5s0" });
    a.room.send("quickmatch-join", { game: "ludo", stake: 0 });
    await wait(200);
    expect(quickMatch.size("ludo", 0)).toBe(1);
    const roomId = a.room.roomId;
    await drop(a);
    await wait(150);
    expect(quickMatch.size("ludo", 0)).toBe(0); // paused: no match (no escrow) can be made for an absent player
    await wait(300);
    const a2 = await enter("ludo", a.uid, roomId);
    await wait(250);
    expect(a2.last("place")).toMatchObject({ status: "restored", state: "waiting", game: "ludo", stake: 0 });
    const q = a2.last("quickmatch")!;
    expect(q).toMatchObject({ status: "waiting", game: "ludo", stake: 0 });
    expect(q.waitedMs as number).toBeGreaterThanOrEqual(400);
    expect(quickMatch.size("ludo", 0)).toBe(1);
    a2.room.send("quickmatch-leave");
    await wait(100);
    await a2.room.leave();
  });

  it("a challenge to or from the absent player closes for the other side", async () => {
    const a = await enter("ludo", newUid());
    const b = await enter("ludo", newUid());
    await wait(100);
    a.room.send("propose", { to: b.room.sessionId, game: "ludo", stake: 0 });
    await wait(200);
    const id = b.last("proposal")!.id;
    await drop(a);
    await wait(150);
    expect(b.last("proposal-closed")).toEqual({ id, reason: "PLAYER_LEFT" });
    await b.room.leave();
  });

  it("abuse limit: after maxHolds drops in the window the place is released at once", async () => {
    placeHoldConfig.maxHolds = 2;
    const uid = newUid();
    const b = await enter("ludo", newUid());
    let a = await enter("ludo", uid);
    const roomId = a.room.roomId;
    for (let i = 0; i < 2; i++) {
      a.room.send("sit", { seat: "t6s0" });
      await wait(100);
      await drop(a);
      await wait(100);
      expect(b.last("seats")).toEqual({ t6s0: HELD_SEAT });
      a = await enter("ludo", uid, roomId);
      await wait(150);
      expect(a.last("place")).toMatchObject({ status: "restored" });
    }
    await drop(a);
    await wait(150);
    expect(b.last("seats")).toEqual({});
    a = await enter("ludo", uid, roomId);
    await wait(150);
    expect(a.last("place")).toEqual({ status: "released", hall: "ludo", kind: "seat", place: "t6s0", reason: "LIMIT", heldS: 0 });
    for (const p of [a, b]) await p.room.leave();
  });

  it("FF_PLACE_HOLD off: every leave releases at once", async () => {
    placeHoldConfig.enabled = false;
    const a = await enter("ludo", newUid());
    const b = await enter("ludo", newUid());
    a.room.send("sit", { seat: "t7s0" });
    await wait(100);
    await drop(a);
    await wait(150);
    expect(b.last("seats")).toEqual({});
    await b.room.leave();
  });
});

describe("Boxing ring", () => {
  const ringOf = (p: Person, id: string) => [...p.of(BoxingHallEvt.ring), ...((p.of(BoxingHallEvt.rings) as unknown as RingState[][]).flat() as unknown as Record<string, unknown>[])].filter((r) => r.id === id).at(-1) as unknown as RingState | undefined;
  const lastRing = (p: Person, id: string) => p.of(BoxingHallEvt.ring).filter((r) => r.id === id).at(-1) as unknown as RingState | undefined;

  it("a waiting ring is held on a reload, nobody may join it, the same account gets it back still waiting", async () => {
    const a = await enter("boxing", newUid());
    const b = await enter("boxing", newUid());
    a.room.send(BoxingHallMsg.claim, { ring: "R5", stake: 0 });
    await wait(200);
    expect(lastRing(b, "R5")).toMatchObject({ status: "waiting", red: { sid: a.room.sessionId } });
    const roomId = a.room.roomId;
    await drop(a);
    await wait(150);
    const held = lastRing(b, "R5")!;
    expect(held.status).toBe("waiting");
    expect(held.held!.ms).toBeGreaterThan(55_000);
    b.room.send(BoxingHallMsg.join, { ring: "R5" });
    await wait(150);
    expect(b.last(BoxingHallEvt.denied)).toMatchObject({ action: "join", reason: "RING_HELD" });
    // a newcomer sees it held in the full list
    const c = await enter("boxing", newUid());
    await wait(150);
    expect(ringOf(c, "R5")?.held).toBeDefined();
    const a2 = await enter("boxing", a.uid, roomId);
    await wait(200);
    expect(a2.last("place")).toMatchObject({ status: "restored", hall: "boxing", kind: "ring", place: "R5", state: "waiting", stake: 0 });
    expect(a2.last(BoxingHallEvt.assigned)).toEqual({ ring: "R5", corner: "red" });
    const back = lastRing(b, "R5")!;
    expect(back.held).toBeUndefined();
    expect(back.red?.sid).toBe(a2.room.sessionId);
    for (const p of [a2, b, c]) await p.room.leave();
  });

  it("a held ring frees when the hold runs out; practice holds are shorter and come back as practice", async () => {
    placeHoldConfig.ringWaitingMs = 300;
    placeHoldConfig.ringPracticeMs = 200;
    const a = await enter("boxing", newUid());
    const b = await enter("boxing", newUid());
    a.room.send(BoxingHallMsg.claim, { ring: "R6", stake: 0 });
    await wait(200);
    const roomId = a.room.roomId;
    await drop(a);
    await wait(500);
    expect(lastRing(b, "R6")).toMatchObject({ status: "free" });
    const a2 = await enter("boxing", a.uid, roomId);
    await wait(150);
    expect(a2.last("place")).toEqual({ status: "released", hall: "boxing", kind: "ring", place: "R6", reason: "EXPIRED", heldS: 0 });
    // practice: held, then given back as practice (the client starts a fresh practice fight at the same level)
    a2.room.send(BoxingHallMsg.practice, { ring: "R7" });
    await wait(150);
    await drop(a2);
    await wait(80);
    expect(lastRing(b, "R7")).toMatchObject({ status: "practice" });
    expect(lastRing(b, "R7")!.held).toBeDefined();
    const a3 = await enter("boxing", a.uid, roomId);
    await wait(150);
    expect(a3.last("place")).toMatchObject({ status: "restored", place: "R7", state: "practice" });
    a3.room.send(BoxingHallMsg.practice, { ring: "R7" }); // the restarted practice: accepted, same ring
    await wait(150);
    expect(a3.of(BoxingHallEvt.denied)).toEqual([]);
    a3.room.send(BoxingHallMsg.leave, {});
    await wait(150);
    expect(lastRing(b, "R7")).toMatchObject({ status: "free" });
    for (const p of [a3, b]) await p.room.leave();
  });

  it("hand-over: back in the held ring, an opponent can join and the fight starts as usual", async () => {
    const a = await enter("boxing", newUid());
    a.room.send(BoxingHallMsg.claim, { ring: "R8", stake: 0 });
    await wait(200);
    const roomId = a.room.roomId;
    await drop(a);
    await wait(100);
    const a2 = await enter("boxing", a.uid, roomId);
    const b = await enter("boxing", newUid(), roomId);
    await wait(200);
    b.room.send(BoxingHallMsg.join, { ring: "R8" });
    await wait(300);
    // the hall moves to "starting" (the fight room / escrow are the API's; not available in this test → refused,
    // and the challenger keeps waiting in their ring)
    const seen = b.of(BoxingHallEvt.ring).filter((r) => r.id === "R8").map((r) => r.status);
    expect(seen).toContain("starting");
    for (const p of [a2, b]) await p.room.leave();
  });
});
