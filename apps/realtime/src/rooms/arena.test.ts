/**
 * Tournament Arena hall (game "arena") over a real in-process server: entry gate (closed / barred), zones and bowl
 * seats checked on the server, removal when the arena closes or someone is barred, occupancy, rate limits.
 * Building state and passes come from stub sources (the API's /internal/arena endpoints in production).
 */
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client, type Room } from "colyseus.js";
import { SignJWT } from "jose";
import { loadEnv } from "@gukirana/config";
import { ArenaEvt, ArenaMsg, type ArenaRealtimeState, type ArenaUserAccess } from "@gukirana/contracts";
import { WorldRoom } from "./world-room.js";
import { arenaConfig, clearArenaCache, setArenaSources } from "../social/arena-access.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const EV = "eeeeeeee-0000-4000-8000-000000000001";
let state: ArenaRealtimeState;
const people = new Map<string, Partial<ArenaUserAccess>>();

let http: HttpServer;
let game: Server;
let url = "";
let n = 0;
const open: Room[] = [];

interface Person {
  room: Room;
  uid: string;
  closed: () => boolean;
  of: (type: string) => Record<string, unknown>[];
  last: (type: string) => Record<string, unknown> | undefined;
}

async function token(uid: string, name: string) {
  return new SignJWT({ sub: uid, name, color: "#3DA9FC", lvl: 4 })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("gukirana-api")
    .setAudience("gukirana")
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(loadEnv().JWT_SECRET));
}

/** access = null → guest */
async function person(access: Partial<ArenaUserAccess> | null, roomGame = "arena"): Promise<Person> {
  const i = ++n;
  const uid = `00000000-0000-4000-9000-${String(i).padStart(12, "0")}`;
  if (access) people.set(uid, access);
  const opts = access === null ? { game: roomGame, name: `Guest${i}` } : { game: roomGame, name: `Fan${i}`, token: await token(uid, `Fan${i}`) };
  const room = await new Client(url).joinOrCreate("hall", opts);
  open.push(room);
  const inbox: { type: string; msg: Record<string, unknown> }[] = [];
  let isClosed = false;
  room.onLeave(() => void (isClosed = true));
  room.onMessage("*", (type, msg) => inbox.push({ type: String(type), msg: msg as Record<string, unknown> }));
  const of = (t: string) => inbox.filter((m) => m.type === t).map((m) => m.msg);
  return { room, uid, closed: () => isClosed, of, last: (t) => of(t).at(-1) };
}

const until = async (cond: () => boolean, ms = 2000) => {
  const t = Date.now();
  while (!cond() && Date.now() - t < ms) await wait(15);
  expect(cond()).toBe(true);
};
const setState = (s: Partial<ArenaRealtimeState>) => {
  state = { ...state, ...s };
  clearArenaCache();
};
const event = (over: Partial<NonNullable<ArenaRealtimeState["current"]>> = {}) => ({
  id: EV,
  status: "doors_open" as const,
  openSeating: false,
  capacity: 100,
  vipCapacity: 4,
  passesIssued: 0,
  ...over,
});
const pass = (zone: "seats" | "vip" | "floor") => ({ pass: { eventId: EV, zone, seat: null } });
const zone = (p: Person, z: string) => p.room.send(ArenaMsg.zone, { zone: z });
const sit = (p: Person, seat: string) => p.room.send(ArenaMsg.sit, { seat });

const closeAll = () =>
  Promise.all(
    open
      .splice(0)
      .filter((r) => r.connection.isOpen)
      .map((r) => Promise.race([r.leave().catch(() => undefined), wait(1000)])),
  );

