/**
 * Administrative Block doors over a real in-process server (hall room, game "admin"): role holders walk in, others
 * knock and someone inside lets them in or declines; expiry, nobody inside, occupancy, rate limits, guests.
 * Roles come from a stub access source (the API's /internal/access endpoint in production).
 */
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client, type Room } from "colyseus.js";
import { SignJWT } from "jose";
import { loadEnv } from "@gukirana/config";
import { KNOCK_WAIT_TTL_MS, OFFICE_CAPACITY, OfficeEvt, OfficeEvtV2, OfficeEvtV3, OfficeMsg, OfficeMsgV2, SEED_OFFICES } from "@gukirana/contracts";
import { WorldRoom } from "./world-room.js";
import {
  clearAccessCache,
  officeConfig,
  setAccessSource,
  setOccupancyReporter,
} from "../social/office-access.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const known = SEED_OFFICES.map((o) => o.id);
/** uid → offices the user may enter */
const grants = new Map<string, string[]>();
const reports: Record<string, number>[] = [];

let http: HttpServer;
let game: Server;
let url = "";
let n = 0;
const open: Room[] = [];

interface Person {
  room: Room;
  sid: string;
  uid: string;
  inbox: { type: string; msg: Record<string, unknown> }[];
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

async function person(offices: string[] | null, roomGame = "admin"): Promise<Person> {
  const i = ++n;
  const uid = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  const name = `Staff${i}`;
  if (offices) grants.set(uid, offices);
  const opts =
    offices === null
      ? { game: roomGame, name: `Guest${i}` }
      : { game: roomGame, name, token: await token(uid, name) };
  const room = await new Client(url).joinOrCreate("hall", opts);
  open.push(room);
  const inbox: Person["inbox"] = [];
  room.onMessage("*", (type, msg) => inbox.push({ type: String(type), msg: msg as Record<string, unknown> }));
  const of = (t: string) => inbox.filter((m) => m.type === t).map((m) => m.msg);
  return { room, sid: room.sessionId, uid, inbox, of, last: (t) => of(t).at(-1) };
}

const enter = (p: Person, office: string) => p.room.send(OfficeMsg.enter, { office });
const until = async (cond: () => boolean, ms = 2000) => {
  const t = Date.now();
  while (!cond() && Date.now() - t < ms) await wait(15);
  expect(cond()).toBe(true);
};

/** leave every room still connected (a room left inside a test is skipped: leaving twice never resolves) */
const closeAll = () =>
  Promise.all(
    open
      .splice(0)
      .filter((r) => r.connection.isOpen)
      .map((r) => Promise.race([r.leave().catch(() => undefined), wait(1000)])),
  );

beforeAll(async () => {
  setAccessSource(async (uid) => ({ roles: [], offices: grants.get(uid) ?? [], known }));
  setOccupancyReporter(async (_room, offices) => void reports.push(offices));
  http = createServer();
  game = new Server({ transport: new WebSocketTransport({ server: http }) });
  game.define("hall", WorldRoom).filterBy(["game"]);
  await game.listen(0);
  url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}`;
}, 20_000);

beforeEach(async () => {
  // each test starts with an empty block
  await closeAll();
  await wait(50);
  officeConfig.knockTtlMs = 30_000;
  officeConfig.knockGapMs = 5_000;
  officeConfig.maxOpenKnocks = 3;
  grants.clear();
  clearAccessCache();
});

afterAll(async () => {
  await closeAll();
  await game.gracefullyShutdown(false).catch(() => undefined);
}, 20_000);

describe("Administrative Block offices", () => {
  it("a role holder walks straight in; everyone sees the occupancy", async () => {
    const it = await person(["it-office"]);
    const other = await person([]);
    enter(it, "it-office");
    await until(() => !!it.last(OfficeEvt.admitted));
    expect(it.last(OfficeEvt.admitted)).toEqual({ office: "it-office", via: "role" });
    await until(() => !!other.last(OfficeEvt.occupancy));
    expect(other.last(OfficeEvt.occupancy)).toEqual({ office: "it-office", occupants: 1, visitors: 0, queue: 0 });
    expect(reports.at(-1)).toEqual({ "it-office": 1 });
    // a late joiner gets the current lamps on join
    const late = await person([]);
    await until(() => !!late.last(OfficeEvt.occupancy));
    expect(late.last(OfficeEvt.occupancy)).toMatchObject({ office: "it-office", occupants: 1 });
  });

  it("an all-offices role (super admin) enters any office", async () => {
    const boss = await person(known);
    enter(boss, "accountant");
    await until(() => !!boss.last(OfficeEvt.admitted));
    expect(boss.last(OfficeEvt.admitted)).toEqual({ office: "accountant", via: "role" });
    // moving to another office leaves the first
    const watcher = await person([]);
    enter(boss, "customer-support");
    await until(() =>
      watcher.of(OfficeEvt.occupancy).some((m) => m.office === "accountant" && m.occupants === 0),
    );
  });

  it("nobody inside → NOBODY_INSIDE; unknown office → NOT_ALLOWED", async () => {
    const visitor = await person([]);
    enter(visitor, "accountant");
    await until(() => !!visitor.last(OfficeEvt.refused));
    expect(visitor.last(OfficeEvt.refused)).toEqual({ office: "accountant", reason: "NOBODY_INSIDE" });
    enter(visitor, "broom-closet");
    await until(() => visitor.of(OfficeEvt.refused).length === 2);
    expect(visitor.last(OfficeEvt.refused)).toEqual({ office: "broom-closet", reason: "NOT_ALLOWED" });
  });

  it("knock → the person inside lets the visitor in (invite lasts until they leave)", async () => {
    const acct = await person(["accountant"]);
    const visitor = await person([]);
    enter(acct, "accountant");
    await until(() => !!acct.last(OfficeEvt.admitted));
    enter(visitor, "accountant");
    await until(() => !!visitor.last(OfficeEvt.knocking) && !!acct.last(OfficeEvt.knock));
    const knocking = visitor.last(OfficeEvt.knocking)!;
    expect(knocking).toMatchObject({ office: "accountant", expiresInMs: 30_000 });
    const knock = acct.last(OfficeEvt.knock)!;
    expect(knock).toMatchObject({
      office: "accountant",
      knockId: knocking.knockId,
      expiresInMs: 30_000,
      from: { id: visitor.sid, name: expect.stringMatching(/^Staff/), level: 4 },
    });

    // the visitor can't answer their own knock, and nobody else outside can either
    visitor.room.send(OfficeMsg.answer, { knockId: knocking.knockId, allow: true });
    await wait(100);
    expect(visitor.last(OfficeEvt.admitted)).toBeUndefined();

    acct.room.send(OfficeMsg.answer, { knockId: knock.knockId, allow: true });
    await until(() => !!visitor.last(OfficeEvt.admitted));
    expect(visitor.last(OfficeEvt.admitted)).toEqual({ office: "accountant", via: "invite" });
    // occupancy counts staff (the visitor is not staff)
    expect(acct.last(OfficeEvt.occupancy)).toEqual({ office: "accountant", occupants: 1, visitors: 1, queue: 0 });

    // after leaving, the invite is gone: the next visit knocks again
    visitor.room.send(OfficeMsg.leave, { office: "accountant" });
    await wait(80);
    officeConfig.knockGapMs = 0;
    enter(visitor, "accountant");
    await until(() => visitor.of(OfficeEvt.knocking).length === 2);
  });

  it("knock → declined", async () => {
    const sup = await person(["customer-support"]);
    const visitor = await person([]);
    enter(sup, "customer-support");
    await until(() => !!sup.last(OfficeEvt.admitted));
    enter(visitor, "customer-support");
    await until(() => !!sup.last(OfficeEvt.knock));
    const k = sup.last(OfficeEvt.knock)!;
    sup.room.send(OfficeMsg.answer, { knockId: k.knockId, allow: false });
    await until(() => !!visitor.last(OfficeEvt.refused));
    expect(visitor.last(OfficeEvt.refused)).toEqual({
      office: "customer-support",
      knockId: k.knockId,
      reason: "DECLINED",
    });
    // a second answer to the closed knock does nothing
    sup.room.send(OfficeMsg.answer, { knockId: k.knockId, allow: true });
    await wait(100);
    expect(visitor.last(OfficeEvt.admitted)).toBeUndefined();
  });

  it("an unanswered knock expires", async () => {
    officeConfig.knockTtlMs = 250;
    const it = await person(["it-office"]);
    const visitor = await person([]);
    enter(it, "it-office");
    await until(() => !!it.last(OfficeEvt.admitted));
    enter(visitor, "it-office");
    await until(() => !!visitor.last(OfficeEvt.knocking));
    expect(visitor.last(OfficeEvt.knocking)!.expiresInMs).toBe(250);
    await until(() => !!visitor.last(OfficeEvt.refused), 1500);
    expect(visitor.last(OfficeEvt.refused)).toMatchObject({ office: "it-office", reason: "EXPIRED" });
    // answering after expiry does nothing
    it.room.send(OfficeMsg.answer, { knockId: visitor.last(OfficeEvt.knocking)!.knockId, allow: true });
    await wait(100);
    expect(visitor.last(OfficeEvt.admitted)).toBeUndefined();
  });

  it("the last staff member leaving refuses open knocks; disconnect updates occupancy", async () => {
    const it = await person(["it-office"]);
    const visitor = await person([]);
    enter(it, "it-office");
    await until(() => !!it.last(OfficeEvt.admitted));
    enter(visitor, "it-office");
    await until(() => !!visitor.last(OfficeEvt.knocking));
    await it.room.leave();
    await until(() => !!visitor.last(OfficeEvt.refused));
    expect(visitor.last(OfficeEvt.refused)).toMatchObject({ office: "it-office", reason: "NOBODY_INSIDE" });
    await until(() => visitor.last(OfficeEvt.occupancy)?.occupants === 0);
  });

  it("rate limits knocks: one per door per gap, max 3 open", async () => {
    const boss = await person(known);
    const boss2 = await person(known);
    const boss3 = await person(known);
    const boss4 = await person(known);
    const visitor = await person([]);
    enter(boss, "super-admin");
    enter(boss2, "it-office");
    enter(boss3, "accountant");
    enter(boss4, "customer-support");
    await until(() => [boss, boss2, boss3, boss4].every((b) => !!b.last(OfficeEvt.admitted)));
    enter(visitor, "super-admin");
    await until(() => visitor.of(OfficeEvt.knocking).length === 1);
    // repeating the same knock just re-sends the open one
    enter(visitor, "super-admin");
    await until(() => visitor.of(OfficeEvt.knocking).length === 2);
    expect(visitor.of(OfficeEvt.knocking)[1]!.knockId).toBe(visitor.of(OfficeEvt.knocking)[0]!.knockId);
    expect(boss.of(OfficeEvt.knock)).toHaveLength(1);
    // declined, then knocking again at once → RATE_LIMITED
    boss.room.send(OfficeMsg.answer, { knockId: boss.last(OfficeEvt.knock)!.knockId, allow: false });
    await until(() => !!visitor.last(OfficeEvt.refused));
    enter(visitor, "super-admin");
    await until(() => visitor.last(OfficeEvt.refused)?.reason === "RATE_LIMITED");
    // three open knocks at once is the limit
    enter(visitor, "it-office");
    enter(visitor, "accountant");
    enter(visitor, "customer-support");
    await until(() => visitor.of(OfficeEvt.knocking).length === 5); // 2 (same knock twice) + 3 new
    await wait(100);
    expect(visitor.of(OfficeEvt.knocking)).toHaveLength(5);
    officeConfig.knockGapMs = 0;
    enter(visitor, "super-admin");
    await until(() => visitor.of(OfficeEvt.refused).filter((r) => r.reason === "RATE_LIMITED").length === 2);
  });

  it("guests can't enter or knock", async () => {
    const it = await person(["it-office"]);
    const guest = await person(null);
    enter(it, "it-office");
    await until(() => !!it.last(OfficeEvt.admitted));
    enter(guest, "it-office");
    await until(() => !!guest.last(OfficeEvt.refused));
    expect(guest.last(OfficeEvt.refused)).toEqual({ office: "it-office", reason: "LOGIN_REQUIRED" });
    expect(it.of(OfficeEvt.knock)).toHaveLength(0);
  });

  it("a revoked role stops opening the door once the cache refreshes", async () => {
    const acct = await person(["accountant"]);
    enter(acct, "accountant");
    await until(() => !!acct.last(OfficeEvt.admitted));
    acct.room.send(OfficeMsg.leave, {});
    await wait(80);
    grants.set(acct.uid, []);
    clearAccessCache(); // stands in for the 15 s TTL
    enter(acct, "accountant");
    await until(() => !!acct.last(OfficeEvt.refused));
    expect(acct.last(OfficeEvt.refused)).toEqual({ office: "accountant", reason: "NOBODY_INSIDE" });
  });

  it("office messages are ignored outside the admin hall", async () => {
    const p = await person(known, "pool");
    enter(p, "it-office");
    await wait(150);
    expect(p.of(OfficeEvt.admitted)).toHaveLength(0);
    expect(p.of(OfficeEvt.refused)).toHaveLength(0);
  });
});

/** P2-ADM-04: the knock queue (Let in / Please wait / Decline), capacity, withdrawing, office chairs, conversation */
describe("Administrative Block: queue, capacity, chairs, conversation", () => {
  /** a staff member inside `office` */
  const staffIn = async (office: string) => {
    const s = await person([office]);
    enter(s, office);
    await until(() => !!s.last(OfficeEvt.admitted));
    return s;
  };
  const knockAndGet = async (v: Person, office: string, staff: Person, nth = 1) => {
    const before = v.of(OfficeEvt.knocking).length;
    enter(v, office);
    await until(() => v.of(OfficeEvt.knocking).length > before && staff.of(OfficeEvt.knock).length >= nth);
    return v.last(OfficeEvt.knocking)!.knockId as string;
  };
  const fromId = (m: Record<string, unknown>) => (m.from as { id: string }).id;
  const seats = (p: Person) => (p.last("seats") ?? {}) as Record<string, string>;
  const members = (p: Person) => (p.last(OfficeEvtV2.members)?.members as unknown[] | undefined) ?? [];

  it("Please wait keeps the knock queued (TTL extended); another staff member lets them in later; prompts close", async () => {
    const a = await staffIn("it-office");
    const b = await staffIn("it-office");
    const v = await person([]);
    const id = await knockAndGet(v, "it-office", a);
    await until(() => b.of(OfficeEvt.knock).length === 1);
    a.room.send(OfficeMsg.answer, { knockId: id, action: "wait" });
    await until(() => !!v.last(OfficeEvtV2.wait));
    const w = v.last(OfficeEvtV2.wait)!;
    expect(w).toMatchObject({ office: "it-office", knockId: id, reason: "ASKED" });
    expect(w.expiresInMs as number).toBeGreaterThan(KNOCK_WAIT_TTL_MS - 2000);
    expect(v.last(OfficeEvt.refused)).toBeUndefined();
    // both staff see the knock again, now "waiting"; the lamps show the queue (counts only)
    await until(() => b.of(OfficeEvt.knock).some((k) => k.status === "waiting"));
    expect(v.last(OfficeEvt.occupancy)).toMatchObject({ office: "it-office", occupants: 2, queue: 1 });
    b.room.send(OfficeMsg.answer, { knockId: id, action: "allow" });
    await until(() => !!v.last(OfficeEvt.admitted));
    expect(v.last(OfficeEvt.admitted)).toEqual({ office: "it-office", via: "invite" });
    await until(() => !!a.last(OfficeEvtV2.knockClosed));
    expect(a.last(OfficeEvtV2.knockClosed)).toEqual({ office: "it-office", knockId: id, outcome: "ALLOWED" });
    // the other staff member's late answer does nothing
    a.room.send(OfficeMsg.answer, { knockId: id, action: "decline" });
    await wait(80);
    expect(v.last(OfficeEvt.refused)).toBeUndefined();
  });

  it("a full office queues new knocks (never refuses) until a visitor chair is free", async () => {
    const s = await staffIn("accountant");
    const guests: Person[] = [];
    for (let i = 0; i < OFFICE_CAPACITY; i++) {
      const g = await person([]);
      const id = await knockAndGet(g, "accountant", s, i + 1);
      s.room.send(OfficeMsg.answer, { knockId: id, allow: true });
      await until(() => !!g.last(OfficeEvt.admitted));
      guests.push(g);
    }
    const late = await person([]);
    enter(late, "accountant");
    await until(() => !!late.last(OfficeEvtV2.wait));
    expect(late.last(OfficeEvtV2.wait)).toMatchObject({ office: "accountant", reason: "FULL" });
    expect(late.last(OfficeEvt.refused)).toBeUndefined();
    await until(() => s.of(OfficeEvt.knock).some((k) => fromId(k) === late.sid));
    const k = s.of(OfficeEvt.knock).filter((m) => fromId(m) === late.sid).at(-1)!;
    expect(k).toMatchObject({ status: "waiting", full: true });
    // Let in while full: still waiting
    s.room.send(OfficeMsg.answer, { knockId: k.knockId, action: "allow" });
    await until(() => late.of(OfficeEvtV2.wait).length === 2);
    expect(late.last(OfficeEvt.admitted)).toBeUndefined();
    // a visitor leaves: the queue is offered again with a free chair, and Let in works
    guests[0]!.room.send(OfficeMsg.leave, {});
    await until(() => s.of(OfficeEvt.knock).some((m) => m.knockId === k.knockId && m.full === false));
    s.room.send(OfficeMsg.answer, { knockId: k.knockId, action: "allow" });
    await until(() => !!late.last(OfficeEvt.admitted));
  });

  it("a visitor can withdraw a knock; leaving the hall closes it too", async () => {
    officeConfig.knockGapMs = 0;
    const s = await staffIn("customer-support");
    const v = await person([]);
    const id = await knockAndGet(v, "customer-support", s);
    v.room.send(OfficeMsgV2.cancel, { knockId: id });
    await until(() => !!s.last(OfficeEvtV2.knockClosed));
    expect(s.last(OfficeEvtV2.knockClosed)).toEqual({ office: "customer-support", knockId: id, outcome: "CANCELLED" });
    // somebody else's knock can't be withdrawn by a stranger
    const id2 = await knockAndGet(v, "customer-support", s, 2);
    const other = await person([]);
    other.room.send(OfficeMsgV2.cancel, { knockId: id2 });
    await wait(80);
    expect(s.of(OfficeEvtV2.knockClosed)).toHaveLength(1);
    await v.room.leave();
    await until(() => s.of(OfficeEvtV2.knockClosed).length === 2);
    expect(s.last(OfficeEvtV2.knockClosed)).toMatchObject({ knockId: id2, outcome: "LEFT" });
  });

  it("office chairs: visitors only inside, the officer chair only for the role; leaving frees the chair", async () => {
    const s = await staffIn("it-office");
    const v = await person([]);
    v.room.send("sit", { seat: "lobby-3" });
    await until(() => seats(v)["lobby-3"] === v.sid);
    v.room.send("sit", { seat: "it-office-visitor-0" });
    await until(() => v.last("seat-taken")?.reason === "NOT_INSIDE");
    // waiting in the lobby: the answer still arrives while seated
    const id = await knockAndGet(v, "it-office", s);
    s.room.send(OfficeMsg.answer, { knockId: id, action: "allow" });
    await until(() => !!v.last(OfficeEvt.admitted));
    v.room.send("sit", { seat: "it-office-officer" });
    await until(() => v.last("seat-taken")?.reason === "STAFF_ONLY");
    v.room.send("sit", { seat: "it-office-visitor-0" });
    await until(() => seats(v)["it-office-visitor-0"] === v.sid);
    expect(seats(v)["lobby-3"]).toBeUndefined(); // one seat per person
    // a chair in another office is refused
    v.room.send("sit", { seat: "accountant-visitor-0" });
    await until(() => v.of("seat-taken").length === 3);
    s.room.send("sit", { seat: "it-office-officer" });
    await until(() => seats(s)["it-office-officer"] === s.sid);
    v.room.send(OfficeMsg.leave, {});
    await until(() => seats(s)["it-office-visitor-0"] === undefined);
    expect(seats(s)["it-office-officer"]).toBe(s.sid);
  });

  it("the people inside one office share a private conversation (members + office chat)", async () => {
    const s = await staffIn("super-admin");
    const v = await person([]);
    const outside = await person([]);
    const id = await knockAndGet(v, "super-admin", s);
    s.room.send(OfficeMsg.answer, { knockId: id, action: "allow" });
    await until(() => members(s).length === 2);
    expect(members(s)).toEqual(
      expect.arrayContaining([
        { id: s.sid, name: expect.any(String), staff: true },
        { id: v.sid, name: expect.any(String), staff: false },
      ]),
    );
    expect(outside.of(OfficeEvtV2.members)).toHaveLength(0);
    v.room.send(OfficeMsgV2.chat, { text: "Good morning" });
    await until(() => !!s.last(OfficeEvtV2.chat));
    expect(s.last(OfficeEvtV2.chat)).toMatchObject({ office: "super-admin", id: v.sid, text: "Good morning" });
    await wait(80);
    expect(outside.of(OfficeEvtV2.chat)).toHaveLength(0);
    // somebody outside the offices can't post into one
    outside.room.send(OfficeMsgV2.chat, { text: "hello?" });
    await wait(80);
    expect(s.of(OfficeEvtV2.chat)).toHaveLength(1);
    // leaving: the visitor's conversation empties, the staff member is alone again
    v.room.send(OfficeMsg.leave, {});
    await until(() => members(v).length === 0 && v.of(OfficeEvtV2.members).length > 1);
    await until(() => members(s).length === 1);
  });

  it("offices are private for text chat too: lobby chat never reaches an office, office talk never the lobby (GAP-012)", async () => {
    const s = await staffIn("it-office");
    const lobby = await person([]);
    const lobby2 = await person([]);
    await wait(1100); // chat has a minimum interval per session
    lobby.room.send("chat", { text: "anyone at reception?", scope: "room" });
    await until(() => lobby2.of("chat").some((m) => m.text === "anyone at reception?"));
    await wait(100);
    expect(s.of("chat").filter((m) => m.text === "anyone at reception?")).toHaveLength(0);
    s.room.send("chat", { text: "server room notes", scope: "room" });
    await until(() => s.of("chat").some((m) => m.text === "server room notes")); // own echo
    await wait(150);
    expect(lobby.of("chat").filter((m) => m.text === "server room notes")).toHaveLength(0);
    expect(lobby2.of("chat").filter((m) => m.text === "server room notes")).toHaveLength(0);
  });

  it("the last officer leaving: visitors are told, then shown out after the grace time (GAP-013)", async () => {
    officeConfig.officerLeftGraceMs = 300;
    try {
      const s = await staffIn("accountant");
      const v = await person([]);
      const id = await knockAndGet(v, "accountant", s);
      s.room.send(OfficeMsg.answer, { knockId: id, action: "allow" });
      await until(() => !!v.last(OfficeEvt.admitted));
      s.room.send(OfficeMsg.leave, {});
      await until(() => !!v.last(OfficeEvtV3.officerLeft));
      expect(v.last(OfficeEvtV3.officerLeft)).toEqual({ office: "accountant", graceMs: 300 });
      await until(() => !!v.last(OfficeEvtV3.walkOut), 2000);
      expect(v.last(OfficeEvtV3.walkOut)).toEqual({ office: "accountant", reason: "OFFICER_LEFT" });
      await until(() => s.of(OfficeEvt.occupancy).some((m) => m.office === "accountant" && m.occupants === 0 && m.visitors === 0));
      // out of the office: office chat no longer reaches them / from them
      v.room.send(OfficeMsgV2.chat, { text: "still here?" });
      await wait(100);
      expect(v.of(OfficeEvtV2.chat)).toHaveLength(0);
    } finally {
      officeConfig.officerLeftGraceMs = 60_000;
    }
  });

  it("an officer coming back within the grace time keeps the visitor in (GAP-013)", async () => {
    officeConfig.officerLeftGraceMs = 400;
    try {
      const s = await staffIn("customer-support");
      const v = await person([]);
      const id = await knockAndGet(v, "customer-support", s);
      s.room.send(OfficeMsg.answer, { knockId: id, action: "allow" });
      await until(() => !!v.last(OfficeEvt.admitted));
      s.room.send(OfficeMsg.leave, {});
      await until(() => !!v.last(OfficeEvtV3.officerLeft));
      enter(s, "customer-support");
      await until(() => !!v.last(OfficeEvtV3.officerBack));
      await wait(600);
      expect(v.of(OfficeEvtV3.walkOut)).toHaveLength(0);
    } finally {
      officeConfig.officerLeftGraceMs = 60_000;
    }
  });
});
