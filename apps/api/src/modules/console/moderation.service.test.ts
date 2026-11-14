/**
 * Account management (P2-CON-02) over an in-memory database: sanctions with reasons and ends (timed suspensions end
 * by themselves), authority rules, staff notes, sessions + sign out everywhere, username reset, delete + anonymise
 * (ledger kept whole), the realtime account feed, search filters, CSV export, the reports queue, staff rate limits and
 * the input schemas.
 */
import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { accessAudit, createDatabase, eq, journalEntries, refreshTokens, reports, userBlocks, users, type Database } from "@gukirana/db";
import { DeleteAccountSchema, SanctionSchema, StaffNoteSchema, UserSearchSchema, USERNAME_RE } from "@gukirana/contracts";
import { AuthGuard, signAccessToken } from "../../common/auth.js";
import { AccessService } from "../admin-block/access.service.js";
import { RoleGuard } from "../admin-block/role.guard.js";
import { StaffLimits } from "../admin-block/staff-limits.js";
import { OccupancyStore } from "../admin-block/occupancy.js";
import { EconomyService } from "../economy/economy.service.js";
import { LedgerService } from "../ledger/ledger.service.js";
import { PLATFORM_ID, userCoins, userStars } from "../ledger/accounts.js";
import { BuildingsService } from "./buildings.service.js";
import { ConsoleService, csvCell } from "./console.service.js";
import { PresenceStore } from "./presence.js";
import { ModerationService, deviceLabel } from "./moderation.service.js";
import { ReportsService } from "./reports.service.js";

let db: Database;
let close: () => Promise<void>;
let access: AccessService;
let ledger: LedgerService;
let mod: ModerationService;
let svc: ConsoleService;
let rep: ReportsService;

const id = (n: number) => `dddddddd-0000-4000-8000-${String(n).padStart(12, "0")}`;
const boss = id(1);
const boss2 = id(2);
const support = id(3);
const itAdmin = id(4);
const p1 = id(10);
const p2 = id(11);
const p3 = id(12);
const p4 = id(13);
const HOUR = 3_600_000;

const ctx = (authorization: string) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  }) as unknown as ExecutionContext;
const bearer = async (sub: string) => `Bearer ${await signAccessToken({ sub, name: "x", color: "#000000", lvl: 1 })}`;

beforeAll(async () => {
  const d = await createDatabase("pglite://memory");
  db = d.db;
  close = d.close;
  access = new AccessService(db);
  await access.seed();
  const buildings = new BuildingsService(db);
  await buildings.seed();
  ledger = new LedgerService(db);
  mod = new ModerationService(db, access, ledger);
  svc = new ConsoleService(db, access, new OccupancyStore(), new EconomyService(db), ledger, buildings, new PresenceStore());
  rep = new ReportsService(db, access);
  const old = new Date(Date.now() - 40 * 86_400_000);
  await db.insert(users).values([
    { id: boss, email: "boss@example.com", username: "boss" },
    { id: boss2, email: "boss2@example.com", username: "boss2" },
    { id: support, phone: "+250788000333", username: "helper" },
    { id: itAdmin, email: "it@example.com", username: "itguy" },
    { id: p1, email: "one@example.com", username: "one", xp: 2250, lastSeenAt: new Date() }, // level 10
    { id: p2, phone: "+250788000444", username: "two", xp: 0, createdAt: old, lastSeenAt: old },
    { id: p3, email: "three@example.com", username: "=cmd", xp: 100 },
    { id: p4, email: "four@example.com", username: "four" },
  ]);
  await access.grant(boss, "super_admin", "test");
  await access.grant(boss2, "super_admin", "test");
  await access.grant(support, "support_agent", "test");
  await access.grant(itAdmin, "it_admin", "test");
});
afterAll(() => close());

