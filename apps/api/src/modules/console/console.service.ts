import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { accountSanctions, and, count, desc, eq, gt, gte, inArray, isNull, lt, ne, or, reports, roles as rolesTable, userRoles, users } from "@gukirana/db";
import { EXPORT_MAX_ROWS, sectionsFor, type ConsoleOverview, type ConsoleUser, type UserSearch } from "@gukirana/contracts";
import { DB, type Db } from "../../common/db.module.js";
import { ilikeContains } from "../../common/like.js";
import { AccessService, SUPER_ADMIN as SUPER_ADMIN_ROLE } from "../admin-block/access.service.js";
import { OccupancyStore } from "../admin-block/occupancy.js";
import { EconomyService } from "../economy/economy.service.js";
import { LedgerService } from "../ledger/ledger.service.js";
import { userCoins, userStars } from "../ledger/accounts.js";
import { levelForXp, totalXpForLevel } from "../levels/xp.js";
import { maskEmail, maskPhone } from "../identity/phone.js";
import { BuildingsService } from "./buildings.service.js";
import { PresenceStore } from "./presence.js";
import { auditUserIds, describeAudit, type AuditNames } from "./audit-text.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 25;

/** start of today in Kigali (UTC+2, no DST) */
export function kigaliDayStart(now = new Date()): Date {
  const k = new Date(now.getTime() + 2 * 3600_000);
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - 2 * 3600_000);
}

