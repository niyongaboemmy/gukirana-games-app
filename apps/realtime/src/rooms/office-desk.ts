import type { Client } from "@colyseus/core";
import {
  answerAction,
  CHAT_MIN_INTERVAL_MS,
  KNOCK_WAIT_TTL_MS,
  OFFICE_CAPACITY,
  OfficeAnswerSchema,
  OfficeCancelSchema,
  OfficeChatSchema,
  OfficeEnterSchema,
  OfficeEvt,
  OfficeEvtV2,
  OfficeMsg,
  OfficeMsgV2,
  parseAdminSeat,
  type KnockOutcome,
  type OfficeRefusal,
  type WaitReason,
} from "@gukirana/contracts";
import { filterChat } from "../chat-filter.js";
import { OfficeRegistry, type Knock, type Via } from "../social/offices.js";
import { accessOf, officeConfig, reportOccupancy } from "../social/office-access.js";
import type { SeatRegistry } from "../social/seats.js";
import type { RateLimiter } from "../social/rate.js";

/** What the Administrative Block needs from its hall room (world-room.ts). */
export interface DeskHost {
  readonly roomId: string;
  client(sid: string): Client | undefined;
  player(sid: string): { id: string; name: string; color: string; level: number } | undefined;
  /** account id of a signed-in session */
  uid(sid: string): string | undefined;
  broadcast(type: string, payload: unknown): void;
  later(fn: () => void, ms: number): void;
  every(fn: () => void, ms: number): void;
  onMessage(type: string, fn: (client: Client, raw: unknown) => void): void;
  readonly seats: SeatRegistry;
  broadcastSeats(): void;
  readonly rate: RateLimiter;
}

/**
 * Administrative Block offices (hall room game "admin", P2-ADM-03 / P2-ADM-04): role holders walk in, everyone else
 * knocks. Staff inside see the queue of knocks and answer each one Let in / Please wait / Decline; an office takes
 * visitors up to its visitor chairs (a full office keeps the knock queued, never refuses it). The people inside one
 * office share a private conversation (office text chat + office-scoped voice: the voice relay only connects
 * people in the same office, or two people both outside the offices). Office chairs are claimed through the room's
 * seat registry and checked here: visitor / meeting chairs only for people inside that office, the officer chair
 * only for a holder of the office's role who is inside.
 */
export class OfficeDesk {
  readonly offices = new OfficeRegistry();
  private lastChat = new Map<string, number>();

  constructor(private readonly h: DeskHost) {
    h.onMessage(OfficeMsg.enter, (c, raw) => void this.onEnter(c, raw));
    h.onMessage(OfficeMsg.answer, (c, raw) => void this.onAnswer(c, raw));
    h.onMessage(OfficeMsg.leave, (c, raw) => {
      const o = this.offices.officeOf(c.sessionId);
      const want = (raw as { office?: unknown } | undefined)?.office;
      if (o && (want === undefined || want === o) && this.offices.leave(c.sessionId)) this.leftOffice(o, c.sessionId);
    });
    h.onMessage(OfficeMsgV2.cancel, (c, raw) => {
      const p = OfficeCancelSchema.safeParse(raw);
      const k = p.success ? this.offices.get(p.data.knockId) : undefined;
      if (k && k.from === c.sessionId && this.offices.take(k.id)) this.closed(k, "CANCELLED");
    });
    h.onMessage(OfficeMsgV2.chat, (c, raw) => this.onChat(c, raw));
    // heartbeat so the API's reception count survives (and expires after) realtime restarts
    h.every(() => {
      const snap = this.offices.snapshot();
      if (Object.keys(snap).length) this.report();
    }, officeConfig.reportMs);
  }