describe("sanctions", () => {
  it("warns with a reason, shown in the history and the feed", async () => {
    const since = new Date(Date.now() - 1000);
    const r = await mod.sanction(support, p1, { kind: "warn", reason: "Spamming the plaza" });
    expect(r).toMatchObject({ kind: "warn", endsAt: null, status: "active" });
    const list = await mod.sanctionsFor(p1);
    expect(list[0]).toMatchObject({ kind: "warn", reason: "Spamming the plaza", createdByName: "helper", active: false });
    const feed = await mod.feed(since);
    expect(feed.events.find((e) => e.userId === p1)).toMatchObject({ kind: "warn", reason: "Spamming the plaza" });
  });

  it("mutes for N hours: in force, listed, in the feed (and in the first poll), lifted early", async () => {
    const since = new Date(Date.now() - 1000);
    const now = new Date();
    await mod.sanction(support, p1, { kind: "mute", reason: "Insults in chat", hours: 6 });
    const until = await mod.mutedUntil(p1);
    expect(Date.parse(until!) - now.getTime()).toBeGreaterThan(6 * HOUR - 5000);
    expect((await svc.listUsers({ q: "one" })).items[0]?.mutedUntil).toBe(until);
    expect((await mod.feed(since)).events.find((e) => e.userId === p1 && e.kind === "mute")?.until).toBe(until);
    expect((await mod.feed(null)).mutes).toContainEqual({ userId: p1, until });
    // a new mute replaces the one in force (one active row)
    await mod.sanction(support, p1, { kind: "mute", reason: "Insults again", hours: 24 });
    expect((await mod.sanctionsFor(p1)).filter((s) => s.kind === "mute" && s.active)).toHaveLength(1);
    // ... and ends early
    expect(await mod.lift(support, p1, "mute", "Apologised")).toMatchObject({ changed: true });
    expect(await mod.mutedUntil(p1)).toBeNull();
    expect((await mod.feed(since)).events.some((e) => e.userId === p1 && e.kind === "unmute")).toBe(true);
    expect((await mod.lift(support, p1, "mute", "Again")).changed).toBe(false);
  });

  it("a mute is over when its time is up (no sweep needed)", async () => {
    await mod.sanction(support, p4, { kind: "mute", reason: "Short mute", hours: 1 });
    expect(await mod.mutedUntil(p4, new Date(Date.now() + 2 * HOUR))).toBeNull();
    await mod.lift(support, p4, "mute", "cleanup");
  });

  it("suspends for N days and reactivates by itself when the time is up (audited as System)", async () => {
    await db.insert(refreshTokens).values({ id: id(900), userId: p2, tokenHash: "h-p2-1", device: "Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/130", expiresAt: new Date(Date.now() + 86_400_000) });
    const r = await mod.sanction(support, p2, { kind: "suspend", reason: "Cheating in a match", hours: 72 });
    expect(r.status).toBe("suspended");
    expect((await db.select().from(users).where(eq(users.id, p2)))[0]?.status).toBe("suspended");
    expect((await db.select().from(refreshTokens).where(eq(refreshTokens.id, id(900))))[0]?.revoked).toBe(true);
    expect(await mod.sweep(new Date(Date.now() + 71 * HOUR))).toEqual([]);
    expect(await mod.sweep(new Date(Date.now() + 73 * HOUR))).toEqual([p2]);
    expect((await db.select().from(users).where(eq(users.id, p2)))[0]?.status).toBe("active");
    const hist = (await svc.userDetail(p2)).history;
    expect(hist[0]).toMatchObject({ action: "user.reactivate", whoName: "System", detail: "Suspension ended" });
    expect((await mod.sanctionsFor(p2))[0]).toMatchObject({ kind: "suspend", liftedByName: "System", liftReason: "Suspension ended", active: false });
    expect(await mod.sweep(new Date(Date.now() + 80 * HOUR))).toEqual([]); // idempotent
  });

  it("suspends until lifted; reactivation needs a reason and is audited", async () => {
    await mod.sanction(support, p2, { kind: "suspend", reason: "Fraud review", hours: null });
    expect(await mod.sweep(new Date(Date.now() + 400 * 86_400_000))).toEqual([]);
    expect(await mod.lift(support, p2, "suspend", "Review cleared")).toEqual({ changed: true, status: "active" });
    expect((await svc.userDetail(p2)).history[0]).toMatchObject({ action: "user.reactivate", detail: "Review cleared", whoName: "helper" });
  });

  it("authority: not yourself, staff only by a Super Admin, never the last Super Admin, not a deleted account", async () => {
    await expect(mod.sanction(support, support, { kind: "warn", reason: "self" })).rejects.toMatchObject({ response: { code: "CANNOT_CHANGE_SELF" } });
    await expect(mod.sanction(support, boss, { kind: "mute", reason: "nope", hours: 1 })).rejects.toMatchObject({ response: { code: "SUPER_ADMIN_PROTECTED" } });
    await expect(mod.sanction(support, itAdmin, { kind: "warn", reason: "nope" })).rejects.toMatchObject({ response: { code: "STAFF_PROTECTED" } });
    await expect(mod.sanction(itAdmin, support, { kind: "warn", reason: "nope" })).rejects.toMatchObject({ response: { code: "STAFF_PROTECTED" } });
    await expect(mod.sanction(p1, p2, { kind: "warn", reason: "nope" })).rejects.toMatchObject({ response: { code: "ROLE_REQUIRED" } });
    await expect(mod.sanction(support, "nope", { kind: "warn", reason: "nope" })).rejects.toMatchObject({ response: { code: "BAD_ID" } });
    // a Super Admin may warn staff; boss2 can be suspended while boss stays
    expect((await mod.sanction(boss, itAdmin, { kind: "warn", reason: "Left the console open" })).kind).toBe("warn");
    await mod.sanction(boss, boss2, { kind: "suspend", reason: "Lost laptop", hours: 1 });
    await expect(mod.sanction("admin-token:ops", boss, { kind: "suspend", reason: "test", hours: null })).rejects.toMatchObject({ response: { code: "LAST_SUPER_ADMIN" } });
    await mod.lift(boss, boss2, "suspend", "Found it");
  });
});

