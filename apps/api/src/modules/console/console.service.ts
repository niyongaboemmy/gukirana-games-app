import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { accessAudit, and, asc, count, desc, eq, gt, gte, inArray, or, refreshTokens, userRoles, users } from "@gukirana/db";
import { USER_STATUS_ROLES, sectionsFor, type ConsoleOverview, type ConsoleUser, type UserStatus } from "@gukirana/contracts";
import { DB, type Db } from "../../common/db.module.js";
import { forgetUserStatus } from "../../common/user-status.js";
import { ilikeContains } from "../../common/like.js";
import { GamesService } from "../games/games.service.js";
import { AccessService, SUPER_ADMIN as SUPER_ADMIN_ROLE } from "../admin-block/access.service.js";
import { OccupancyStore } from "../admin-block/occupancy.js";
import { EconomyService } from "../economy/economy.service.js";
import { LedgerService } from "../ledger/ledger.service.js";
import { userCoins, userStars } from "../ledger/accounts.js";
import { levelForXp } from "../levels/xp.js";
import { maskEmail, maskPhone } from "../identity/phone.js";
import { BuildingsService } from "./buildings.service.js";
import { PresenceStore } from "./presence.js";

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
    /** optional so unit tests can build the console without the games module */
    @Optional() private readonly games?: GamesService,
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
      const [[t], [n], [s]] = await Promise.all([
        this.db.select({ n: count() }).from(users),
        this.db.select({ n: count() }).from(users).where(gte(users.createdAt, today)),
        this.db.select({ n: count() }).from(users).where(eq(users.status, "suspended")),
      ]);
      usersBlock = { total: Number(t?.n ?? 0), newToday: Number(n?.n ?? 0), suspended: Number(s?.n ?? 0) };
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
    const audit = sections.includes("monitor")
      ? (await this.access.auditLog(8)).map((a) => ({ id: a.id, who: a.who, action: a.action, target: a.target, detail: a.detail, at: a.at.toISOString() }))
      : null;
    return {
      users: usersBlock,
      online: this.presence.totals(),
      offices: this.occupancy.totals(),
      buildings: await this.buildings.list(),
      audit,
      finance,
    };
  }

  async listUsers(q: string | undefined, status: string | undefined, page: number): Promise<{ items: ConsoleUser[]; page: number; more: boolean }> {
    const term = q?.trim().slice(0, 60);
    // the term is matched literally: "_" and "%" in usernames are characters, not wildcards (GAP-006)
    const where = and(
      term ? or(ilikeContains(users.username, term), ilikeContains(users.email, term), ilikeContains(users.phone, term), UUID.test(term) ? eq(users.id, term) : undefined) : undefined,
      status === "active" || status === "suspended" ? eq(users.status, status) : undefined,
    );
    const p = Math.max(0, Math.min(400, Math.floor(page) || 0));
    const rows = await this.db
      .select()
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(PAGE + 1)
      .offset(p * PAGE);
    const slice = rows.slice(0, PAGE);
    const grants = slice.length ? await this.db.select().from(userRoles).where(inArray(userRoles.userId, slice.map((u) => u.id))) : [];
    return {
      page: p,
      more: rows.length > PAGE,
      items: slice.map((u) => ({
        id: u.id,
        username: u.username,
        email: u.email ? maskEmail(u.email) : null,
        phone: u.phone ? maskPhone(u.phone) : null,
        level: levelForXp(u.xp),
        status: u.status,
        createdAt: u.createdAt.toISOString(),
        roles: grants.filter((g) => g.userId === u.id).map((g) => g.roleId).sort(),
      })),
    };
  }

  async userDetail(id: string) {
    if (!UUID.test(id)) throw new BadRequestException({ code: "BAD_ID" });
    const [u] = await this.db.select().from(users).where(eq(users.id, id));
    if (!u) throw new NotFoundException({ code: "UNKNOWN_USER" });
    const [grants, stars, coins, history] = await Promise.all([
      this.db.select().from(userRoles).where(eq(userRoles.userId, id)),
      this.ledger.balance(userStars(id)),
      this.ledger.balance(userCoins(id)),
      this.access.auditFor(`user:${id}`, 20),
    ]);
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
      roles: grants.map((g) => ({ role: g.roleId, grantedBy: g.grantedBy, grantedAt: g.grantedAt.toISOString() })),
      stars,
      coins,
      history: history.map((a) => ({ id: a.id, who: a.who, action: a.action, detail: a.detail, at: a.at.toISOString() })),
    };
  }

  /** suspend / reactivate a player. Nobody changes their own status; only a super admin changes a super admin's. */
  async setStatus(actor: string, id: string, status: UserStatus, reason: string) {
    if (!UUID.test(id)) throw new BadRequestException({ code: "BAD_ID" });
    const roles = await this.rolesOf(actor);
    if (!USER_STATUS_ROLES.some((r) => roles.includes(r))) throw new ForbiddenException({ code: "ROLE_REQUIRED" });
    if (actor === id) throw new BadRequestException({ code: "CANNOT_CHANGE_SELF" });
    const [u] = await this.db.select({ id: users.id, status: users.status }).from(users).where(eq(users.id, id));
    if (!u) throw new NotFoundException({ code: "UNKNOWN_USER" });
    const target = (await this.access.access(id)).roles;
    if (target.includes(SUPER_ADMIN_ROLE) && !roles.includes(SUPER_ADMIN_ROLE)) throw new ForbiddenException({ code: "SUPER_ADMIN_PROTECTED" });
    if (u.status === status) return { id, status, changed: false };
    // e.g. the back-office token suspending the only active super admin (GAP-007)
    if (status === "suspended" && (await this.access.isLastActiveSuperAdmin(id))) throw new BadRequestException({ code: "LAST_SUPER_ADMIN" });
    await this.db.update(users).set({ status }).where(eq(users.id, id));
    forgetUserStatus(id); // AuthGuard reads the new status on the next request
    // the audit row is also the suspension feed realtime polls to close the account's connections (GAP-001)
    await this.access.record(actor, status === "suspended" ? "user.suspend" : "user.reactivate", `user:${id}`, reason);
    if (status === "suspended") {
      // end the session: no refresh, and nothing left staked against a suspended player (void → ledger refund)
      await this.db.update(refreshTokens).set({ revoked: true }).where(and(eq(refreshTokens.userId, id), eq(refreshTokens.revoked, false)));
      await this.games?.voidActiveFor(id);
    }
    return { id, status, changed: true };
  }

  /**
   * Suspensions recorded after `since` (realtime → api, polled about once a second): realtime closes those accounts'
   * world and match connections. Reads the audit trail, so it works across API restarts and instances; a 2 s overlap
   * covers clock / commit ordering (the caller ignores ids it has already handled).
   */
  async suspensionsSince(since: Date | null, now = new Date()) {
    const from = since ? new Date(Math.min(since.getTime(), now.getTime()) - 2000) : now;
    const rows = since
      ? await this.db
          .select({ id: accessAudit.id, target: accessAudit.target, at: accessAudit.at })
          .from(accessAudit)
          .where(and(eq(accessAudit.action, "user.suspend"), gt(accessAudit.at, from)))
          .orderBy(asc(accessAudit.at))
          .limit(500)
      : [];
    return {
      cursor: now.toISOString(),
      events: rows.filter((r) => r.target.startsWith("user:")).map((r) => ({ id: r.id, userId: r.target.slice(5), at: r.at.toISOString() })),
    };
  }
}
