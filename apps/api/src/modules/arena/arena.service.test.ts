import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { arenaEvents, arenaPasses, buildings, createDatabase, eq, users, type Database } from "@gukirana/db";
import { AccessService } from "../admin-block/access.service.js";
import { ArenaService } from "./arena.service.js";
import { ArenaPresence } from "./presence.js";

let db: Database;
let close: () => Promise<void>;
let access: AccessService;
let arena: ArenaService;

const uid = (i: number) => `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, "0")}`;
const boss = uid(1);
const P = Array.from({ length: 20 }, (_, i) => uid(100 + i));
const H = 3600_000;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
/** an event whose doors are open now (status settles by time on the first read) */
const openEvent = (over: Record<string, unknown> = {}) =>
  arena.createEvent(
    { title: "Pool Final", kind: "final", doorsOpenAt: iso(-H / 2), startsAt: iso(H), endsAt: iso(3 * H), rules: [{ kind: "members" }], capacity: 5, status: "scheduled", ...over } as never,
    "test",
  );
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (e) {
    const r = (e as { getResponse?: () => { denial?: string; code?: string } }).getResponse?.();
    return r?.denial ?? r?.code ?? String(e);
  }
};

beforeAll(async () => {
  const d = await createDatabase("pglite://memory");
  db = d.db;
  close = d.close;
  access = new AccessService(db);
  arena = new ArenaService(db, access, new ArenaPresence());
  await access.seed();
  await arena.seed();
  await db.insert(users).values([{ id: boss, email: "boss@example.com", username: "boss" }, ...P.map((id, i) => ({ id, username: `p${i}`, xp: i * 100 }))]);
  await access.grant(boss, "super_admin", "test");
});
afterAll(() => close());
beforeEach(async () => {
  await db.delete(arenaEvents); // cascades passes, invites, participants
  await arena.updateSettings({ open: true }, "test");
  for (const p of P) await arena.unbar(p, "test");
  (arena as unknown as { claims: Map<string, unknown> }).claims.clear();
});

describe("arena settings + seed", () => {
  it("seeds the event_manager role once and audits open/close", async () => {
    await arena.seed();
    expect((await access.listRoles()).find((r) => r.id === "event_manager")).toMatchObject({ offices: [], allOffices: false });
    await arena.updateSettings({ open: false }, "test");
    const log = await arena.auditLog(5);
    expect(log[0]).toMatchObject({ action: "arena.close", target: "arena:settings" });
  });
  it("closed: guests and players can't enter, staff can", async () => {
    await arena.updateSettings({ open: false }, "test");
    expect(await arena.status(null)).toMatchObject({ open: false, canEnter: false, denial: "ARENA_CLOSED" });
    expect((await arena.status(P[0]!)).denial).toBe("ARENA_CLOSED");
    expect(await arena.status(boss)).toMatchObject({ canEnter: true, denial: null });
  });
  it("the console's building switch (buildings.arena) is a master switch: open only when both are", async () => {
    await db.insert(buildings).values({ id: "arena", name: "Tournament Arena", open: false });
    expect(await arena.settings()).toMatchObject({ open: true, buildingOpen: false, effectiveOpen: false });
    expect((await arena.status(P[0]!)).denial).toBe("ARENA_CLOSED");
    expect((await arena.realtimeState()).open).toBe(false);
    await db.update(buildings).set({ open: true }).where(eq(buildings.id, "arena"));
    expect((await arena.status(P[0]!)).canEnter).toBe(true);
  });
});

describe("event lifecycle", () => {
  it("moves by time and validates manual transitions", async () => {
    const e = await openEvent();
    expect(e.status).toBe("doors_open");
    expect(await code(arena.updateEvent(e.id, { status: "draft" }, "test"))).toBe("BAD_TRANSITION");
    expect((await arena.updateEvent(e.id, { status: "live" }, "test")).status).toBe("live");
    expect(await code(arena.updateEvent(e.id, { rules: [{ kind: "public" }] }, "test"))).toBe("EVENT_LIVE");
    expect((await arena.updateEvent(e.id, { status: "ended" }, "test")).status).toBe("ended");
    expect(await code(arena.updateEvent(e.id, { title: "Again" }, "test"))).toBe("EVENT_READ_ONLY");
    expect(await code(arena.deleteEvent(e.id, "test"))).toBe("ONLY_DRAFT_DELETE");
  });
  it("refuses overlapping events and bad times; drafts may overlap until scheduled", async () => {
    await openEvent();
    expect(await code(openEvent({ title: "Clash" }))).toBe("EVENT_OVERLAP");
    const d = await openEvent({ title: "Draft", status: "draft" });
    expect(d.status).toBe("draft");
    expect(await code(arena.updateEvent(d.id, { status: "scheduled" }, "test"))).toBe("EVENT_OVERLAP");
    expect(await code(openEvent({ doorsOpenAt: iso(2 * H) }))).toBe("DOORS_AFTER_START");
    expect((await arena.deleteEvent(d.id, "test")).deleted).toBe(d.id);
  });
});

