import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { accessAudit, createDatabase, users, type Database } from "@gukirana/db";
import { SEED_OFFICES, SEED_ROLES } from "@gukirana/contracts";
import { signAccessToken } from "../../common/auth.js";
import { env } from "../../common/env.js";
import { AccessService } from "./access.service.js";
import { OccupancyStore, OCCUPANCY_STALE_MS } from "./occupancy.js";
import { RoleGuard } from "./role.guard.js";

let db: Database;
let close: () => Promise<void>;
let access: AccessService;

const boss = "aaaaaaaa-0000-4000-8000-000000000001";
const tech = "aaaaaaaa-0000-4000-8000-000000000002";
const player = "aaaaaaaa-0000-4000-8000-000000000003";

beforeAll(async () => {
  const d = await createDatabase("pglite://memory");
  db = d.db;
  close = d.close;
  access = new AccessService(db);
  await db.insert(users).values([
    { id: boss, email: "boss@example.com", username: "boss" },
    { id: tech, phone: "+250788123456", username: "tech" },
    { id: player, email: "player@example.com", username: "player" },
  ]);
});
afterAll(() => close());

describe("AccessService seed", () => {
  it("seeds the contract offices and roles once (idempotent)", async () => {
    expect(await access.seed()).toEqual({ offices: SEED_OFFICES.length, roles: SEED_ROLES.length });
    expect(await access.seed()).toEqual({ offices: 0, roles: 0 });
    const offs = await access.listOffices();
    expect(offs.map((o) => o.id)).toEqual(["super-admin", "it-office", "accountant", "customer-support"]);
    const roles = await access.listRoles();
    expect(roles.map((r) => r.id)).toEqual(["accountant", "it_admin", "super_admin", "support_agent"]);
    expect(roles.find((r) => r.id === "super_admin")).toMatchObject({
      allOffices: true,
      offices: ["super-admin"],
    });
    expect(roles.find((r) => r.id === "it_admin")).toMatchObject({
      allOffices: false,
      offices: ["it-office"],
    });
    expect(roles.find((r) => r.id === "support_agent")?.offices).toEqual(["customer-support"]);
  });

  it("keeps admin edits: a removed seed assignment is not re-added on restart", async () => {
    await access.unassign("accountant", "accountant", "test");
    await access.seed();
    expect((await access.listRoles()).find((r) => r.id === "accountant")?.offices).toEqual([]);
    await access.assign("accountant", "accountant", "test");
  });
});

describe("AccessService roles, offices, grants", () => {
  it("creates a role with office assignments, rejects duplicates and unknown offices", async () => {
    const r = await access.createRole(
      { id: "auditor", name: "Auditor", offices: ["accountant", "it-office"] },
      "test",
    );
    expect(r).toMatchObject({
      id: "auditor",
      allOffices: false,
      offices: ["accountant", "it-office"],
      holders: 0,
    });
    await expect(access.createRole({ id: "auditor", name: "Again" }, "test")).rejects.toThrow();
    await expect(
      access.createRole({ id: "ghost", name: "Ghost", offices: ["nowhere"] }, "test"),
    ).rejects.toThrow();
    expect((await access.listRoles()).some((x) => x.id === "ghost")).toBe(false);
  });

  it("assigns / unassigns idempotently and updates a role", async () => {
    expect((await access.assign("auditor", "customer-support", "test")).changed).toBe(true);
    expect((await access.assign("auditor", "customer-support", "test")).changed).toBe(false);
    expect((await access.unassign("auditor", "it-office", "test")).changed).toBe(true);
    const r = await access.updateRole(
      "auditor",
      { name: "Internal auditor", description: "reads books" },
      "test",
    );
    expect(r).toMatchObject({
      name: "Internal auditor",
      description: "reads books",
      offices: ["accountant", "customer-support"],
    });
    await expect(access.assign("auditor", "nowhere", "test")).rejects.toThrow();
    await expect(access.assign("nobody", "accountant", "test")).rejects.toThrow();
  });

  it("protects super_admin", async () => {
    await expect(access.deleteRole("super_admin", "test")).rejects.toThrow();
    await expect(access.updateRole("super_admin", { allOffices: false }, "test")).rejects.toThrow();
  });

  it("grants by username, email, phone or id; canEnter follows the roles", async () => {
    expect((await access.officesFor(player)).every((o) => !o.canEnter)).toBe(true);
    expect(await access.access(player)).toEqual({ roles: [], offices: [] });

    expect((await access.grant("0788123456", "it_admin", "test")).userId).toBe(tech); // Rwandan phone, normalised
    expect(await access.access(tech)).toEqual({ roles: ["it_admin"], offices: ["it-office"] });
    const dir = await access.officesFor(tech, { "it-office": 2 });
    expect(dir.find((o) => o.id === "it-office")).toMatchObject({ canEnter: true, occupants: 2 });
    expect(dir.find((o) => o.id === "accountant")).toMatchObject({ canEnter: false, occupants: 0 });

    await access.grant("BOSS@example.com", "super_admin", "test");
    expect((await access.access(boss)).offices).toEqual(SEED_OFFICES.map((o) => o.id)); // all offices
    await access.grant("player", "auditor", "test");
    expect((await access.access(player)).offices).toEqual(["accountant", "customer-support"]);
    expect((await access.grant(player, "auditor", "test")).changed).toBe(false);
    await expect(access.grant("nobody-here", "auditor", "test")).rejects.toThrow();
    await expect(access.grant("player", "no_such_role", "test")).rejects.toThrow();

    // a new office is open to the all-offices role at once
    await access.createOffice({ id: "archive", name: "Archive", sort: 50 }, "test");
    expect((await access.access(boss)).offices).toContain("archive");
    expect((await access.access(tech)).offices).not.toContain("archive");
    await access.deleteOffice("archive", "test");
  });

  it("lists users with roles (masked contacts) and searches", async () => {
    const list = await access.listUsers();
    expect(list.map((u) => u.username).sort()).toEqual(["boss", "player", "tech"]);
    const t = list.find((u) => u.id === tech)!;
    expect(t.phone).not.toContain("123");
    expect(t.roles.map((r) => r.role)).toEqual(["it_admin"]);
    expect((await access.listUsers("pla")).map((u) => u.id)).toEqual([player]);
  });

  it("revokes and deletes (cascades grants)", async () => {
    expect((await access.revoke("tech", "it_admin", "test")).changed).toBe(true);
    expect((await access.access(tech)).roles).toEqual([]);
    await access.deleteRole("auditor", "test");
    expect((await access.access(player)).roles).toEqual([]);
  });

  it("audits every change", async () => {
    const log = await db.select().from(accessAudit);
    const actions = new Set(log.map((l) => l.action));
    for (const a of [
      "seed",
      "role.create",
      "role.update",
      "role.delete",
      "role.assign",
      "role.unassign",
      "office.create",
      "office.delete",
      "user.grant",
      "user.revoke",
    ])
      expect(actions).toContain(a);
    expect((await access.auditLog(5)).length).toBe(5);
  });
});

