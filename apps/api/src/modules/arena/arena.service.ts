import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import {
  accessAudit,
  and,
  arenaBars,
  arenaEvents,
  arenaInvites,
  arenaParticipants,
  arenaPasses,
  arenaSettings,
  buildings,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  or,
  roles,
  sql,
  users,
} from "@gukirana/db";
import {
  ARENA_STAFF_ROLES,
  ArenaScopeRuleSchema,
  type ArenaDenial,
  type ArenaEvent,
  type ArenaEventStatus,
  type ArenaRealtimeState,
  type ArenaScopeRule,
  type ArenaSettings,
  type ArenaStatus,
  type ArenaUserAccess,
} from "@gukirana/contracts";
import { createLogger } from "@gukirana/observability";
import { z } from "zod";
import { DB, type Db } from "../../common/db.module.js";
import { newId } from "../../common/ids.js";
import { maskEmail, maskPhone } from "../identity/phone.js";
import { levelForXp } from "../levels/xp.js";
import { AccessService } from "../admin-block/access.service.js";
import { ArenaPresence } from "./presence.js";
import {
  canTransition,
  evaluateScope,
  isActive,
  isOpenSeating,
  isTerminal,
  overlaps,
  timeStatus,
  validateTimes,
  type Viewer,
} from "./rules.js";

const log = createLogger("arena");
export const EVENT_MANAGER = "event_manager";
/** active passes one person may hold across upcoming events (pass hoarding) */
export const MAX_ACTIVE_PASSES = 3;
/** pass claims / returns per user per minute */
export const CLAIM_RATE = { max: 10, windowMs: 60_000 };
export const SWEEP_MS = 15_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE: ArenaEventStatus[] = ["scheduled", "doors_open", "live"];

type EventRow = typeof arenaEvents.$inferSelect;
type PassZone = "seats" | "vip" | "floor";
export interface Pass {
  eventId: string;
  zone: PassZone;
  seat: string | null;
}

export interface EventInput {
  title: string;
  kind: ArenaEvent["kind"];
  game?: ArenaEvent["game"];
  description?: string;
  doorsOpenAt?: string;
  startsAt: string;
  endsAt: string;
  rules: ArenaScopeRule[];
  capacity?: number;
  vipCapacity?: number;
  status?: "draft" | "scheduled";
}
export type EventPatch = Partial<Omit<EventInput, "status">> & { status?: ArenaEventStatus };

const denied = (denial: ArenaDenial) =>
  denial === "RATE_LIMITED"
    ? new HttpException({ code: denial, denial }, 429)
    : new ForbiddenException({ code: denial, denial });

/**
 * Tournament Arena access + events (P2-ARN-02, docs/ARENA-REQUIREMENTS.md). Building switch, event lifecycle (with
 * time moves), scopes, passes with capacity enforced by one conditional UPDATE per claim (no oversell), invites,
 * participants, bars. Every admin change is audited in `access_audit` (target `arena:*`). No money moves here.
 */