  // ---------------------------------------------------------------- helpers
  private refuse(sid: string, office: string, reason: OfficeRefusal, knockId?: string) {
    this.h.client(sid)?.send(OfficeEvt.refused, knockId ? { office, knockId, reason } : { office, reason });
  }
  private report() {
    const visitors: Record<string, number> = {};
    for (const o of Object.keys(this.offices.snapshot())) {
      const n = this.offices.visitors(o).length;
      if (n) visitors[o] = n;
    }
    reportOccupancy(this.h.roomId, this.offices.snapshot(), visitors);
  }
  private occupancy(office: string) {
    return { office, occupants: this.offices.staff(office).length, visitors: this.offices.visitors(office).length, queue: this.offices.knocksTo(office).length };
  }
  /** lamps + directory for everyone (counts only), the member list for the people inside */
  private officeChanged(office: string) {
    this.h.broadcast(OfficeEvt.occupancy, this.occupancy(office));
    this.sendMembers(office);
    this.report();
  }
  private queueChanged(office: string) {
    this.h.broadcast(OfficeEvt.occupancy, this.occupancy(office));
  }
  private sendMembers(office: string) {
    const inside = this.offices.occupants(office);
    const members = inside.flatMap((sid) => {
      const p = this.h.player(sid);
      return p ? [{ id: p.id, name: p.name, staff: this.offices.viaOf(sid) === "role" }] : [];
    });
    for (const sid of inside) this.h.client(sid)?.send(OfficeEvtV2.members, { office, members });
  }
  /** Sessions inside `office` who may answer its door right now (fresh role check, cached ~15 s). */
  private async answerers(office: string): Promise<string[]> {
    const out: string[] = [];
    for (const sid of this.offices.staff(office)) {
      const uid = this.h.uid(sid);
      if (uid && (await accessOf(uid)).offices.includes(office)) out.push(sid);
    }
    return out;
  }
  private knockMsg(k: Knock, ttl?: number) {
    const p = this.h.player(k.from);
    return {
      office: k.office,
      knockId: k.id,
      from: { id: k.from, name: p?.name ?? "Visitor", level: p?.level ?? 1 },
      expiresInMs: ttl ?? Math.max(0, k.expires - Date.now()),
      status: k.status,
      full: this.offices.isFull(k.office, OFFICE_CAPACITY),
    };
  }
  /** (re)announce a knock to the staff inside its office */
  private toStaff(k: Knock) {
    const m = this.knockMsg(k);
    for (const s of this.offices.staff(k.office)) this.h.client(s)?.send(OfficeEvt.knock, m);
  }
  /** a knock is finished: staff prompts close everywhere */
  private closed(k: Knock, outcome: KnockOutcome) {
    for (const s of this.offices.staff(k.office)) this.h.client(s)?.send(OfficeEvtV2.knockClosed, { office: k.office, knockId: k.id, outcome });
    this.queueChanged(k.office);
  }
  private hold(k: Knock, reason: WaitReason) {
    this.offices.hold(k.id, Date.now() + KNOCK_WAIT_TTL_MS);
    this.h.client(k.from)?.send(OfficeEvtV2.wait, { office: k.office, knockId: k.id, expiresInMs: Math.max(0, k.expires - Date.now()), reason });
    this.toStaff(k);
    this.queueChanged(k.office);
  }
  /** expiry timer that follows the knock's (extendable) deadline */
  private expireLater(k: Knock) {
    this.h.later(
      () => {
        const cur = this.offices.get(k.id);
        if (!cur) return;
        const left = cur.expires - Date.now();
        if (left > 20) return this.expireLater(cur);
        if (!this.offices.take(cur.id)) return;
        this.refuse(cur.from, cur.office, "EXPIRED", cur.id);
        this.closed(cur, "EXPIRED");
      },
      Math.max(10, k.expires - Date.now()),
    );
  }
  /** frees an office chair held by `sid` unless it belongs to `keep` */
  private releaseOfficeSeat(sid: string, keep?: string) {
    const s = parseAdminSeat(this.h.seats.seatOf(sid));
    if (s && s.kind !== "lobby" && s.office !== keep && this.h.seats.release(sid)) this.h.broadcastSeats();
  }