describe("bootstrap super admins", () => {
  it("grants super_admin only when the env lists the user's email or phone", async () => {
    const u = { id: tech, email: null, phone: "+250788123456" };
    expect(await access.bootstrap(u, undefined)).toBe(false);
    expect(await access.bootstrap(u, "someone@else.com")).toBe(false);
    expect((await access.access(tech)).roles).toEqual([]);
    expect(await access.bootstrap(u, " someone@else.com , 0788 123 456")).toBe(true);
    expect((await access.access(tech)).roles).toEqual(["super_admin"]);
    expect(await access.bootstrap(u, "0788123456")).toBe(false); // already held
    await access.revoke(tech, "super_admin", "test");
  });
});

describe("OccupancyStore", () => {
  it("sums room snapshots and drops stale ones", () => {
    const s = new OccupancyStore();
    s.report("r1", { "it-office": 1 }, 1000);
    s.report("r2", { "it-office": 2, accountant: 1 }, 1000);
    expect(s.totals(2000)).toEqual({ "it-office": 3, accountant: 1 });
    s.report("r2", {}, 3000);
    expect(s.totals(3000)).toEqual({ "it-office": 1 });
    expect(s.totals(1000 + OCCUPANCY_STALE_MS + 1)).toEqual({});
  });
});

describe("RoleGuard", () => {
  const ctx = (headers: Record<string, string>) => {
    const req: { headers: Record<string, string>; actor?: string } = { headers };
    const c = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => () => undefined,
      getClass: () => class {},
    } as unknown as ExecutionContext;
    return { c, req };
  };
  const guard = () => new RoleGuard(access, new Reflector());
  const bearer = async (sub: string) => ({
    authorization: `Bearer ${await signAccessToken({ sub, name: "x", color: "#000000", lvl: 1 })}`,
  });

  it("lets a super admin through and records the actor", async () => {
    const { c, req } = ctx(await bearer(boss));
    expect(await guard().canActivate(c)).toBe(true);
    expect(req.actor).toBe(boss);
  });
  it("refuses other roles, players and missing / bad tokens", async () => {
    await access.grant(tech, "it_admin", "test");
    await expect(guard().canActivate(ctx(await bearer(tech)).c)).rejects.toThrow();
    await expect(guard().canActivate(ctx(await bearer(player)).c)).rejects.toThrow();
    await expect(guard().canActivate(ctx({}).c)).rejects.toThrow();
    await expect(guard().canActivate(ctx({ authorization: "Bearer nope" }).c)).rejects.toThrow();
  });
  it("keeps the back-office x-admin-token path", async () => {
    const { c, req } = ctx({ "x-admin-token": env().ADMIN_SERVICE_TOKEN, "x-admin-user": "ops" });
    expect(await guard().canActivate(c)).toBe(true);
    expect(req.actor).toBe("admin-token:ops");
    await expect(guard().canActivate(ctx({ "x-admin-token": "wrong-token-value" }).c)).rejects.toThrow();
  });
  it("a revoke takes effect on the next request", async () => {
    await access.grant(player, "super_admin", "test");
    expect(await guard().canActivate(ctx(await bearer(player)).c)).toBe(true);
    await access.revoke(player, "super_admin", "test");
    await expect(guard().canActivate(ctx(await bearer(player)).c)).rejects.toThrow();
  });
});