beforeAll(async () => {
  arenaConfig.statePollMs = 100;
  arenaConfig.removeGraceMs = 150;
  setArenaSources({
    state: async () => state,
    access: async (uid) => ({ open: state.open, barred: false, pass: null, roles: [], level: 4, ...people.get(uid) }),
    reporter: async () => undefined,
  });
  http = createServer();
  game = new Server({ transport: new WebSocketTransport({ server: http }) });
  game.define("hall", WorldRoom).filterBy(["game"]);
  await game.listen(0);
  url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}`;
}, 20_000);

beforeEach(async () => {
  await closeAll();
  await wait(50);
  people.clear();
  arenaConfig.actionMax = 6;
  setState({ open: true, maxConcourse: 50, current: null, barred: [] });
});

afterAll(async () => {
  await closeAll();
  await game.gracefullyShutdown(false).catch(() => undefined);
}, 20_000);

describe("Tournament Arena entry", () => {
  it("closed: guests and players are refused and dropped; staff walk in", async () => {
    setState({ open: false });
    const g = await person(null);
    const p = await person({});
    const boss = await person({ roles: ["event_manager"] });
    await until(() => g.closed() && p.closed());
    expect(g.last(ArenaEvt.denied)).toEqual({ action: "enter", reason: "ARENA_CLOSED" });
    expect(p.last(ArenaEvt.denied)).toEqual({ action: "enter", reason: "ARENA_CLOSED" });
    expect(boss.of(ArenaEvt.denied)).toHaveLength(0);
    expect(boss.closed()).toBe(false);
    expect(boss.of("snapshot")).toHaveLength(1);
  });

  it("barred people are refused", async () => {
    const p = await person({ barred: true });
    await until(() => p.closed());
    expect(p.last(ArenaEvt.denied)).toEqual({ action: "enter", reason: "BARRED" });
  });

  it("closing walks everyone out except staff; barring walks that person out", async () => {
    const a = await person({});
    const b = await person({});
    const g = await person(null);
    const boss = await person({ roles: ["super_admin"] });
    await until(() => boss.last(ArenaEvt.occupancy)?.concourse === 4);
    setState({ barred: [a.uid] });
    await until(() => a.closed());
    expect(a.last(ArenaEvt.removed)).toEqual({ reason: "BARRED" });
    expect(b.of(ArenaEvt.removed)).toHaveLength(0);
    setState({ open: false });
    await until(() => b.closed() && g.closed());
    expect(b.last(ArenaEvt.removed)).toEqual({ reason: "ARENA_CLOSED" });
    expect(g.last(ArenaEvt.removed)).toEqual({ reason: "ARENA_CLOSED" });
    await wait(300);
    expect(boss.closed()).toBe(false);
    await until(() => boss.last(ArenaEvt.occupancy)?.concourse === 1);
  });
});

describe("Tournament Arena zones and seats", () => {
  it("no event: seats are free for all, one person per seat; the floor is staff only", async () => {
    const a = await person(null);
    const b = await person({});
    sit(a, "A-1-1");
    await until(() => !!a.last(ArenaEvt.seated));
    expect(a.last(ArenaEvt.seated)).toEqual({ seat: "A-1-1" });
    await until(() => (b.last(ArenaEvt.seats)?.taken as string[] | undefined)?.includes("A-1-1") === true);
    sit(b, "A-1-1");
    await until(() => !!b.last(ArenaEvt.denied));
    expect(b.last(ArenaEvt.denied)).toEqual({ action: "sit", reason: "SEAT_TAKEN" });
    sit(b, "Z-9-9"); // not a bowl seat: ignored
    sit(b, "A-7-1"); // row out of range: ignored
    await wait(100);
    expect(b.of(ArenaEvt.seated)).toHaveLength(0);
    zone(b, "floor");
    await until(() => b.of(ArenaEvt.denied).length === 2);
    expect(b.last(ArenaEvt.denied)).toEqual({ action: "zone", reason: "EVENT_NOT_OPEN" });
    expect(a.last(ArenaEvt.occupancy)).toEqual({ concourse: 2, seats: 1 });
    a.room.send(ArenaMsg.stand, {});
    await until(() => a.last(ArenaEvt.occupancy)?.seats === 0);
  });

  it("during an event a seat needs a pass; VIP and floor need their own pass", async () => {
    setState({ current: event() });
    const guest = await person(null);
    const fan = await person({});
    const holder = await person(pass("seats"));
    const vip = await person(pass("vip"));
    const player = await person(pass("floor"));
    await until(() => !!guest.last(ArenaEvt.event));
    expect(guest.last(ArenaEvt.event)).toEqual({ eventId: EV, status: "doors_open" });
    sit(guest, "B-2-3");
    sit(fan, "B-2-3");
    zone(holder, "vip");
    await until(() => !!guest.last(ArenaEvt.denied) && !!fan.last(ArenaEvt.denied) && !!holder.last(ArenaEvt.denied));
    expect(guest.last(ArenaEvt.denied)).toEqual({ action: "sit", reason: "LOGIN_REQUIRED" });
    expect(fan.last(ArenaEvt.denied)).toEqual({ action: "sit", reason: "NO_PASS" });
    expect(holder.last(ArenaEvt.denied)).toEqual({ action: "zone", reason: "NO_PASS" });
    sit(holder, "B-2-3");
    sit(vip, "V1-1-2");
    zone(player, "floor");
    zone(fan, "floor");
    await until(() => !!holder.last(ArenaEvt.seated) && !!vip.last(ArenaEvt.seated) && !!player.last(ArenaEvt.zoneOk) && !!fan.of(ArenaEvt.denied)[1]);
    expect(vip.last(ArenaEvt.zoneOk)).toEqual({ zone: "vip" });
    expect(player.last(ArenaEvt.zoneOk)).toEqual({ zone: "floor" });
    expect(fan.last(ArenaEvt.denied)).toEqual({ action: "zone", reason: "NOT_PARTICIPANT" });
    // the fan claims a pass in the API: the next try re-checks at once (no wait for the cache)
    people.set(fan.uid, pass("seats"));
    sit(fan, "B-2-4");
    await until(() => !!fan.last(ArenaEvt.seated));
  });

  it("open seating: guests sit without a pass, up to capacity", async () => {
    setState({ current: event({ openSeating: true, capacity: 1 }) });
    const a = await person(null);
    const b = await person(null);
    sit(a, "C-1-1");
    await until(() => !!a.last(ArenaEvt.seated));
    sit(b, "C-1-2");
    await until(() => !!b.last(ArenaEvt.denied));
    expect(b.last(ArenaEvt.denied)).toEqual({ action: "sit", reason: "SOLD_OUT" });
  });

  it("a new event sends people back to the concourse and frees their seats", async () => {
    const a = await person({});
    sit(a, "D-1-1");
    await until(() => !!a.last(ArenaEvt.seated));
    setState({ current: event() });
    await until(() => !!a.last(ArenaEvt.event));
    await until(() => a.last(ArenaEvt.zoneOk)?.zone === "concourse");
    await until(() => (a.last(ArenaEvt.seats)?.taken as string[]).length === 0);
  });

  it("rate limits zone / sit requests", async () => {
    arenaConfig.actionMax = 2;
    const a = await person({});
    for (let i = 1; i <= 4; i++) sit(a, `E-1-${i}`);
    await until(() => a.of(ArenaEvt.denied).some((d) => d.reason === "RATE_LIMITED"));
  });

  it("arena messages are ignored outside the arena hall", async () => {
    const p = await person({ roles: ["super_admin"] }, "pool");
    sit(p, "A-1-1");
    zone(p, "seats");
    await wait(150);
    expect(p.of(ArenaEvt.seated)).toHaveLength(0);
    expect(p.of(ArenaEvt.zoneOk)).toHaveLength(0);
    expect(p.of(ArenaEvt.denied)).toHaveLength(0);
  });
});
