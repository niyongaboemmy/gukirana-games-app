import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from "@nestjs/common";
import {
  accessAudit,
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  offices,
  or,
  roleOffices,
  roles,
  userRoles,
  users,
} from "@gukirana/db";
import { SEED_OFFICES, SEED_ROLES, type MyRoles, type OfficeSummary } from "@gukirana/contracts";
import { createLogger } from "@gukirana/observability";
import { DB, type Db } from "../../common/db.module.js";
import { newId } from "../../common/ids.js";
import { maskEmail, maskPhone, parseLoginId } from "../identity/phone.js";

const log = createLogger("access");
export const SUPER_ADMIN = "super_admin";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RoleInput {
  id: string;
  name: string;
  description?: string;
  allOffices?: boolean;
  offices?: string[];
}
export interface OfficeInput {
  id: string;
  name: string;
  description?: string;
  sort?: number;
}

/**
 * Administrative Block access control (P2-ADM-03). Roles, offices and role → office assignments live in the DB;
 * the seed (contract SEED_ROLES / SEED_OFFICES) only fills what is missing, so admin edits survive restarts.
 * Every change is audited in `access_audit`.
 */
@Injectable()
export class AccessService implements OnModuleInit {
  constructor(@Inject(DB) private readonly db: Db) {}

  async onModuleInit(): Promise<void> {
    const r = await this.seed();
    if (r.offices || r.roles) log.info(r, "admin block seeded");
  }

  /** Idempotent: inserts missing seed offices / roles; a seed role's office assignment is added only when the role itself is new. */
  async seed(): Promise<{ offices: number; roles: number }> {
    const o = await this.db
      .insert(offices)
      .values(
        SEED_OFFICES.map((x, i) => ({
          id: x.id,
          name: x.name,
          description: x.description,
          sort: (i + 1) * 10,
        })),
      )
      .onConflictDoNothing()
      .returning();
    const r = await this.db
      .insert(roles)
      .values(SEED_ROLES.map((x) => ({ id: x.id, name: x.name, allOffices: x.all })))
      .onConflictDoNothing()
      .returning();
    const fresh = new Set(r.map((x) => x.id));
    const links = SEED_ROLES.filter((x) => fresh.has(x.id)).flatMap((x) =>
      x.offices.map((officeId) => ({ roleId: x.id, officeId })),
    );
    if (links.length) await this.db.insert(roleOffices).values(links).onConflictDoNothing();
    if (o.length || r.length)
      await this.audit(
        "seed",
        "seed",
        "admin-block",
        `offices=${o.map((x) => x.id).join(",")} roles=${r.map((x) => x.id).join(",")}`,
      );
    return { offices: o.length, roles: r.length };
  }

  // ------------------------------------------------------------------ reads