  private admit(sid: string, office: string, via: Via) {
    const prev = this.offices.enter(sid, office, via);
    for (const k of this.offices.knocksBy(sid)) if (k.office === office && this.offices.take(k.id)) this.closed(k, "ALLOWED");
    this.h.client(sid)?.send(OfficeEvt.admitted, { office, via });
    if (prev) this.leftOffice(prev, sid);
    this.releaseOfficeSeat(sid, office);
    this.officeChanged(office);
    // staff walking in see the queue at their door
    if (via === "role") for (const k of this.offices.knocksTo(office)) this.h.client(sid)?.send(OfficeEvt.knock, this.knockMsg(k));
  }
  /** After `who` left `office`: lamps + members; knocks nobody can answer any more are refused. */
  private leftOffice(office: string, who?: string) {
    if (who) {
      this.releaseOfficeSeat(who);
      this.h.client(who)?.send(OfficeEvtV2.members, { office, members: [] });
    }
    this.officeChanged(office);
    if (this.offices.staff(office).length) {
      // a visitor chair came free: staff see the queue again (Let in is possible now)
      for (const k of this.offices.knocksTo(office)) this.toStaff(k);
      return;
    }
    for (const k of this.offices.knocksTo(office))
      if (this.offices.take(k.id)) {
        this.refuse(k.from, office, "NOBODY_INSIDE", k.id);
        this.queueChanged(office);
      }
  }

  private async onEnter(client: Client, raw: unknown) {
    const parsed = OfficeEnterSchema.safeParse(raw);
    if (!parsed.success) return;
    const sid = client.sessionId;
    const { office } = parsed.data;
    const uid = this.h.uid(sid);
    if (!uid) return this.refuse(sid, office, "LOGIN_REQUIRED");
    if (this.offices.officeOf(sid) === office) return client.send(OfficeEvt.admitted, { office, via: this.offices.viaOf(sid) });
    const acc = await accessOf(uid);
    if (!this.h.player(sid)) return; // left meanwhile
    if (!acc.known.includes(office)) return this.refuse(sid, office, "NOT_ALLOWED");
    if (acc.offices.includes(office)) return this.admit(sid, office, "role");
    const open = this.offices.openKnockFrom(sid, office);
    if (open) {
      client.send(OfficeEvt.knocking, { office, knockId: open.id, expiresInMs: Math.max(0, open.expires - Date.now()) });
      if (open.status === "waiting") client.send(OfficeEvtV2.wait, { office, knockId: open.id, expiresInMs: Math.max(0, open.expires - Date.now()), reason: this.offices.isFull(office, OFFICE_CAPACITY) ? "FULL" : "ASKED" });
      return;
    }
    const inside = await this.answerers(office);
    if (!this.h.player(sid) || this.offices.officeOf(sid) === office) return;
    if (!inside.length) return this.refuse(sid, office, "NOBODY_INSIDE");
    // no awaits from here: the rate check and the new knock happen together
    const now = Date.now();
    if (this.offices.openKnockFrom(sid, office)) return;
    if (!this.offices.mayKnock(sid, office, now, officeConfig.knockGapMs, officeConfig.maxOpenKnocks)) return this.refuse(sid, office, "RATE_LIMITED");
    const ttl = officeConfig.knockTtlMs;
    const k = this.offices.knock(sid, office, now, ttl);
    client.send(OfficeEvt.knocking, { office, knockId: k.id, expiresInMs: ttl });
    // a full office queues the knock (the visitor is asked to wait in the lobby), it never refuses it
    if (this.offices.isFull(office, OFFICE_CAPACITY)) this.hold(k, "FULL");
    else {
      const m = this.knockMsg(k, ttl);
      for (const s of inside) this.h.client(s)?.send(OfficeEvt.knock, m);
      this.queueChanged(office);
    }
    this.expireLater(k);
  }