describe("notes, sessions, sign out, username", () => {
  it("staff notes: internal, named, audited without their text", async () => {
    const n = await mod.addNote(support, p1, "Called them; they said a sibling used the account.");
    expect(n).toMatchObject({ createdByName: "helper" });
    expect((await mod.notesFor(p1))[0]?.body).toContain("sibling");
    const [a] = await db.select().from(accessAudit).where(eq(accessAudit.action, "user.note"));
    expect(a).toMatchObject({ target: `user:${p1}`, detail: null });
  });

  it("sessions: device summary only; sign out everywhere ends refresh and every earlier access token (API + staff routes)", async () => {
    await db.insert(refreshTokens).values([
      { id: id(901), userId: itAdmin, tokenHash: "h-it-1", device: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1", expiresAt: new Date(Date.now() + 86_400_000) },
      { id: id(902), userId: itAdmin, tokenHash: "h-it-2", device: null, expiresAt: new Date(Date.now() + 86_400_000) },
    ]);
    const s = await mod.sessionsFor(itAdmin);
    expect(s.map((x) => x.device).sort()).toEqual(["Safari on iOS", "Unknown device"]);
    expect(JSON.stringify(s)).not.toContain("h-it-");
    const t = await bearer(itAdmin);
    const auth = new AuthGuard(db);
    const roles = new RoleGuard(access, new Reflector());
    expect(await auth.canActivate(ctx(t))).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    expect(await mod.signOut(boss, itAdmin, "Phone stolen")).toEqual({ id: itAdmin, signedOut: 2 });
    expect(await mod.sessionsFor(itAdmin)).toEqual([]);
    await expect(auth.canActivate(ctx(t))).rejects.toMatchObject({ response: { code: "SESSION_REVOKED" } });
    await expect(roles.canActivate(ctx(t))).rejects.toMatchObject({ response: { code: "SESSION_REVOKED" } });
    // the account itself stays active: a token issued after the revoke works (next second)
    await new Promise((r) => setTimeout(r, 1100));
    expect(await auth.canActivate(ctx(await bearer(itAdmin)))).toBe(true);
  });

  it("username reset: a neutral name that passes the shared rule; the old one stays in the staff audit", async () => {
    const r = await mod.resetUsername(support, p3, "Offensive name");
    expect(r.username).toMatch(/^player_[0-9a-f]{6}$/);
    expect(USERNAME_RE.test(r.username)).toBe(true);
    const d = await svc.userDetail(p3);
    expect(d.username).toBe(r.username);
    expect(d.history[0]).toMatchObject({ action: "user.rename" });
    expect(d.history[0]?.detail).toContain("from==cmd");
  });

  it("reveal: Super Admin only, with a reason, audited", async () => {
    await expect(mod.reveal(support, p1, "email", "check")).rejects.toMatchObject({ response: { code: "ROLE_REQUIRED" } });
    expect(await mod.reveal(boss, p1, "email", "Player asked by phone")).toEqual({ field: "email", value: "one@example.com" });
    expect((await svc.userDetail(p1)).history[0]).toMatchObject({ action: "user.reveal" });
  });
});

describe("delete + anonymise", () => {
  it("Super Admin only; typed confirmation; refused with coins or a staff role; ledger untouched", async () => {
    const v = 1;
    await ledger.post({ type: "test_coins", idempotencyKey: "coins:p4", createdBy: "test", economyVersion: v, lines: [
      { account: { ownerType: "platform", ownerId: PLATFORM_ID, kind: "budget", currency: "COIN", allowNegative: true }, amount: 500, direction: "D" },
      { account: userCoins(p4), amount: 500, direction: "C" },
    ] });
    await ledger.post({ type: "stars_daily", idempotencyKey: "stars:p1", createdBy: "test", economyVersion: v, lines: [
      { account: { ownerType: "platform", ownerId: PLATFORM_ID, kind: "budget", currency: "STAR", allowNegative: true }, amount: 250, direction: "D" },
      { account: userStars(p1), amount: 250, direction: "C" },
    ] });
    await db.insert(userBlocks).values({ userId: p1, blockedId: p2 });
    await expect(mod.deleteAccount(support, p1, "one", "asked")).rejects.toMatchObject({ response: { code: "ROLE_REQUIRED" } });
    await expect(mod.deleteAccount(boss, p1, "One", "asked")).rejects.toMatchObject({ response: { code: "CONFIRM_MISMATCH" } });
    await expect(mod.deleteAccount(boss, p4, "four", "asked")).rejects.toMatchObject({ response: { code: "BALANCE_NOT_ZERO" } });
    await expect(mod.deleteAccount(boss, support, "helper", "asked")).rejects.toMatchObject({ response: { code: "STAFF_ROLES_HELD" } });
    const entriesBefore = (await db.select().from(journalEntries)).length;
    expect(await mod.deleteAccount(boss, p1, "one", "Player asked to delete their account")).toEqual({ id: p1, status: "deleted" });
    const [u] = await db.select().from(users).where(eq(users.id, p1));
    expect(u).toMatchObject({ status: "deleted", username: null, email: null, phone: null, look: null });
    expect(u?.deletedAt).toBeInstanceOf(Date);
    expect(await db.select().from(userBlocks).where(eq(userBlocks.userId, p1))).toEqual([]);
    expect((await db.select().from(journalEntries)).length).toBe(entriesBefore);
    expect(await ledger.balance(userStars(p1))).toBe(250);
    // gone from the default list; found with status=deleted; no further actions
    expect((await svc.listUsers({})).items.some((x) => x.id === p1)).toBe(false);
    expect((await svc.listUsers({ status: "deleted" })).items.map((x) => x.id)).toEqual([p1]);
    await expect(mod.sanction(support, p1, { kind: "warn", reason: "late" })).rejects.toMatchObject({ response: { code: "ACCOUNT_DELETED" } });
    expect((await mod.feed(new Date(Date.now() - 2000))).events.some((e) => e.userId === p1 && e.kind === "suspend")).toBe(true);
  });
});

describe("search, export, reports, limits, schemas", () => {
  it("filters by role, level range, joined dates and last seen", async () => {
    const ids = async (f: Parameters<ConsoleService["listUsers"]>[0]) => (await svc.listUsers(f)).items.map((u) => u.id).sort();
    expect(await ids({ role: "super_admin" })).toEqual([boss, boss2].sort());
    expect(await ids({ minLevel: 2, maxLevel: 9 })).toEqual([p3]); // xp 100 = level 2
    expect(await ids({ maxLevel: 1, role: "" as never })).toContain(p2);
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10);
    expect(await ids({ joinedTo: old })).toEqual([p2]);
    expect(await ids({ seen: -30 })).toContain(p2);
    expect(await ids({ seen: 7 })).not.toContain(p2);
  });

  it("CSV export: masked contacts, formula-safe cells, row cap", async () => {
    const r = await svc.exportUsers({});
    expect(r.csv.split("\r\n")[0]).toBe("id,username,email,phone,level,status,roles,joined,last_seen,muted_until");
    expect(r.csv).not.toContain("four@example.com");
    expect(r.csv).not.toContain("+250788000444");
    expect(r.truncated).toBe(false);
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell(null)).toBe("");
  });

  it("reports queue: lists open reports with names, closes them with a note (audited), not twice", async () => {
    await db.insert(reports).values([
      { id: id(800), reporterId: p2, targetId: p4, reason: "harassment", details: "kept following me", context: { area: "plaza", lines: ["go away"] } },
      { id: id(801), reporterId: p3, targetId: p4, reason: "scam", details: null },
    ]);
    const open = await rep.list("open");
    expect(open.open).toBe(2);
    expect(open.items[0]).toMatchObject({ target: { id: p4, username: "four" }, openAgainstTarget: 2 });
    expect(await rep.resolve(support, id(800), "resolved", "Muted for 24 hours")).toEqual({ id: id(800), status: "resolved" });
    await expect(rep.resolve(support, id(800), "dismissed", "again")).rejects.toMatchObject({ response: { code: "REPORT_CLOSED" } });
    await expect(rep.resolve(p4, id(801), "dismissed", "mine")).rejects.toMatchObject({ response: { code: "CANNOT_CHANGE_SELF" } });
    const closed = await rep.list("resolved");
    expect(closed.items[0]).toMatchObject({ resolvedByName: "helper", resolution: "Muted for 24 hours" });
    expect((await svc.userDetail(p4)).history[0]).toMatchObject({ action: "report.resolve", detail: "harassment: Muted for 24 hours" });
    expect((await svc.userDetail(p4)).openReports).toBe(1);
  });

  it("staff rate limits: 429 RATE_LIMITED with the wait, per actor and kind", () => {
    const l = new StaffLimits();
    for (let i = 0; i < 5; i++) l.hit("a", "export", 1000 + i);
    expect(() => l.hit("a", "export", 2000)).toThrow(expect.objectContaining({ status: 429, response: expect.objectContaining({ code: "RATE_LIMITED" }) }));
    expect(() => l.hit("b", "export", 2000)).not.toThrow();
    expect(() => l.hit("a", "mutate", 2000)).not.toThrow();
    expect(() => l.hit("a", "export", 1000 + 10 * 60_000 + 1)).not.toThrow();
  });

  it("schemas: reasons 3–200, bounded durations, notes, search ranges", () => {
    expect(SanctionSchema.safeParse({ kind: "warn", reason: "ok" }).success).toBe(false);
    expect(SanctionSchema.safeParse({ kind: "warn", reason: "x".repeat(201) }).success).toBe(false);
    expect(SanctionSchema.safeParse({ kind: "mute", reason: "spam", hours: 0 }).success).toBe(false);
    expect(SanctionSchema.safeParse({ kind: "mute", reason: "spam", hours: null }).success).toBe(false);
    expect(SanctionSchema.safeParse({ kind: "mute", reason: "spam", hours: 721 }).success).toBe(false);
    expect(SanctionSchema.safeParse({ kind: "suspend", reason: "fraud", hours: null }).success).toBe(true);
    expect(SanctionSchema.safeParse({ kind: "suspend", reason: "fraud", hours: 1.5 }).success).toBe(false);
    expect(SanctionSchema.safeParse({ kind: "ban", reason: "fraud" }).success).toBe(false);
    expect(StaffNoteSchema.safeParse({ body: "  a " }).success).toBe(false);
    expect(DeleteAccountSchema.safeParse({ reason: "asked", confirm: "" }).success).toBe(false);
    expect(UserSearchSchema.parse({ minLevel: "3", maxLevel: "", status: "" })).toEqual({ minLevel: 3, maxLevel: undefined, status: undefined });
    expect(UserSearchSchema.safeParse({ minLevel: "9", maxLevel: "3" }).success).toBe(false);
    expect(UserSearchSchema.safeParse({ joinedFrom: "2026-02-01", joinedTo: "2026-01-01" }).success).toBe(false);
    expect(UserSearchSchema.safeParse({ joinedFrom: "yesterday" }).success).toBe(false);
    expect(UserSearchSchema.safeParse({ role: "Robert'); DROP" }).success).toBe(false);
    expect(deviceLabel("curl/8.0")).toBe("Script");
  });
});
