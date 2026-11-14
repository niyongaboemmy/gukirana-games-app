import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, users, type Database } from "@gukirana/db";
import { sectionsFor } from "@gukirana/contracts";
import { AccessService } from "../admin-block/access.service.js";
import { OccupancyStore } from "../admin-block/occupancy.js";
import { EconomyService } from "../economy/economy.service.js";
import { LedgerService } from "../ledger/ledger.service.js";
import { BuildingsService } from "./buildings.service.js";
import { ConsoleService, kigaliDayStart } from "./console.service.js";
import { PRESENCE_STALE_MS, PresenceStore } from "./presence.js";

let db: Database;
let close: () => Promise<void>;
let access: AccessService;
let buildings: BuildingsService;
let svc: ConsoleService;

const boss = "bbbbbbbb-0000-4000-8000-000000000001";
const support = "bbbbbbbb-0000-4000-8000-000000000002";
const player = "bbbbbbbb-0000-4000-8000-000000000003";
const accountant = "bbbbbbbb-0000-4000-8000-000000000004";

beforeAll(async () => {
  const d = await createDatabase("pglite://memory");
  db = d.db;
  close = d.close;
  access = new AccessService(db);
  await access.seed();
  buildings = new BuildingsService(db);
  await buildings.seed();
  svc = new ConsoleService(db, access, new OccupancyStore(), new EconomyService(db), new LedgerService(db), buildings, new PresenceStore());
  await db.insert(users).values([
    { id: boss, email: "boss@example.com", username: "boss" },
    { id: support, phone: "+250788000222", username: "helper" },
    { id: player, email: "player@example.com", username: "player", xp: 2250 },
    { id: accountant, email: "money@example.com", username: "money" },
  ]);
  await access.grant(boss, "super_admin", "test");
  await access.grant(support, "support_agent", "test");
  await access.grant(accountant, "accountant", "test");
});
afterAll(() => close());

describe("console sections", () => {
  it("grants sections by role", () => {
    expect(sectionsFor(["super_admin"])).toEqual(["overview", "visitors", "users", "buildings", "monitor", "roles", "finance"]);
    expect(sectionsFor(["accountant"])).toEqual(["overview", "visitors", "finance"]);
    expect(sectionsFor(["support_agent"])).toEqual(["overview", "visitors", "users"]);
    expect(sectionsFor([])).toEqual([]);
  });

  it("overview hides what the role may not see", async () => {
    const forAccountant = await svc.overview(accountant);
    expect(forAccountant.users).toBeNull();
    expect(forAccountant.audit).toBeNull();
    expect(forAccountant.finance).not.toBeNull();
    const forBoss = await svc.overview(boss);
    expect(forBoss.users?.total).toBe(4);
    expect(forBoss.buildings.map((b) => b.id)).toEqual(["pool", "ludo", "igisoro", "arena", "admin"]);
  });
});

describe("users", () => {
  it("lists with masked contacts, level and roles; filters by text", async () => {
    const all = await svc.listUsers(undefined, undefined, 0);
    expect(all.items).toHaveLength(4);
    const p = (await svc.listUsers("play", undefined, 0)).items[0]!;
    expect(p).toMatchObject({ username: "player", level: 10, status: "active", roles: [] });
    expect(p.email).not.toBe("player@example.com");
    expect((await svc.listUsers("helper", undefined, 0)).items[0]?.roles).toEqual(["support_agent"]);
  });

  it("support can suspend a player, with an audited reason; reactivates too", async () => {
    expect(await svc.setStatus(support, player, "suspended", "abusive chat")).toEqual({ id: player, status: "suspended", changed: true });
    expect((await svc.listUsers(undefined, "suspended", 0)).items.map((u) => u.id)).toEqual([player]);
    const d = await svc.userDetail(player);
    expect(d.history[0]).toMatchObject({ action: "user.suspend", detail: "abusive chat", who: support });
    expect((await svc.setStatus(support, player, "active", "appeal accepted")).changed).toBe(true);
  });

  it("protects super admins and self, and needs a status role", async () => {
    await expect(svc.setStatus(support, boss, "suspended", "test")).rejects.toMatchObject({ response: { code: "SUPER_ADMIN_PROTECTED" } });
    await expect(svc.setStatus(boss, boss, "suspended", "test")).rejects.toMatchObject({ response: { code: "CANNOT_CHANGE_SELF" } });
    await expect(svc.setStatus(accountant, player, "suspended", "test")).rejects.toMatchObject({ response: { code: "ROLE_REQUIRED" } });
  });
});

describe("buildings + presence", () => {
  it("closes and reopens a building; the closed message clears on reopen", async () => {
    const c = await buildings.set("pool", false, "Maintenance until 18:00", boss);
    expect(c).toMatchObject({ open: false, message: "Maintenance until 18:00", updatedBy: boss });
    expect(await buildings.isOpen("pool")).toBe(false);
    expect((await buildings.set("pool", true, "ignored", boss)).message).toBe("");
    expect(await buildings.isOpen("pool")).toBe(true);
  });

  it("sums rooms per area and drops stale rooms", () => {
    const p = new PresenceStore();
    p.report("r1", "plaza", 5, 3, 1000);
    p.report("r2", "plaza", 2, 2, 1000);
    p.report("r3", "hall:pool", 4, 9, 1000);
    expect(p.totals(2000)).toEqual({ total: 11, signedIn: 9, byArea: { plaza: 7, "hall:pool": 4 } });
    p.report("r2", "plaza", 0, 0, 1500);
    expect(p.totals(1000 + PRESENCE_STALE_MS + 1)).toEqual({ total: 0, signedIn: 0, byArea: {} });
  });

  it("Kigali day starts at 22:00 UTC the day before", () => {
    expect(kigaliDayStart(new Date("2026-11-14T21:59:00Z")).toISOString()).toBe("2026-11-13T22:00:00.000Z");
    expect(kigaliDayStart(new Date("2026-11-14T22:01:00Z")).toISOString()).toBe("2026-11-14T22:00:00.000Z");
  });
});