@Injectable()
export class ArenaService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private claims = new Map<string, { at: number; n: number }>();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly access: AccessService,
    private readonly presence: ArenaPresence,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seed();
    this.timer = setInterval(() => void this.sweep().catch((e) => log.warn({ err: String(e) }, "arena sweep failed")), SWEEP_MS);
    this.timer.unref?.();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** settings row + the `event_manager` role (no offices). Idempotent. */
  async seed(): Promise<void> {
    await this.db.insert(arenaSettings).values({ id: 1 }).onConflictDoNothing();
    const r = await this.db
      .insert(roles)
      .values({ id: EVENT_MANAGER, name: "Event Manager", description: "Runs the Tournament Arena (events, scopes, invites, bars)" })
      .onConflictDoNothing()
      .returning();
    if (r.length) await this.audit("seed", "role.create", `role:${EVENT_MANAGER}`, "arena seed");
  }

  // ------------------------------------------------------------------ settings

  /**
   * `open` = the arena's own switch (PUT /admin/arena/settings); `buildingOpen` = the admin console's building master
   * switch (`buildings` row "arena", P2-CON-01; no row = open). The arena is open only when both are.
   */
  async settings(): Promise<ArenaSettings & { version: number; updatedAt: Date; updatedBy: string; buildingOpen: boolean; effectiveOpen: boolean }> {
    const [s] = await this.db.select().from(arenaSettings).where(eq(arenaSettings.id, 1));
    if (!s) {
      await this.seed();
      return this.settings();
    }
    const [b] = await this.db.select({ open: buildings.open }).from(buildings).where(eq(buildings.id, "arena"));
    const buildingOpen = b?.open ?? true;
    return { open: s.open, buildingOpen, effectiveOpen: s.open && buildingOpen, defaultCapacity: s.defaultCapacity, maxConcourse: s.maxConcourse, version: s.version, updatedAt: s.updatedAt, updatedBy: s.updatedBy };
  }

  async updateSettings(patch: Partial<ArenaSettings>, who: string) {
    const before = await this.settings();
    const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    await this.db
      .update(arenaSettings)
      .set({ ...set, version: sql`${arenaSettings.version} + 1`, updatedBy: who.slice(0, 120), updatedAt: new Date() })
      .where(eq(arenaSettings.id, 1));
    const action = patch.open === undefined || patch.open === before.open ? "arena.settings" : patch.open ? "arena.open" : "arena.close";
    await this.audit(who, action, "arena:settings", JSON.stringify(set));
    return this.settings();
  }

  // ------------------------------------------------------------------ lifecycle

  /** Moves events along by time (scheduled → doors_open → live → ended). Returns the changed ids. */
  async sweep(now = new Date()): Promise<string[]> {
    const rows = await this.db.select().from(arenaEvents).where(inArray(arenaEvents.status, ACTIVE));
    const changed: string[] = [];
    for (const e of rows) {
      const to = timeStatus(e.status as ArenaEventStatus, e, now);
      if (to === e.status) continue;
      const done = await this.db
        .update(arenaEvents)
        .set({ status: to, updatedAt: now })
        .where(and(eq(arenaEvents.id, e.id), eq(arenaEvents.status, e.status)))
        .returning();
      if (done.length) {
        changed.push(e.id);
        await this.audit("system", "event.auto", `arena:event:${e.id}`, `${e.status}→${to}`);
      }
    }
    return changed;
  }

  /** the event whose doors are open or that is live (overlaps are refused, so at most one) */
  async current(now = new Date()): Promise<EventRow | null> {
    await this.sweep(now);
    const [e] = await this.db
      .select()
      .from(arenaEvents)
      .where(inArray(arenaEvents.status, ["doors_open", "live"]))
      .orderBy(asc(arenaEvents.startsAt))
      .limit(1);
    return e ?? null;
  }

  async next(now = new Date()): Promise<EventRow | null> {
    const [e] = await this.db
      .select()
      .from(arenaEvents)
      .where(and(eq(arenaEvents.status, "scheduled"), gte(arenaEvents.endsAt, now)))
      .orderBy(asc(arenaEvents.doorsOpenAt))
      .limit(1);
    return e ?? null;
  }

  toPublic(e: EventRow): ArenaEvent {
    const rules = e.rules as ArenaScopeRule[];
    return {
      id: e.id,
      title: e.title,
      kind: e.kind as ArenaEvent["kind"],
      game: (e.game ?? null) as ArenaEvent["game"],
      status: e.status as ArenaEventStatus,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
      doorsOpenAt: e.doorsOpenAt.toISOString(),
      rules,
      capacity: e.capacity,
      vipCapacity: e.vipCapacity,
      passesIssued: e.seatsIssued + e.vipIssued + e.floorIssued,
      vipIssued: e.vipIssued,
      description: e.description,
      openSeating: isOpenSeating(rules),
    };
  }

  /** public list (no drafts; counts only, no names) */
  async listPublic(upcoming: boolean, now = new Date()): Promise<ArenaEvent[]> {
    await this.sweep(now);
    const rows = await this.db
      .select()
      .from(arenaEvents)
      .where(upcoming ? inArray(arenaEvents.status, ACTIVE) : inArray(arenaEvents.status, [...ACTIVE, "ended", "cancelled"]))
      .orderBy(upcoming ? asc(arenaEvents.startsAt) : desc(arenaEvents.startsAt))
      .limit(50);
    return rows.map((e) => this.toPublic(e));
  }

  private async event(id: string): Promise<EventRow> {
    if (!UUID.test(id)) throw new NotFoundException({ code: "EVENT_NOT_FOUND" });
    const [e] = await this.db.select().from(arenaEvents).where(eq(arenaEvents.id, id));
    if (!e) throw new NotFoundException({ code: "EVENT_NOT_FOUND" });
    return e;
  }

  // ------------------------------------------------------------------ viewer / passes

  async isBarred(userId: string, now = new Date()): Promise<boolean> {
    if (!UUID.test(userId)) return false;
    const [b] = await this.db.select().from(arenaBars).where(eq(arenaBars.userId, userId));
    return !!b && (!b.until || b.until > now);
  }

  private async viewer(userId: string | null, eventId: string | null): Promise<Viewer & { invitedZone: PassZone | null }> {
    if (!userId || !UUID.test(userId))
      return { userId: null, level: 0, roles: [], ageVerified: false, invited: false, participant: false, invitedZone: null };
    const [u] = await this.db.select({ xp: users.xp, kyc: users.kycTier }).from(users).where(eq(users.id, userId));
    const held = (await this.access.access(userId)).roles;
    let inv: { zone: string } | undefined;
    let part: unknown;
    if (eventId) {
      [inv] = await this.db.select({ zone: arenaInvites.zone }).from(arenaInvites).where(and(eq(arenaInvites.eventId, eventId), eq(arenaInvites.userId, userId)));
      [part] = await this.db.select({ u: arenaParticipants.userId }).from(arenaParticipants).where(and(eq(arenaParticipants.eventId, eventId), eq(arenaParticipants.userId, userId)));
    }
    return {
      userId,
      level: levelForXp(u?.xp ?? 0),
      roles: held,
      ageVerified: (u?.kyc ?? 0) >= 1,
      invited: !!inv,
      participant: !!part,
      invitedZone: (inv?.zone as PassZone | undefined) ?? null,
    };
  }

  async passOf(userId: string, eventId: string): Promise<Pass | null> {
    if (!UUID.test(userId)) return null;
    const [p] = await this.db.select().from(arenaPasses).where(and(eq(arenaPasses.eventId, eventId), eq(arenaPasses.userId, userId)));
    return p ? { eventId: p.eventId, zone: p.zone as PassZone, seat: p.seat } : null;
  }

  private async activePasses(userId: string): Promise<number> {
    const [r] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(arenaPasses)
      .innerJoin(arenaEvents, eq(arenaEvents.id, arenaPasses.eventId))
      .where(and(eq(arenaPasses.userId, userId), inArray(arenaEvents.status, ACTIVE)));
    return Number(r?.n ?? 0);
  }

  /** Why `userId` may not claim a pass for `e` right now (null = may), and the zone they would get. */
  private async claimCheck(userId: string | null, e: EventRow): Promise<{ denial: ArenaDenial | null; zone: PassZone; via: string }> {
    const v = await this.viewer(userId, e.id);
    const zone: PassZone = v.participant ? "floor" : (v.invitedZone ?? "seats");
    const via = v.participant ? "participant" : v.invitedZone ? "invite" : "scope";
    const out = (denial: ArenaDenial | null) => ({ denial, zone, via });
    if (!isActive(e.status as ArenaEventStatus)) return out("EVENT_NOT_OPEN");
    const s = await this.settings();
    const staff = v.roles.some((r) => (ARENA_STAFF_ROLES as readonly string[]).includes(r));
    if (!s.effectiveOpen && !staff) return out("ARENA_CLOSED");
    if (!userId) return out("LOGIN_REQUIRED"); // guests never hold passes (open seating needs none)
    if (await this.isBarred(userId)) return out("BARRED");
    const scope = evaluateScope(e.rules as ArenaScopeRule[], v);
    if (scope) return out(scope);
    if ((await this.activePasses(userId)) >= MAX_ACTIVE_PASSES) return out("PASS_LIMIT");
    if (zone === "seats" && e.seatsIssued >= e.capacity) return out("SOLD_OUT");
    if (zone === "vip" && e.vipIssued >= e.vipCapacity) return out("SOLD_OUT");
    return out(null);
  }

  private rateOk(userId: string, now = Date.now()): boolean {
    const b = this.claims.get(userId);
    if (!b || now - b.at >= CLAIM_RATE.windowMs) {
      this.claims.set(userId, { at: now, n: 1 });
      if (this.claims.size > 10_000) for (const [k, x] of this.claims) if (now - x.at >= CLAIM_RATE.windowMs) this.claims.delete(k);
      return true;
    }
    if (b.n >= CLAIM_RATE.max) return false;
    b.n++;
    return true;
  }

  /** Claim a pass. Idempotent per (user, event); capacity enforced by a conditional UPDATE in the same transaction. */
  async claim(userId: string, eventId: string): Promise<{ pass: Pass }> {
    const e0 = await this.event(eventId);
    await this.sweep();
    const existing = await this.passOf(userId, eventId);
    if (existing) return { pass: existing };
    if (!this.rateOk(userId)) throw denied("RATE_LIMITED");
    const e = await this.event(e0.id);
    const chk = await this.claimCheck(userId, e);
    if (chk.denial) throw denied(chk.denial);
    const counter = chk.zone === "seats" ? arenaEvents.seatsIssued : chk.zone === "vip" ? arenaEvents.vipIssued : arenaEvents.floorIssued;
    const cap =
      chk.zone === "seats" ? sql`${arenaEvents.seatsIssued} < ${arenaEvents.capacity}` : chk.zone === "vip" ? sql`${arenaEvents.vipIssued} < ${arenaEvents.vipCapacity}` : sql`true`;
    const DUP = new Error("DUP");
    try {
      await this.tx(async (tx: Db) => {
        const got = await tx
          .update(arenaEvents)
          .set({ [chk.zone === "seats" ? "seatsIssued" : chk.zone === "vip" ? "vipIssued" : "floorIssued"]: sql`${counter} + 1` })
          .where(and(eq(arenaEvents.id, e.id), inArray(arenaEvents.status, ACTIVE), cap))
          .returning();
        if (!got.length) throw denied("SOLD_OUT");
        const ins = await tx.insert(arenaPasses).values({ eventId: e.id, userId, zone: chk.zone, via: chk.via }).onConflictDoNothing().returning();
        if (!ins.length) throw DUP; // a parallel claim by the same user won: roll back our counter
      });
    } catch (err) {
      if (err !== DUP) throw err;
    }
    return { pass: (await this.passOf(userId, e.id))! };
  }

  /** Give a pass back (frees its slot). */
  async release(userId: string, eventId: string): Promise<{ released: boolean }> {
    await this.event(eventId);
    if (!this.rateOk(userId)) throw denied("RATE_LIMITED");
    return { released: (await this.revoke(eventId, [userId])) > 0 };
  }

  /** Delete passes (optionally only those issued `via`) and decrement the zone counters in one transaction. */
  private async revoke(eventId: string, userIds: string[], via?: string): Promise<number> {
    if (!userIds.length) return 0;
    return this.tx(async (tx: Db) => {
      const gone = await tx
        .delete(arenaPasses)
        .where(and(eq(arenaPasses.eventId, eventId), inArray(arenaPasses.userId, userIds), via ? eq(arenaPasses.via, via) : undefined))
        .returning();
      if (!gone.length) return 0;
      const n = (z: string) => gone.filter((p) => p.zone === z).length;
      await tx
        .update(arenaEvents)
        .set({
          seatsIssued: sql`greatest(0, ${arenaEvents.seatsIssued} - ${n("seats")})`,
          vipIssued: sql`greatest(0, ${arenaEvents.vipIssued} - ${n("vip")})`,
          floorIssued: sql`greatest(0, ${arenaEvents.floorIssued} - ${n("floor")})`,
        })
        .where(eq(arenaEvents.id, eventId));
      return gone.length;
    });
  }

  /** GET /arena/status — `userId` null for guests. */
  async status(userId: string | null): Promise<ArenaStatus> {
    const now = new Date();
    const cur = await this.current(now);
    const nxt = await this.next(now);
    const s = await this.settings();
    const roleList = userId ? (await this.access.access(userId)).roles : [];
    const staff = roleList.some((r) => (ARENA_STAFF_ROLES as readonly string[]).includes(r));
    const barred = userId ? await this.isBarred(userId, now) : false;
    const denial: ArenaDenial | null = barred ? "BARRED" : !s.effectiveOpen && !staff ? "ARENA_CLOSED" : null;
    const pass = cur && userId ? await this.passOf(userId, cur.id) : null;
    let canClaim = false;
    let claimDenial: ArenaDenial | null = null;
    if (cur && !pass) {
      const open = isOpenSeating(cur.rules as ArenaScopeRule[]);
      if (!userId) claimDenial = open ? null : denial ?? "LOGIN_REQUIRED";
      else {
        claimDenial = (await this.claimCheck(userId, cur)).denial;
        canClaim = claimDenial === null;
      }
    }
    return {
      open: s.effectiveOpen,
      canEnter: denial === null,
      denial,
      current: cur ? this.toPublic(cur) : null,
      next: nxt && nxt.id !== cur?.id ? this.toPublic(nxt) : null,
      pass,
      canClaim,
      claimDenial,
      occupancy: this.presence.totals(),
    };
  }

  // ------------------------------------------------------------------ admin: events

  async listEvents() {
    await this.sweep();
    const rows = await this.db.select().from(arenaEvents).orderBy(desc(arenaEvents.startsAt)).limit(200);
    return rows.map((e) => ({ ...this.toPublic(e), seatsIssued: e.seatsIssued, floorIssued: e.floorIssued, createdBy: e.createdBy }));
  }

  private async assertNoOverlap(id: string | null, t: { doorsOpenAt: Date; startsAt: Date; endsAt: Date }) {
    const others = await this.db.select().from(arenaEvents).where(inArray(arenaEvents.status, ACTIVE));
    const clash = others.find((o) => o.id !== id && overlaps(o, t));
    if (clash) throw new ConflictException({ code: "EVENT_OVERLAP", with: clash.id, title: clash.title });
  }

  private times(i: { doorsOpenAt?: string; startsAt: string; endsAt: string }) {
    const startsAt = new Date(i.startsAt);
    const t = { doorsOpenAt: i.doorsOpenAt ? new Date(i.doorsOpenAt) : new Date(startsAt.getTime() - 30 * 60_000), startsAt, endsAt: new Date(i.endsAt) };
    const bad = validateTimes(t);
    if (bad) throw new BadRequestException({ code: bad });
    return t;
  }

  private rules(r: unknown): ArenaScopeRule[] {
    const p = z.array(ArenaScopeRuleSchema).min(1).max(7).safeParse(r);
    if (!p.success) throw new BadRequestException({ code: "INVALID_RULES" });
    return p.data;
  }

  async createEvent(i: EventInput, who: string) {
    const t = this.times(i);
    const status = i.status ?? "draft";
    if (status !== "draft") await this.assertNoOverlap(null, t);
    const id = newId();
    const [e] = await this.db
      .insert(arenaEvents)
      .values({
        id,
        title: i.title,
        kind: i.kind,
        game: i.game ?? null,
        description: i.description ?? "",
        status,
        ...t,
        rules: this.rules(i.rules),
        capacity: i.capacity ?? (await this.settings()).defaultCapacity,
        vipCapacity: i.vipCapacity ?? 0,
        createdBy: who.slice(0, 120),
      })
      .returning();
    await this.audit(who, "event.create", `arena:event:${id}`, JSON.stringify({ title: i.title, status, rules: e!.rules, capacity: e!.capacity }));
    await this.sweep();
    return this.toPublic(await this.event(id));
  }

  async updateEvent(id: string, p: EventPatch, who: string) {
    await this.sweep();
    const e = await this.event(id);
    const from = e.status as ArenaEventStatus;
    if (isTerminal(from)) throw new BadRequestException({ code: "EVENT_READ_ONLY" });
    const to = p.status ?? from;
    if (to !== from && !canTransition(from, to)) throw new BadRequestException({ code: "BAD_TRANSITION", from, to });
    const touchesShape = p.doorsOpenAt !== undefined || p.startsAt !== undefined || p.endsAt !== undefined || p.rules !== undefined;
    if (from === "live" && touchesShape) throw new BadRequestException({ code: "EVENT_LIVE" });
    const t = this.times({
      doorsOpenAt: p.doorsOpenAt ?? e.doorsOpenAt.toISOString(),
      startsAt: p.startsAt ?? e.startsAt.toISOString(),
      endsAt: p.endsAt ?? e.endsAt.toISOString(),
    });
    if (isActive(to)) await this.assertNoOverlap(id, t);
    const set: Partial<typeof arenaEvents.$inferInsert> = { updatedAt: new Date(), status: to, ...t };
    if (p.title !== undefined) set.title = p.title;
    if (p.kind !== undefined) set.kind = p.kind;
    if (p.game !== undefined) set.game = p.game;
    if (p.description !== undefined) set.description = p.description;
    if (p.rules !== undefined) set.rules = this.rules(p.rules);
    if (p.capacity !== undefined) set.capacity = p.capacity;
    if (p.vipCapacity !== undefined) set.vipCapacity = p.vipCapacity;
    const done = await this.db
      .update(arenaEvents)
      .set(set)
      .where(and(eq(arenaEvents.id, id), eq(arenaEvents.status, from)))
      .returning();
    if (!done.length) throw new ConflictException({ code: "EVENT_CHANGED" }); // a time move raced the edit: retry
    const logged = { ...set, updatedAt: undefined };
    await this.audit(who, to !== from ? "event.transition" : "event.update", `arena:event:${id}`, JSON.stringify({ ...logged, ...(to !== from ? { from, to } : {}) }));
    await this.sweep();
    const after = await this.event(id);
    const overbooked = Math.max(0, after.seatsIssued - after.capacity) + Math.max(0, after.vipIssued - after.vipCapacity);
    return { ...this.toPublic(after), overbooked };
  }

  async deleteEvent(id: string, who: string) {
    const e = await this.event(id);
    if (e.status !== "draft") throw new BadRequestException({ code: "ONLY_DRAFT_DELETE" });
    await this.db.delete(arenaEvents).where(and(eq(arenaEvents.id, id), eq(arenaEvents.status, "draft")));
    await this.audit(who, "event.delete", `arena:event:${id}`, e.title);
    return { deleted: id };
  }

  // ------------------------------------------------------------------ admin: lists

  private async user(identifier: string) {
    const u = await this.access.findUser(identifier);
    if (!u) throw new NotFoundException({ code: "USER_NOT_FOUND" });
    return u;
  }

  private async people(ids: string[]) {
    if (!ids.length) return new Map<string, { id: string; username: string | null; email: string | null; phone: string | null }>();
    const us = await this.db.select().from(users).where(inArray(users.id, ids));
    return new Map(us.map((u) => [u.id, { id: u.id, username: u.username, email: u.email ? maskEmail(u.email) : null, phone: u.phone ? maskPhone(u.phone) : null }]));
  }

  async invites(eventId: string) {
    await this.event(eventId);
    const rows = await this.db.select().from(arenaInvites).where(eq(arenaInvites.eventId, eventId)).orderBy(asc(arenaInvites.createdAt));
    const ppl = await this.people(rows.map((r) => r.userId));
    return rows.map((r) => ({ user: ppl.get(r.userId), zone: r.zone, invitedBy: r.invitedBy, at: r.createdAt }));
  }

  async invite(eventId: string, identifier: string, zone: PassZone, who: string) {
    const e = await this.event(eventId);
    if (isTerminal(e.status as ArenaEventStatus)) throw new BadRequestException({ code: "EVENT_READ_ONLY" });
    const u = await this.user(identifier);
    const r = await this.db
      .insert(arenaInvites)
      .values({ eventId, userId: u.id, zone, invitedBy: who.slice(0, 120) })
      .onConflictDoUpdate({ target: [arenaInvites.eventId, arenaInvites.userId], set: { zone } })
      .returning();
    await this.audit(who, "invite.add", `arena:event:${eventId}`, `user=${u.id} zone=${zone}`);
    return { userId: u.id, zone: r[0]!.zone };
  }

  async uninvite(eventId: string, identifier: string, who: string) {
    await this.event(eventId);
    const u = await this.user(identifier);
    const gone = await this.db.delete(arenaInvites).where(and(eq(arenaInvites.eventId, eventId), eq(arenaInvites.userId, u.id))).returning();
    const revoked = gone.length ? await this.revoke(eventId, [u.id], "invite") : 0;
    if (gone.length) await this.audit(who, "invite.remove", `arena:event:${eventId}`, `user=${u.id} passRevoked=${revoked}`);
    return { userId: u.id, changed: gone.length > 0, passRevoked: revoked > 0 };
  }

  async participants(eventId: string) {
    await this.event(eventId);
    const rows = await this.db.select().from(arenaParticipants).where(eq(arenaParticipants.eventId, eventId)).orderBy(asc(arenaParticipants.createdAt));
    const ppl = await this.people(rows.map((r) => r.userId));
    return rows.map((r) => ({ user: ppl.get(r.userId), addedBy: r.addedBy, at: r.createdAt }));
  }

  async addParticipant(eventId: string, identifier: string, who: string) {
    const e = await this.event(eventId);
    if (isTerminal(e.status as ArenaEventStatus)) throw new BadRequestException({ code: "EVENT_READ_ONLY" });
    const u = await this.user(identifier);
    const r = await this.db.insert(arenaParticipants).values({ eventId, userId: u.id, addedBy: who.slice(0, 120) }).onConflictDoNothing().returning();
    if (r.length) await this.audit(who, "participant.add", `arena:event:${eventId}`, `user=${u.id}`);
    return { userId: u.id, changed: r.length > 0 };
  }

  async removeParticipant(eventId: string, identifier: string, who: string) {
    await this.event(eventId);
    const u = await this.user(identifier);
    const gone = await this.db.delete(arenaParticipants).where(and(eq(arenaParticipants.eventId, eventId), eq(arenaParticipants.userId, u.id))).returning();
    const revoked = gone.length ? await this.revoke(eventId, [u.id], "participant") : 0;
    if (gone.length) await this.audit(who, "participant.remove", `arena:event:${eventId}`, `user=${u.id} passRevoked=${revoked}`);
    return { userId: u.id, changed: gone.length > 0, passRevoked: revoked > 0 };
  }

  // ------------------------------------------------------------------ admin: bars

  async bars(now = new Date()) {
    const rows = await this.db.select().from(arenaBars).orderBy(desc(arenaBars.createdAt)).limit(500);
    const ppl = await this.people(rows.map((r) => r.userId));
    return rows.map((r) => ({ user: ppl.get(r.userId), reason: r.reason, until: r.until, barredBy: r.barredBy, at: r.createdAt, active: !r.until || r.until > now }));
  }

  async bar(identifier: string, reason: string, until: string | undefined, who: string) {
    const u = await this.user(identifier);
    const held = (await this.access.access(u.id)).roles;
    if (held.some((r) => (ARENA_STAFF_ROLES as readonly string[]).includes(r))) throw new ConflictException({ code: "STAFF_PROTECTED" });
    const untilAt = until ? new Date(until) : null;
    if (untilAt && untilAt <= new Date()) throw new BadRequestException({ code: "UNTIL_IN_PAST" });
    await this.db
      .insert(arenaBars)
      .values({ userId: u.id, reason, until: untilAt, barredBy: who.slice(0, 120) })
      .onConflictDoUpdate({ target: arenaBars.userId, set: { reason, until: untilAt, barredBy: who.slice(0, 120), createdAt: new Date() } });
    // passes for upcoming / current events are revoked
    const held2 = await this.db
      .select({ e: arenaPasses.eventId })
      .from(arenaPasses)
      .innerJoin(arenaEvents, eq(arenaEvents.id, arenaPasses.eventId))
      .where(and(eq(arenaPasses.userId, u.id), inArray(arenaEvents.status, ACTIVE)));
    let revoked = 0;
    for (const h of held2) revoked += await this.revoke(h.e, [u.id]);
    await this.audit(who, "bar.add", `user:${u.id}`, JSON.stringify({ reason, until: untilAt, passesRevoked: revoked }));
    return { userId: u.id, until: untilAt, passesRevoked: revoked };
  }

  async unbar(identifier: string, who: string) {
    const u = await this.user(identifier);
    const gone = await this.db.delete(arenaBars).where(eq(arenaBars.userId, u.id)).returning();
    if (gone.length) await this.audit(who, "bar.remove", `user:${u.id}`, null);
    return { userId: u.id, changed: gone.length > 0 };
  }

  // ------------------------------------------------------------------ admin: attendance, audit

  async attendance(eventId: string) {
    const e = await this.event(eventId);
    const passes = await this.db.select().from(arenaPasses).where(eq(arenaPasses.eventId, eventId)).orderBy(asc(arenaPasses.createdAt));
    const ppl = await this.people(passes.map((p) => p.userId));
    const inside = this.presence.inside();
    return {
      event: this.toPublic(e),
      occupancy: this.presence.totals(),
      passes: passes.map((p) => ({ user: ppl.get(p.userId), zone: p.zone, seat: p.seat, via: p.via, at: p.createdAt, inside: inside.has(p.userId) })),
    };
  }

  async auditLog(limit = 100) {
    return this.db
      .select()
      .from(accessAudit)
      .where(or(ilike(accessAudit.target, "arena:%"), ilike(accessAudit.action, "bar.%"), eq(accessAudit.target, `role:${EVENT_MANAGER}`)))
      .orderBy(desc(accessAudit.at))
      .limit(Math.max(1, Math.min(500, limit)));
  }

  // ------------------------------------------------------------------ internal (realtime)

  async realtimeState(now = new Date()): Promise<ArenaRealtimeState> {
    const s = await this.settings();
    const cur = await this.current(now);
    const bars = await this.db.select().from(arenaBars).limit(5000);
    return {
      open: s.effectiveOpen,
      maxConcourse: s.maxConcourse,
      current: cur
        ? {
            id: cur.id,
            status: cur.status as ArenaEventStatus,
            openSeating: isOpenSeating(cur.rules as ArenaScopeRule[]),
            capacity: cur.capacity,
            vipCapacity: cur.vipCapacity,
            passesIssued: cur.seatsIssued + cur.vipIssued + cur.floorIssued,
          }
        : null,
      barred: bars.filter((b) => !b.until || b.until > now).map((b) => b.userId),
    };
  }

  async userAccess(userId: string, eventId?: string): Promise<ArenaUserAccess> {
    const s = await this.settings();
    if (!UUID.test(userId)) return { open: s.effectiveOpen, barred: false, pass: null, roles: [], level: 0 };
    const ev = eventId && UUID.test(eventId) ? eventId : (await this.current())?.id;
    const [u] = await this.db.select({ xp: users.xp }).from(users).where(eq(users.id, userId));
    return {
      open: s.effectiveOpen,
      barred: await this.isBarred(userId),
      pass: ev ? await this.passOf(userId, ev) : null,
      roles: (await this.access.access(userId)).roles,
      level: levelForXp(u?.xp ?? 0),
    };
  }

  /** drizzle transaction over the pg | pglite union type */
  private tx<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.db as any).transaction(fn);
  }

  private async audit(who: string, action: string, target: string, detail: string | null) {
    await this.db.insert(accessAudit).values({ id: newId(), who: who.slice(0, 120), action, target, detail: detail?.slice(0, 2000) ?? null });
  }
}
