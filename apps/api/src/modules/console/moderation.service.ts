import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import {
  accessAudit,
  accountSanctions,
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  or,
  refreshTokens,
  staffNotes,
  userBlocks,
  userRoles,
  users,
} from "@gukirana/db";
import { USERNAME_RE, USER_STATUS_ROLES, type SanctionInput, type SanctionKind, type Sanction, type SessionSummary, type StaffNote } from "@gukirana/contracts";
import { createLogger } from "@gukirana/observability";
import { DB, type Db } from "../../common/db.module.js";
import { newId } from "../../common/ids.js";
import { forgetUserStatus } from "../../common/user-status.js";
import { AccessService, SUPER_ADMIN } from "../admin-block/access.service.js";
import { GamesService } from "../games/games.service.js";
import { LedgerService } from "../ledger/ledger.service.js";
import { userCoins } from "../ledger/accounts.js";
import { describeAudit } from "./audit-text.js";

const log = createLogger("moderation");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOUR = 3_600_000;
/** how often timed suspensions are checked for their end */
export const SWEEP_MS = 30_000;

/** audit actions the realtime account feed carries (GET /internal/suspensions) */
const FEED_ACTIONS = ["user.suspend", "user.signout", "user.delete", "user.mute", "user.unmute", "user.warn"] as const;
export type FeedKind = "suspend" | "signout" | "mute" | "unmute" | "warn";
export interface FeedEvent {
  id: string;
  userId: string;
  at: string;
  kind: FeedKind;
  /** mute: until when (ISO) */
  until?: string;
  /** warn: the reason, shown to the player */
  reason?: string;
}

/** "Chrome on macOS" from a user-agent; nothing else of it is shown */
export function deviceLabel(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /node|undici|curl/i.test(ua) ? "Script" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : null;
  return os ? `${browser} on ${os}` : browser;
}

/**
 * Account management for the staff console (P2-CON-02): warnings, chat mutes and suspensions with a reason and an
 * optional end (timed suspensions end by themselves), reactivation, internal staff notes, sessions + sign out
 * everywhere, username reset, delete + anonymise. Rules for every change:
 *
 *  - the caller holds a role that may manage accounts (the controller checks the section, this checks again);
 *  - nobody acts on their own account; only a Super Admin acts on a staff member's account;
 *  - the last active Super Admin is never suspended or deleted;
 *  - every change writes `access_audit` (the account history and the realtime feed read it) with the reason.
 */