  /**
   * The user's roles and every office those roles open (all offices for an `all_offices` role). A suspended (any
   * non-active) account holds no roles while it is not active (GAP-002): RoleGuard, the console and the realtime
   * office doors (via /internal/access) all read this, fresh from the DB.
   */
  async access(userId: string): Promise<MyRoles> {
    if (!UUID.test(userId)) return { roles: [], offices: [] };
    if (!(await this.isActive(userId))) return { roles: [], offices: [] };
    const held = await this.db
      .select({ id: roles.id, all: roles.allOffices })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, userId))
      .orderBy(asc(roles.id));
    if (!held.length) return { roles: [], offices: [] };
    const all = await this.db
      .select({ id: offices.id })
      .from(offices)
      .orderBy(asc(offices.sort), asc(offices.id));
    let open: string[];
    if (held.some((h) => h.all)) open = all.map((x) => x.id);
    else {
      const linked = new Set(
        (
          await this.db
            .select({ id: roleOffices.officeId })
            .from(roleOffices)
            .where(
              inArray(
                roleOffices.roleId,
                held.map((h) => h.id),
              ),
            )
        ).map((x) => x.id),
      );
      open = all.map((x) => x.id).filter((id) => linked.has(id));
    }
    return { roles: held.map((h) => h.id), offices: open };
  }

  /** an existing account whose status is `active` (fresh read; staff powers must not lag a suspension) */
  async isActive(userId: string): Promise<boolean> {
    if (!UUID.test(userId)) return false;
    const [u] = await this.db.select({ status: users.status }).from(users).where(eq(users.id, userId));
    return u?.status === "active";
  }

  async hasRole(userId: string, role: string): Promise<boolean> {
    if (!UUID.test(userId) || !(await this.isActive(userId))) return false;
    const [row] = await this.db
      .select({ r: userRoles.roleId })
      .from(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, role)));
    return !!row;
  }

  /** Reception directory for a viewer: every office, whether they may walk in, and staff inside (from realtime). */
  async officesFor(userId: string, occupancy: Record<string, number> = {}): Promise<OfficeSummary[]> {
    const mine = new Set((await this.access(userId)).offices);
    const all = await this.db.select().from(offices).orderBy(asc(offices.sort), asc(offices.id));
    return all.map((o) => ({
      id: o.id,
      name: o.name,
      description: o.description,
      canEnter: mine.has(o.id),
      occupants: Math.max(0, Math.floor(occupancy[o.id] ?? 0)),
    }));
  }

  /** Every known office id (realtime refuses unknown doors). */
  async officeIds(): Promise<string[]> {
    return (
      await this.db.select({ id: offices.id }).from(offices).orderBy(asc(offices.sort), asc(offices.id))
    ).map((x) => x.id);
  }

  async listRoles() {
    const rs = await this.db.select().from(roles).orderBy(asc(roles.id));
    const links = await this.db.select().from(roleOffices);
    const holders = await this.db.select({ roleId: userRoles.roleId }).from(userRoles);
    return rs.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      allOffices: r.allOffices,
      offices: links
        .filter((l) => l.roleId === r.id)
        .map((l) => l.officeId)
        .sort(),
      holders: holders.filter((h) => h.roleId === r.id).length,
      createdAt: r.createdAt,
    }));
  }

  async listOffices() {
    return this.db.select().from(offices).orderBy(asc(offices.sort), asc(offices.id));
  }

  /** Users holding a role (default) or matching a search (username / email / phone prefix), with their roles. */
  async listUsers(q?: string) {
    const term = q?.trim().slice(0, 60);
    let ids: string[];
    if (term) {
      const like = `%${term.replace(/[%_\\]/g, "")}%`;
      const found = await this.db
        .select({ id: users.id })
        .from(users)
        .where(
          or(
            ilike(users.username, like),
            ilike(users.email, like),
            ilike(users.phone, like),
            UUID.test(term) ? eq(users.id, term) : undefined,
          ),
        )
        .limit(50);
      ids = found.map((x) => x.id);
    } else
      ids = [...new Set((await this.db.select({ u: userRoles.userId }).from(userRoles)).map((x) => x.u))];
    if (!ids.length) return [];
    const us = await this.db.select().from(users).where(inArray(users.id, ids)).orderBy(asc(users.username));
    const grants = await this.db.select().from(userRoles).where(inArray(userRoles.userId, ids));
    return us.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email ? maskEmail(u.email) : null,
      phone: u.phone ? maskPhone(u.phone) : null,
      roles: grants
        .filter((g) => g.userId === u.id)
        .map((g) => ({ role: g.roleId, grantedBy: g.grantedBy, grantedAt: g.grantedAt }))
        .sort((a, b) => a.role.localeCompare(b.role)),
    }));
  }

  async auditLog(limit = 100) {
    return this.db
      .select()
      .from(accessAudit)
      .orderBy(desc(accessAudit.at))
      .limit(Math.max(1, Math.min(500, limit)));
  }

  // ------------------------------------------------------------------ roles

  async createRole(input: RoleInput, who: string) {
    const officeIds = [...new Set(input.offices ?? [])];
    await this.requireOffices(officeIds);
    const [created] = await this.db
      .insert(roles)
      .values({
        id: input.id,
        name: input.name,
        description: input.description ?? "",
        allOffices: input.allOffices ?? false,
      })
      .onConflictDoNothing()
      .returning();
    if (!created) throw new ConflictException({ code: "ROLE_EXISTS" });
    if (officeIds.length)
      await this.db
        .insert(roleOffices)
        .values(officeIds.map((officeId) => ({ roleId: input.id, officeId })))
        .onConflictDoNothing();
    await this.audit(
      who,
      "role.create",
      `role:${input.id}`,
      JSON.stringify({ name: input.name, allOffices: created.allOffices, offices: officeIds }),
    );
    return (await this.listRoles()).find((r) => r.id === input.id)!;
  }

  async updateRole(id: string, patch: Partial<Omit<RoleInput, "id" | "offices">>, who: string) {
    await this.requireRole(id);
    if (id === SUPER_ADMIN && patch.allOffices === false)
      throw new BadRequestException({ code: "SUPER_ADMIN_OPENS_ALL" });
    const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (Object.keys(set).length) await this.db.update(roles).set(set).where(eq(roles.id, id));
    await this.audit(who, "role.update", `role:${id}`, JSON.stringify(set));
    return (await this.listRoles()).find((r) => r.id === id)!;
  }

  async deleteRole(id: string, who: string) {
    if (id === SUPER_ADMIN) throw new BadRequestException({ code: "SUPER_ADMIN_PROTECTED" });
    await this.requireRole(id);
    const holders = await this.db
      .select({ u: userRoles.userId })
      .from(userRoles)
      .where(eq(userRoles.roleId, id));
    await this.db.delete(roles).where(eq(roles.id, id)); // cascades role_offices + user_roles
    await this.audit(who, "role.delete", `role:${id}`, `holders=${holders.length}`);
    return { deleted: id };
  }

  async assign(roleId: string, officeId: string, who: string) {
    await this.requireRole(roleId);
    await this.requireOffices([officeId]);
    const added = await this.db
      .insert(roleOffices)
      .values({ roleId, officeId })
      .onConflictDoNothing()
      .returning();
    if (added.length) await this.audit(who, "role.assign", `role:${roleId}`, `office=${officeId}`);
    return { roleId, officeId, changed: added.length > 0 };
  }

  async unassign(roleId: string, officeId: string, who: string) {
    const gone = await this.db
      .delete(roleOffices)
      .where(and(eq(roleOffices.roleId, roleId), eq(roleOffices.officeId, officeId)))
      .returning();
    if (gone.length) await this.audit(who, "role.unassign", `role:${roleId}`, `office=${officeId}`);
    return { roleId, officeId, changed: gone.length > 0 };
  }

  // ------------------------------------------------------------------ offices

  async createOffice(input: OfficeInput, who: string) {
    const [created] = await this.db
      .insert(offices)
      .values({
        id: input.id,
        name: input.name,
        description: input.description ?? "",
        sort: input.sort ?? 100,
      })
      .onConflictDoNothing()
      .returning();
    if (!created) throw new ConflictException({ code: "OFFICE_EXISTS" });
    await this.audit(
      who,
      "office.create",
      `office:${input.id}`,
      JSON.stringify({ name: input.name, sort: created.sort }),
    );
    return created;
  }

  async updateOffice(id: string, patch: Partial<Omit<OfficeInput, "id">>, who: string) {
    await this.requireOffices([id]);
    const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (Object.keys(set).length) await this.db.update(offices).set(set).where(eq(offices.id, id));
    await this.audit(who, "office.update", `office:${id}`, JSON.stringify(set));
    const [o] = await this.db.select().from(offices).where(eq(offices.id, id));
    return o!;
  }

  async deleteOffice(id: string, who: string) {
    await this.requireOffices([id]);
    await this.db.delete(offices).where(eq(offices.id, id)); // cascades role_offices
    await this.audit(who, "office.delete", `office:${id}`, null);
    return { deleted: id };
  }

  // ------------------------------------------------------------------ grants

  /** user id, username, email or phone (Rwandan / E.164) → user */
  async findUser(identifier: string) {
    const s = identifier.trim();
    if (!s) return null;
    if (UUID.test(s)) return (await this.db.select().from(users).where(eq(users.id, s)))[0] ?? null;
    const login = parseLoginId(s);
    if (login) {
      const [u] = await this.db
        .select()
        .from(users)
        .where(login.kind === "email" ? eq(users.email, login.value) : eq(users.phone, login.value));
      if (u) return u;
    }
    return (await this.db.select().from(users).where(eq(users.username, s)))[0] ?? null;
  }

  async grant(identifier: string, roleId: string, who: string) {
    const u = await this.findUser(identifier);
    if (!u) throw new NotFoundException({ code: "USER_NOT_FOUND" });
    await this.requireRole(roleId);
    const added = await this.db
      .insert(userRoles)
      .values({ userId: u.id, roleId, grantedBy: who.slice(0, 80) })
      .onConflictDoNothing()
      .returning();
    if (added.length) await this.audit(who, "user.grant", `user:${u.id}`, `role=${roleId}`);
    return { userId: u.id, role: roleId, changed: added.length > 0 };
  }

  async revoke(identifier: string, roleId: string, who: string) {
    const u = await this.findUser(identifier);
    if (!u) throw new NotFoundException({ code: "USER_NOT_FOUND" });
    const gone = await this.db
      .delete(userRoles)
      .where(and(eq(userRoles.userId, u.id), eq(userRoles.roleId, roleId)))
      .returning();
    if (gone.length) await this.audit(who, "user.revoke", `user:${u.id}`, `role=${roleId}`);
    return { userId: u.id, role: roleId, changed: gone.length > 0 };
  }

  /**
   * Dev / first-run bootstrap: when BOOTSTRAP_SUPER_ADMINS lists this user's email or phone, grant `super_admin`
   * (applied at login and token refresh). Without the variable nothing is ever granted automatically.
   */
  async bootstrap(
    u: { id: string; email: string | null; phone: string | null },
    list: string | undefined,
  ): Promise<boolean> {
    if (!list) return false;
    const wanted = new Set(
      list
        .split(",")
        .map((x) => parseLoginId(x)?.value)
        .filter((x): x is string => !!x),
    );
    if (!((u.email && wanted.has(u.email)) || (u.phone && wanted.has(u.phone)))) return false;
    const added = await this.db
      .insert(userRoles)
      .values({ userId: u.id, roleId: SUPER_ADMIN, grantedBy: "bootstrap" })
      .onConflictDoNothing()
      .returning();
    if (added.length) {
      await this.audit(
        "bootstrap",
        "user.grant",
        `user:${u.id}`,
        `role=${SUPER_ADMIN} (BOOTSTRAP_SUPER_ADMINS)`,
      );
      log.warn({ userId: u.id }, "super_admin granted by BOOTSTRAP_SUPER_ADMINS");
    }
    return added.length > 0;
  }

  // ------------------------------------------------------------------ helpers

  private async requireRole(id: string) {
    const [r] = await this.db.select({ id: roles.id }).from(roles).where(eq(roles.id, id));
    if (!r) throw new NotFoundException({ code: "ROLE_NOT_FOUND" });
  }

  private async requireOffices(ids: string[]) {
    if (!ids.length) return;
    const found = await this.db.select({ id: offices.id }).from(offices).where(inArray(offices.id, ids));
    const missing = ids.filter((id) => !found.some((f) => f.id === id));
    if (missing.length) throw new BadRequestException({ code: "UNKNOWN_OFFICE", offices: missing });
  }

  /** audit entries about one target (user id, office, building), newest first */
  async auditFor(target: string, limit = 20) {
    return this.db
      .select()
      .from(accessAudit)
      .where(eq(accessAudit.target, target))
      .orderBy(desc(accessAudit.at))
      .limit(Math.max(1, Math.min(100, limit)));
  }

  /** write an audit entry from another staff module (console: user status, buildings) */
  async record(who: string, action: string, target: string, detail: string | null = null) {
    await this.audit(who, action, target, detail);
  }

  private async audit(who: string, action: string, target: string, detail: string | null) {
    await this.db
      .insert(accessAudit)
      .values({
        id: newId(),
        who: who.slice(0, 120),
        action,
        target,
        detail: detail?.slice(0, 2000) ?? null,
      });
  }
}