/** Staff admin console (P2-CON-01): overview, people, account status. Every change is audited. */
@Injectable()
export class ConsoleService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly access: AccessService,
    private readonly occupancy: OccupancyStore,
    private readonly economy: EconomyService,
    private readonly ledger: LedgerService,
    private readonly buildings: BuildingsService,
    private readonly presence: PresenceStore,
  ) {}

  /** roles of the caller; the back-office token counts as super admin */
  async rolesOf(actor: string): Promise<string[]> {
    if (actor.startsWith("admin-token:")) return [SUPER_ADMIN_ROLE];
    return (await this.access.access(actor)).roles;
  }

  async me(actor: string) {
    const roles = await this.rolesOf(actor);
    return { roles, sections: sectionsFor(roles) };
  }

  async overview(actor: string): Promise<ConsoleOverview> {
    const sections = sectionsFor(await this.rolesOf(actor));
    const today = kigaliDayStart();
    let usersBlock: ConsoleOverview["users"] = null;
    if (sections.includes("users")) {
      const [[t], [n], [s], [r]] = await Promise.all([
        this.db.select({ n: count() }).from(users).where(ne(users.status, "deleted")),
        this.db.select({ n: count() }).from(users).where(gte(users.createdAt, today)),
        this.db.select({ n: count() }).from(users).where(eq(users.status, "suspended")),
        this.db.select({ n: count() }).from(reports).where(eq(reports.status, "open")),
      ]);
      usersBlock = { total: Number(t?.n ?? 0), newToday: Number(n?.n ?? 0), suspended: Number(s?.n ?? 0), openReports: Number(r?.n ?? 0) };
    }
    let finance: ConsoleOverview["finance"] = null;
    if (sections.includes("finance")) {
      const sum = await this.economy.summary(today, new Date(Date.now() + 60_000));
      const star = sum.byCurrency.STAR;
      const coin = sum.byCurrency.COIN;
      finance = {
        feesStars: star?.revenue ?? 0,
        feesCoins: coin?.revenue ?? 0,
        matchesSettled: (star?.matchesSettled ?? 0) + (coin?.matchesSettled ?? 0),
        starsIssued: star?.starsIssued ?? 0,
      };
    }
    const audit = sections.includes("monitor") ? await this.auditFeed(8) : null;
    return {
      users: usersBlock,
      online: this.presence.totals(),
      offices: this.occupancy.totals(),
      buildings: await this.buildings.list(),
      audit,
      finance,
    };
  }

  /**
   * Recent staff actions for the console, with usernames / building, office and role names and the detail in words
   * (GAP-016). `q` filters on the words as well as the raw fields.
   */
  async auditFeed(limit: number, q?: string) {
    const rows = await this.access.auditLog(limit);
    const names = await this.auditNames(rows);
    const t = q?.trim().toLowerCase();
    return rows
      .map((a) => ({ id: a.id, who: a.who, action: a.action, target: a.target, detail: a.detail, at: a.at.toISOString(), ...describeAudit(a, names) }))
      .filter((a) => !t || `${a.who} ${a.whoName} ${a.action} ${a.target} ${a.targetName} ${a.detail ?? ""} ${a.detailText ?? ""}`.toLowerCase().includes(t));
  }

  /** the names audit rows refer to: accounts, buildings, offices, roles */
  private async auditNames(rows: { who: string; target: string; detail: string | null }[]): Promise<AuditNames> {
    const ids = auditUserIds(rows);
    const [us, bs, os, rs] = await Promise.all([
      ids.length ? this.db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, ids)) : Promise.resolve([]),
      this.buildings.list(),
      this.access.listOffices(),
      this.db.select({ id: rolesTable.id, name: rolesTable.name }).from(rolesTable),
    ]);
    return {
      users: new Map(us.map((u) => [u.id, u.username])),
      buildings: new Map(bs.map((b) => [b.id as string, b.name])),
      offices: new Map(os.map((o) => [o.id, o.name])),
      roles: new Map(rs.map((r) => [r.id, r.name])),
    };
  }

  /** the people-list filters as SQL (shared by the list and the CSV export) */
  private searchWhere(f: UserSearch, now = Date.now()) {
    const term = f.q?.trim().slice(0, 60);
    const day = (d: string) => new Date(`${d}T00:00:00+02:00`); // Kigali day start
    const seen = f.seen ?? 0;
    const seenAt = new Date(now - Math.abs(seen) * 86_400_000);
    return and(
      // the term is matched literally: "_" and "%" in usernames are characters, not wildcards (GAP-006)
      term ? or(ilikeContains(users.username, term), ilikeContains(users.email, term), ilikeContains(users.phone, term), UUID.test(term) ? eq(users.id, term) : undefined) : undefined,
      // deleted (anonymised) accounts only when asked for
      f.status ? eq(users.status, f.status) : ne(users.status, "deleted"),
      f.role ? inArray(users.id, this.db.select({ id: userRoles.userId }).from(userRoles).where(eq(userRoles.roleId, f.role))) : undefined,
      f.minLevel ? gte(users.xp, totalXpForLevel(f.minLevel)) : undefined,
      f.maxLevel ? lt(users.xp, totalXpForLevel(f.maxLevel + 1)) : undefined,
      f.joinedFrom ? gte(users.createdAt, day(f.joinedFrom)) : undefined,
      f.joinedTo ? lt(users.createdAt, new Date(day(f.joinedTo).getTime() + 86_400_000)) : undefined,
      seen > 0 ? gte(users.lastSeenAt, seenAt) : seen < 0 ? or(isNull(users.lastSeenAt), lt(users.lastSeenAt, seenAt)) : undefined,
    );
  }

  private async rowsToConsole(rows: (typeof users.$inferSelect)[]): Promise<ConsoleUser[]> {
    const ids = rows.map((u) => u.id);
    const now = new Date();
    const [grants, mutes] = ids.length
      ? await Promise.all([
          this.db.select().from(userRoles).where(inArray(userRoles.userId, ids)),
          this.db
            .select({ userId: accountSanctions.userId, endsAt: accountSanctions.endsAt })
            .from(accountSanctions)
            .where(and(inArray(accountSanctions.userId, ids), eq(accountSanctions.kind, "mute"), isNull(accountSanctions.liftedAt), gt(accountSanctions.endsAt, now))),
        ])
      : [[], []];
    return rows.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email ? maskEmail(u.email) : null,
      phone: u.phone ? maskPhone(u.phone) : null,
      level: levelForXp(u.xp),
      status: u.status,
      createdAt: u.createdAt.toISOString(),
      roles: grants.filter((g) => g.userId === u.id).map((g) => g.roleId).sort(),
      lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
      mutedUntil: mutes.find((m) => m.userId === u.id)?.endsAt?.toISOString() ?? null,
    }));
  }

  /** People list: text search + filters (status, role, level range, joined dates, last seen), 25 a page */
  async listUsers(f: UserSearch = {}): Promise<{ items: ConsoleUser[]; page: number; more: boolean }> {
    const p = Math.max(0, Math.min(400, Math.floor(f.page ?? 0) || 0));
    const rows = await this.db
      .select()
      .from(users)
      .where(this.searchWhere(f))
      .orderBy(desc(users.createdAt))
      .limit(PAGE + 1)
      .offset(p * PAGE);
    return { page: p, more: rows.length > PAGE, items: await this.rowsToConsole(rows.slice(0, PAGE)) };
  }

  /**
   * The filtered people list as CSV (contacts masked, at most EXPORT_MAX_ROWS rows). The caller audits and rate
   * limits it. Cells that a spreadsheet would run as a formula are quoted with a leading apostrophe.
   */
  async exportUsers(f: UserSearch): Promise<{ csv: string; rows: number; truncated: boolean }> {
    const rows = await this.db
      .select()
      .from(users)
      .where(this.searchWhere(f))
      .orderBy(desc(users.createdAt))
      .limit(EXPORT_MAX_ROWS + 1);
    const items = await this.rowsToConsole(rows.slice(0, EXPORT_MAX_ROWS));
    const head = ["id", "username", "email", "phone", "level", "status", "roles", "joined", "last_seen", "muted_until"];
    const lines = [head.join(","), ...items.map((u) => [u.id, u.username, u.email, u.phone, u.level, u.status, u.roles.join(" "), u.createdAt, u.lastSeenAt, u.mutedUntil].map(csvCell).join(","))];
    return { csv: lines.join("\r\n") + "\r\n", rows: items.length, truncated: rows.length > EXPORT_MAX_ROWS };
  }

  async userDetail(id: string) {
    if (!UUID.test(id)) throw new BadRequestException({ code: "BAD_ID" });
    const [u] = await this.db.select().from(users).where(eq(users.id, id));
    if (!u) throw new NotFoundException({ code: "UNKNOWN_USER" });
    const [grants, stars, coins, history, [rep]] = await Promise.all([
      this.db.select().from(userRoles).where(eq(userRoles.userId, id)),
      this.ledger.balance(userStars(id)),
      this.ledger.balance(userCoins(id)),
      this.access.auditFor(`user:${id}`, 30),
      this.db.select({ n: count() }).from(reports).where(and(eq(reports.targetId, id), eq(reports.status, "open"))),
    ]);
    const names = await this.auditNames(history);
    return {
      id: u.id,
      username: u.username,
      email: u.email ? maskEmail(u.email) : null,
      phone: u.phone ? maskPhone(u.phone) : null,
      level: levelForXp(u.xp),
      xp: u.xp,
      status: u.status,
      kycTier: u.kycTier,
      createdAt: u.createdAt.toISOString(),
      lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
      deletedAt: u.deletedAt?.toISOString() ?? null,
      hasEmail: !!u.email,
      hasPhone: !!u.phone,
      openReports: Number(rep?.n ?? 0),
      roles: grants.map((g) => ({ role: g.roleId, grantedBy: g.grantedBy, grantedAt: g.grantedAt.toISOString() })),
      stars,
      coins,
      history: history.map((a) => {
        const w = describeAudit(a, names);
        return { id: a.id, who: a.who, action: a.action, detail: a.detail, at: a.at.toISOString(), whoName: w.whoName, detailText: w.detailText };
      }),
    };
  }
}

/** one CSV cell: quoted when needed, formula-looking text defused (CSV injection) */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let t = String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}