describe("passes", () => {
  it("claim is idempotent and the status shows the pass", async () => {
    const e = await openEvent();
    const a = await arena.claim(P[0]!, e.id);
    const b = await arena.claim(P[0]!, e.id);
    expect(a).toEqual(b);
    expect(a.pass).toEqual({ eventId: e.id, zone: "seats", seat: null });
    const st = await arena.status(P[0]!);
    expect(st).toMatchObject({ pass: a.pass, canClaim: false, current: { id: e.id, passesIssued: 1 } });
    expect((await arena.status(P[1]!)).canClaim).toBe(true);
    expect(await arena.release(P[0]!, e.id)).toEqual({ released: true });
    expect((await arena.status(P[1]!)).current?.passesIssued).toBe(0);
  });

  it("never oversells under parallel claims", async () => {
    const e = await openEvent({ capacity: 5 });
    const results = await Promise.all(P.slice(0, 15).map((p) => code(arena.claim(p, e.id))));
    expect(results.filter((r) => r === "OK")).toHaveLength(5);
    expect(results.filter((r) => r === "SOLD_OUT")).toHaveLength(10);
    const [row] = await db.select().from(arenaEvents).where(eq(arenaEvents.id, e.id));
    expect(row!.seatsIssued).toBe(5);
    expect(await db.select().from(arenaPasses).where(eq(arenaPasses.eventId, e.id))).toHaveLength(5);
  });

  it("parallel claims by one user give one pass and one counted seat", async () => {
    const e = await openEvent();
    await Promise.all(Array.from({ length: 5 }, () => arena.claim(P[3]!, e.id)));
    const [row] = await db.select().from(arenaEvents).where(eq(arenaEvents.id, e.id));
    expect(row!.seatsIssued).toBe(1);
  });

  it("guests can't claim; scope denials; open seating needs no pass", async () => {
    const e = await openEvent({ rules: [{ kind: "min_level", level: 3 }] });
    expect((await arena.status(null)).claimDenial).toBe("LOGIN_REQUIRED");
    expect(await code(arena.claim(P[0]!, e.id))).toBe("LEVEL_TOO_LOW"); // xp 0 → level 1
    expect(await code(arena.claim(P[10]!, e.id))).toBe("OK"); // xp 1000 → level 6
    await arena.updateEvent(e.id, { rules: [{ kind: "public" }] }, "test");
    const st = await arena.status(null);
    expect(st).toMatchObject({ canEnter: true, canClaim: false, claimDenial: null, current: { openSeating: true } });
  });

  it("invites carry a zone; participants get the floor; removing them revokes the pass", async () => {
    const e = await openEvent({ rules: [{ kind: "invite" }], vipCapacity: 1 });
    expect(await code(arena.claim(P[0]!, e.id))).toBe("NOT_INVITED");
    await arena.invite(e.id, "p0", "vip", "test");
    await arena.invite(e.id, "p1", "vip", "test");
    expect((await arena.claim(P[0]!, e.id)).pass.zone).toBe("vip");
    expect(await code(arena.claim(P[1]!, e.id))).toBe("SOLD_OUT"); // vip capacity 1
    const e2 = await arena.updateEvent(e.id, { rules: [{ kind: "participants", guests: 0 }] }, "test");
    expect(e2.passesIssued).toBe(1); // grandfathered
    await arena.addParticipant(e.id, P[2]!, "test");
    expect((await arena.claim(P[2]!, e.id)).pass.zone).toBe("floor");
    expect(await arena.removeParticipant(e.id, "p2", "test")).toMatchObject({ changed: true, passRevoked: true });
    expect(await arena.uninvite(e.id, "p0", "test")).toMatchObject({ changed: true, passRevoked: true });
    const att = await arena.attendance(e.id);
    expect(att.passes).toHaveLength(0);
  });

  it("capacity lowered below passes issued reports overbooked", async () => {
    const e = await openEvent({ capacity: 3 });
    for (const p of P.slice(0, 3)) await arena.claim(p, e.id);
    const after = await arena.updateEvent(e.id, { capacity: 1 }, "test");
    expect(after.overbooked).toBe(2);
    expect(await code(arena.claim(P[5]!, e.id))).toBe("SOLD_OUT");
  });

  it("pass hoarding: at most 3 active passes", async () => {
    for (let i = 0; i < 4; i++) {
      const e = await arena.createEvent(
        { title: `Night ${i}`, kind: "exhibition", startsAt: iso((10 + i * 5) * H), endsAt: iso((11 + i * 5) * H), rules: [{ kind: "members" }], status: "scheduled" },
        "test",
      );
      expect(await code(arena.claim(P[0]!, e.id))).toBe(i < 3 ? "OK" : "PASS_LIMIT");
    }
  });

  it("rate limits claims and returns", async () => {
    const e = await openEvent({ capacity: 100 });
    const out: string[] = [];
    for (let i = 0; i < 12; i++) out.push(await code(i % 2 ? arena.release(P[0]!, e.id) : arena.claim(P[0]!, e.id)));
    expect(out).toContain("RATE_LIMITED");
  });
});

describe("bars", () => {
  it("bar denies entry and claims, revokes passes, protects staff, expires", async () => {
    const e = await openEvent();
    await arena.claim(P[0]!, e.id);
    expect(await arena.bar("p0", "spamming the chat", undefined, "test")).toMatchObject({ passesRevoked: 1 });
    expect((await arena.status(P[0]!)).denial).toBe("BARRED");
    expect(await code(arena.claim(P[0]!, e.id))).toBe("BARRED");
    expect((await arena.realtimeState()).barred).toContain(P[0]);
    expect((await arena.userAccess(P[0]!)).barred).toBe(true);
    expect(await code(arena.bar("boss", "nope", undefined, "test"))).toBe("STAFF_PROTECTED");
    expect(await code(arena.bar("p1", "too late", iso(-1000), "test"))).toBe("UNTIL_IN_PAST");
    await arena.unbar("p0", "test");
    expect(await code(arena.claim(P[0]!, e.id))).toBe("OK");
    expect((await arena.bars()).find((b) => b.user?.id === P[0])).toBeUndefined();
  });
});