  private async onAnswer(client: Client, raw: unknown) {
    const parsed = OfficeAnswerSchema.safeParse(raw);
    if (!parsed.success) return;
    const sid = client.sessionId;
    const k = this.offices.get(parsed.data.knockId);
    const uid = this.h.uid(sid);
    if (!k || !uid || this.offices.viaOf(sid) !== "role" || this.offices.officeOf(sid) !== k.office) return;
    if (!(await accessOf(uid)).offices.includes(k.office)) return; // role revoked meanwhile
    if (this.offices.officeOf(sid) !== k.office || !this.offices.get(k.id)) return; // answered by someone else / expired
    if (!this.h.player(k.from)) return;
    const action = answerAction(parsed.data);
    if (action === "wait") return this.hold(k, "ASKED");
    if (action === "allow" && this.offices.isFull(k.office, OFFICE_CAPACITY)) return this.hold(k, "FULL");
    if (!this.offices.take(k.id)) return;
    if (action === "allow") {
      this.admit(k.from, k.office, "invite");
      this.closed(k, "ALLOWED");
    } else {
      this.refuse(k.from, k.office, "DECLINED", k.id);
      this.closed(k, "DECLINED");
    }
  }

  private onChat(client: Client, raw: unknown) {
    const sid = client.sessionId;
    const office = this.offices.officeOf(sid);
    const p = this.h.player(sid);
    const parsed = OfficeChatSchema.safeParse(raw);
    if (!office || !p || !parsed.success) return;
    const now = Date.now();
    if (now - (this.lastChat.get(sid) ?? 0) < CHAT_MIN_INTERVAL_MS) return;
    if (!this.h.rate.allow(`${sid}:ochat`, 20, 30_000, now)) return client.send("chat-warning", { reason: "rate" });
    this.lastChat.set(sid, now);
    const r = filterChat(parsed.data.text);
    if (r.blocked) return client.send("chat-warning", { reason: r.reason });
    if (!r.text) return;
    const msg = { office, id: p.id, name: p.name, color: p.color, text: r.text, t: now };
    for (const s of this.offices.occupants(office)) this.h.client(s)?.send(OfficeEvtV2.chat, msg);
  }

  // ---------------------------------------------------------------- room hooks

  /**
   * A `sit` request in the admin hall. Lobby seats: anyone; office chairs: checked against who is inside (and the
   * officer chair against the role). Replies like the generic handler (seats broadcast / seat-taken).
   */
  async sit(client: Client, seat: unknown): Promise<void> {
    const sid = client.sessionId;
    const s = parseAdminSeat(seat);
    if (!s) return;
    if (s.kind !== "lobby") {
      if (this.offices.officeOf(sid) !== s.office) return void client.send("seat-taken", { seat, reason: "NOT_INSIDE" });
      if (s.kind === "officer") {
        const uid = this.h.uid(sid);
        const ok = this.offices.viaOf(sid) === "role" && !!uid && (await accessOf(uid)).offices.includes(s.office);
        if (!ok || this.offices.officeOf(sid) !== s.office) return void client.send("seat-taken", { seat, reason: "STAFF_ONLY" });
      }
    }
    if (!this.h.player(sid)) return;
    const r = this.h.seats.claim(seat, sid);
    if (r === "taken") return void client.send("seat-taken", { seat });
    if (r === "ok") this.h.broadcastSeats();
  }

  /** voice relay: both in the same office, or both outside the offices (lobby / corridor proximity voice) */
  sameRoom(a: string, b: string): boolean {
    return this.offices.officeOf(a) === this.offices.officeOf(b);
  }

  onJoin(client: Client): void {
    for (const office of Object.keys(this.offices.snapshot())) client.send(OfficeEvt.occupancy, this.occupancy(office));
  }

  onLeave(sid: string): void {
    this.lastChat.delete(sid);
    for (const k of this.offices.forget(sid)) this.closed(k, "LEFT");
    const office = this.offices.leave(sid);
    if (office) this.leftOffice(office);
  }

  dispose(): void {
    reportOccupancy(this.h.roomId, {});
  }
}