@Injectable()
export class ModerationService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly access: AccessService,
    private readonly ledger: LedgerService,
    @Optional() private readonly games?: GamesService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.sweep().catch((e) => log.warn({ err: String(e) }, "sanction sweep failed")), SWEEP_MS);
    this.timer.unref?.();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ------------------------------------------------------------------ guards

  async rolesOf(actor: string): Promise<string[]> {
    if (actor.startsWith("admin-token:")) return [SUPER_ADMIN];
    return (await this.access.access(actor)).roles;
  }

  /** the target account, after the authority checks; throws the plain-word codes the console maps */
  private async target(actor: string, id: string, opts: { allowDeleted?: boolean; need?: readonly string[] } = {}) {
    if (!UUID.test(id)) throw new BadRequestException({ code: "BAD_ID" });
    const roles = await this.rolesOf(actor);
    const need = opts.need ?? USER_STATUS_ROLES;
    if (!need.some((r) => roles.includes(r))) throw new ForbiddenException({ code: "ROLE_REQUIRED" });
    if (actor === id) throw new BadRequestException({ code: "CANNOT_CHANGE_SELF" });
    const [u] = await this.db.select().from(users).where(eq(users.id, id));
    if (!u) throw new NotFoundException({ code: "UNKNOWN_USER" });
    if (u.status === "deleted" && !opts.allowDeleted) throw new BadRequestException({ code: "ACCOUNT_DELETED" });
    // grants held (even while suspended): staff accounts are a Super Admin's to manage
    const held = (await this.db.select({ r: userRoles.roleId }).from(userRoles).where(eq(userRoles.userId, id))).map((g) => g.r);
    const isSuper = roles.includes(SUPER_ADMIN);
    if (held.includes(SUPER_ADMIN) && !isSuper) throw new ForbiddenException({ code: "SUPER_ADMIN_PROTECTED" });
    if (held.length && !isSuper) throw new ForbiddenException({ code: "STAFF_PROTECTED" });
    return { user: u, held, roles };
  }

  private async record(who: string, action: string, userId: string, detail: string | null) {
    await this.access.record(who, action, `user:${userId}`, detail);
  }

  // ------------------------------------------------------------------ sanctions

  /** the mute / suspension in force (not lifted, not ended) */
  private async active(userId: string, kind: "mute" | "suspend", now = new Date()) {
    const rows = await this.db
      .select()
      .from(accountSanctions)
      .where(and(eq(accountSanctions.userId, userId), eq(accountSanctions.kind, kind), isNull(accountSanctions.liftedAt), or(isNull(accountSanctions.endsAt), gt(accountSanctions.endsAt, now))))
      .orderBy(desc(accountSanctions.createdAt));
    return rows;
  }

  /** muted until (ISO) or null */
  async mutedUntil(userId: string, now = new Date()): Promise<string | null> {
    const [m] = await this.active(userId, "mute", now);
    return m?.endsAt ? m.endsAt.toISOString() : null;
  }

  /** active mutes of these accounts → until (ISO), for the people list */
  async mutesOf(ids: string[], now = new Date()): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.db
      .select({ userId: accountSanctions.userId, endsAt: accountSanctions.endsAt })
      .from(accountSanctions)
      .where(and(inArray(accountSanctions.userId, ids), eq(accountSanctions.kind, "mute"), isNull(accountSanctions.liftedAt), gt(accountSanctions.endsAt, now)));
    const out = new Map<string, string>();
    for (const r of rows) if (r.endsAt) out.set(r.userId, r.endsAt.toISOString());
    return out;
  }

  /**
   * Warn, mute (N hours) or suspend (N hours, or until lifted). A new mute / suspension replaces the one in force.
   * Suspending revokes every refresh token and voids the account's active matches (ledger refunds).
   */
  async sanction(actor: string, id: string, input: SanctionInput, now = new Date()) {
    const { user } = await this.target(actor, id);
    const reason = input.reason.trim();
    const hours = input.kind === "warn" ? null : input.hours;
    const endsAt = hours ? new Date(now.getTime() + hours * HOUR) : null;
    if (input.kind === "suspend" && (await this.access.isLastActiveSuperAdmin(id))) throw new BadRequestException({ code: "LAST_SUPER_ADMIN" });
    if (input.kind !== "warn") {
      const prev = await this.active(id, input.kind, now);
      if (prev.length)
        await this.db
          .update(accountSanctions)
          .set({ liftedAt: now, liftedBy: actor.slice(0, 120), liftReason: "Replaced by a new one" })
          .where(inArray(accountSanctions.id, prev.map((p) => p.id)));
    }
    const sid = newId();
    await this.db.insert(accountSanctions).values({ id: sid, userId: id, kind: input.kind, reason, createdBy: actor.slice(0, 120), createdAt: now, endsAt });
    const until = endsAt ? `until=${endsAt.toISOString()} ` : "";
    if (input.kind === "warn") await this.record(actor, "user.warn", id, reason);
    else if (input.kind === "mute") await this.record(actor, "user.mute", id, `${until}(${reason})`);
    else {
      if (user.status !== "suspended") {
        await this.db.update(users).set({ status: "suspended" }).where(eq(users.id, id));
        forgetUserStatus(id); // AuthGuard reads the new status on the next request
      }
      // the audit row is also the feed realtime polls to close the account's connections (GAP-001)
      await this.record(actor, "user.suspend", id, endsAt ? `${until}(${reason})` : reason);
      // no refresh; the status itself refuses the remaining access tokens (they work again only if reactivated)
      await this.db.update(refreshTokens).set({ revoked: true }).where(and(eq(refreshTokens.userId, id), eq(refreshTokens.revoked, false)));
      await this.games?.voidActiveFor(id);
    }
    return { id: sid, kind: input.kind, endsAt: endsAt?.toISOString() ?? null, status: input.kind === "suspend" ? "suspended" : user.status };
  }

  /** lift the mute / suspension in force early (reactivates a suspended account) */
  async lift(actor: string, id: string, kind: "mute" | "suspend", reason: string, now = new Date()) {
    const { user } = await this.target(actor, id);
    const live = await this.active(id, kind, now);
    if (live.length)
      await this.db
        .update(accountSanctions)
        .set({ liftedAt: now, liftedBy: actor.slice(0, 120), liftReason: reason.trim() })
        .where(inArray(accountSanctions.id, live.map((p) => p.id)));
    if (kind === "mute") {
      if (!live.length) return { changed: false, status: user.status };
      await this.record(actor, "user.unmute", id, reason.trim());
      return { changed: true, status: user.status };
    }
    if (user.status !== "suspended") return { changed: live.length > 0, status: user.status };
    await this.db.update(users).set({ status: "active" }).where(eq(users.id, id));
    forgetUserStatus(id);
    await this.record(actor, "user.reactivate", id, reason.trim());
    return { changed: true, status: "active" };
  }

  /** the console's original suspend / reactivate (P2-CON-01): an open-ended suspension, or lifting it */
  async setStatus(actor: string, id: string, status: "active" | "suspended", reason: string) {
    const { user } = await this.target(actor, id);
    if (user.status === status) return { id, status, changed: false };
    if (status === "suspended") await this.sanction(actor, id, { kind: "suspend", reason, hours: null });
    else await this.lift(actor, id, "suspend", reason);
    return { id, status, changed: true };
  }

  /**
   * Timed suspensions whose end has passed: the account is active again (audited as System). Runs every SWEEP_MS;
   * also safe to call at any time (idempotent).
   */
  async sweep(now = new Date()): Promise<string[]> {
    const due = await this.db
      .select()
      .from(accountSanctions)
      .where(and(eq(accountSanctions.kind, "suspend"), isNull(accountSanctions.liftedAt), lte(accountSanctions.endsAt, now)))
      .limit(200);
    const back: string[] = [];
    for (const s of due) {
      await this.db.update(accountSanctions).set({ liftedAt: now, liftedBy: "system", liftReason: "Suspension ended" }).where(and(eq(accountSanctions.id, s.id), isNull(accountSanctions.liftedAt)));
      if ((await this.active(s.userId, "suspend", now)).length) continue; // another suspension still runs
      const [u] = await this.db.select({ status: users.status }).from(users).where(eq(users.id, s.userId));
      if (u?.status !== "suspended") continue;
      await this.db.update(users).set({ status: "active" }).where(eq(users.id, s.userId));
      forgetUserStatus(s.userId);
      await this.record("system", "user.reactivate", s.userId, "Suspension ended");
      back.push(s.userId);
    }
    if (back.length) log.info({ users: back.length }, "timed suspensions ended");
    return back;
  }

  async sanctionsFor(id: string, now = new Date()): Promise<Sanction[]> {
    const rows = await this.db.select().from(accountSanctions).where(eq(accountSanctions.userId, id)).orderBy(desc(accountSanctions.createdAt)).limit(50);
    const names = await this.names(rows.flatMap((r) => [r.createdBy, r.liftedBy ?? ""]));
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as SanctionKind,
      reason: r.reason,
      createdBy: r.createdBy,
      createdByName: names(r.createdBy),
      createdAt: r.createdAt.toISOString(),
      endsAt: r.endsAt?.toISOString() ?? null,
      liftedAt: r.liftedAt?.toISOString() ?? null,
      liftedByName: r.liftedBy ? names(r.liftedBy) : null,
      liftReason: r.liftReason,
      active: r.kind !== "warn" && !r.liftedAt && (!r.endsAt || r.endsAt > now),
    }));
  }

  // ------------------------------------------------------------------ notes

  async addNote(actor: string, id: string, body: string): Promise<StaffNote> {
    await this.target(actor, id, { allowDeleted: true });
    const row = { id: newId(), userId: id, body: body.trim(), createdBy: actor.slice(0, 120) };
    const [n] = await this.db.insert(staffNotes).values(row).returning();
    // the note itself stays in staff_notes; the audit says one was written (and by whom)
    await this.record(actor, "user.note", id, null);
    return { id: n!.id, body: n!.body, createdByName: (await this.names([actor]))(actor), createdAt: n!.createdAt.toISOString() };
  }

  async notesFor(id: string): Promise<StaffNote[]> {
    const rows = await this.db.select().from(staffNotes).where(eq(staffNotes.userId, id)).orderBy(desc(staffNotes.createdAt)).limit(50);
    const names = await this.names(rows.map((r) => r.createdBy));
    return rows.map((r) => ({ id: r.id, body: r.body, createdByName: names(r.createdBy), createdAt: r.createdAt.toISOString() }));
  }

  // ------------------------------------------------------------------ sessions

  /** signed-in devices: live refresh tokens, as "Chrome on macOS" + dates (no token, no address) */
  async sessionsFor(id: string, now = new Date()): Promise<SessionSummary[]> {
    const rows = await this.db
      .select({ id: refreshTokens.id, device: refreshTokens.device, createdAt: refreshTokens.createdAt, expiresAt: refreshTokens.expiresAt })
      .from(refreshTokens)
      .where(and(eq(refreshTokens.userId, id), eq(refreshTokens.revoked, false), gt(refreshTokens.expiresAt, now)))
      .orderBy(desc(refreshTokens.createdAt))
      .limit(20);
    return rows.map((r) => ({ id: r.id, device: deviceLabel(r.device), createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt.toISOString() }));
  }

  /** no refresh, and every access token issued until now is refused (AuthGuard / RoleGuard / realtime feed) */
  private async endSessions(id: string, now = new Date()) {
    await this.db.update(refreshTokens).set({ revoked: true }).where(and(eq(refreshTokens.userId, id), eq(refreshTokens.revoked, false)));
    await this.db.update(users).set({ sessionsRevokedAt: now }).where(eq(users.id, id));
    forgetUserStatus(id);
  }

  /** sign out everywhere: the player must sign in again (their account stays active) */
  async signOut(actor: string, id: string, reason: string) {
    await this.target(actor, id);
    const live = await this.sessionsFor(id);
    await this.endSessions(id);
    await this.record(actor, "user.signout", id, `sessions=${live.length} (${reason.trim()})`);
    return { id, signedOut: live.length };
  }

  // ------------------------------------------------------------------ username

  /** replace an offensive username with a neutral one (the player may choose a new one afterwards) */
  async resetUsername(actor: string, id: string, reason: string) {
    const { user } = await this.target(actor, id);
    let name = "";
    for (let i = 0; i < 8 && !name; i++) {
      const candidate = `player_${randomBytes(3).toString("hex")}`;
      if (!USERNAME_RE.test(candidate)) continue;
      const [taken] = await this.db.select({ id: users.id }).from(users).where(eq(users.username, candidate));
      if (!taken) name = candidate;
    }
    if (!name) throw new BadRequestException({ code: "TRY_AGAIN" });
    await this.db.update(users).set({ username: name }).where(eq(users.id, id));
    // the old name stays in the audit trail (staff only); access tokens carry the name, so refresh them now
    await this.db.update(users).set({ sessionsRevokedAt: new Date() }).where(eq(users.id, id));
    forgetUserStatus(id);
    await this.record(actor, "user.rename", id, `from=${user.username ?? "none"} to=${name} (${reason.trim()})`);
    return { id, username: name };
  }

  // ------------------------------------------------------------------ contact reveal

  /** one full email / phone, for a Super Admin, with a reason (audited; rate limited by the controller) */
  async reveal(actor: string, id: string, field: "email" | "phone", reason: string) {
    const { user } = await this.target(actor, id, { need: [SUPER_ADMIN], allowDeleted: true });
    await this.record(actor, "user.reveal", id, `field=${field} (${reason.trim()})`);
    return { field, value: user[field] };
  }

  // ------------------------------------------------------------------ delete + anonymise

  /**
   * Delete an account at the player's request (Super Admin): personal data is removed (contacts, username, look,
   * blocks), sessions end, the status becomes `deleted`. The row stays, so ledger entries keep their owner — no
   * ledger entry is ever changed or removed. Refused while the account holds a staff role or coins (cash out first).
   */
  async deleteAccount(actor: string, id: string, confirm: string, reason: string) {
    const { user, held } = await this.target(actor, id, { need: [SUPER_ADMIN] });
    const expected = user.username ?? "DELETE";
    if (confirm.trim() !== expected) throw new BadRequestException({ code: "CONFIRM_MISMATCH" });
    if (held.length) throw new BadRequestException({ code: "STAFF_ROLES_HELD" });
    if ((await this.ledger.balance(userCoins(id))) > 0) throw new BadRequestException({ code: "BALANCE_NOT_ZERO" });
    await this.games?.voidActiveFor(id);
    const now = new Date();
    await this.db
      .update(users)
      .set({ status: "deleted", deletedAt: now, username: null, email: null, phone: null, look: null, color: "#8A8A8A", bodyType: "neutral", sessionsRevokedAt: now })
      .where(eq(users.id, id));
    await this.db.update(refreshTokens).set({ revoked: true }).where(and(eq(refreshTokens.userId, id), eq(refreshTokens.revoked, false)));
    await this.db.delete(userBlocks).where(or(eq(userBlocks.userId, id), eq(userBlocks.blockedId, id)));
    forgetUserStatus(id);
    await this.record(actor, "user.delete", id, reason.trim());
    log.info({ userId: id }, "account deleted and anonymised");
    return { id, status: "deleted" };
  }

  // ------------------------------------------------------------------ realtime feed

  /**
   * Account events after `since` (realtime → api, polled about once a second): suspensions / sign-outs / deletions
   * close the account's connections, mutes and warnings are applied live. Reads the audit trail, so it works across
   * restarts and instances; a 2 s overlap covers clock / commit ordering (realtime ignores ids it has handled). The
   * first poll (no `since`) also returns every mute in force, so a restarted realtime knows who is muted.
   */
  async feed(since: Date | null, now = new Date()) {
    const from = since ? new Date(Math.min(since.getTime(), now.getTime()) - 2000) : now;
    const rows = since
      ? await this.db
          .select({ id: accessAudit.id, action: accessAudit.action, target: accessAudit.target, detail: accessAudit.detail, at: accessAudit.at })
          .from(accessAudit)
          .where(and(inArray(accessAudit.action, [...FEED_ACTIONS]), gt(accessAudit.at, from)))
          .orderBy(asc(accessAudit.at))
          .limit(500)
      : [];
    const events: FeedEvent[] = rows
      .filter((r) => r.target.startsWith("user:"))
      .map((r) => {
        const base = { id: r.id, userId: r.target.slice(5), at: r.at.toISOString() };
        switch (r.action) {
          case "user.mute": {
            const until = /until=(\S+)/.exec(r.detail ?? "")?.[1];
            return { ...base, kind: "mute" as const, until };
          }
          case "user.unmute":
            return { ...base, kind: "unmute" as const };
          case "user.warn":
            return { ...base, kind: "warn" as const, reason: r.detail ?? "" };
          case "user.signout":
            return { ...base, kind: "signout" as const };
          default: // suspend, delete
            return { ...base, kind: "suspend" as const };
        }
      });
    const mutes = since
      ? undefined
      : (
          await this.db
            .select({ userId: accountSanctions.userId, endsAt: accountSanctions.endsAt })
            .from(accountSanctions)
            .where(and(eq(accountSanctions.kind, "mute"), isNull(accountSanctions.liftedAt), gt(accountSanctions.endsAt, now)))
            .limit(5000)
        ).map((m) => ({ userId: m.userId, until: m.endsAt!.toISOString() }));
    return { cursor: now.toISOString(), events, ...(mutes ? { mutes } : {}) };
  }

  // ------------------------------------------------------------------ helpers

  /** staff actor → plain name (username, Back office, System) */
  private async names(actors: string[]): Promise<(who: string) => string> {
    const ids = [...new Set(actors.filter((a) => UUID.test(a)))];
    const us = ids.length ? await this.db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, ids)) : [];
    const map = { users: new Map(us.map((u) => [u.id, u.username])), buildings: new Map(), offices: new Map(), roles: new Map() };
    return (who) => describeAudit({ who, target: "", detail: null }, map).whoName;
  }
}
