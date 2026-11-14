import {
  ARENA_STAFF_ROLES,
  ArenaEvt,
  ArenaSeatSchema,
  ArenaZoneMsgSchema,
  arenaSeatZone,
  isValidArenaSeat,
  type ArenaDenial,
  type ArenaRealtimeState,
  type ArenaZone,
} from "@gukirana/contracts";
import { RateLimiter } from "../social/rate.js";
import { arenaAccessOf, arenaConfig, arenaState, reportArena } from "../social/arena-access.js";

/** What the arena logic needs from its WorldRoom (keeps world-room.ts edits small). */
export interface ArenaHost {
  roomId: string;
  players(): string[];
  uidOf(sid: string): string | undefined;
  send(sid: string, type: string, msg: unknown): void;
  broadcast(type: string, msg: unknown): void;
  /** drop the client from the room */
  kick(sid: string): void;
  later(fn: () => void, ms: number): void;
}

type Action = "enter" | "zone" | "sit";
const isStaff = (roles: string[]) => roles.some((r) => (ARENA_STAFF_ROLES as readonly string[]).includes(r));

/**
 * Tournament Arena rules inside the hall room with game "arena" (P2-ARN-02, docs/ARENA-REQUIREMENTS.md).
 * The server decides: entry gate (open, not barred, room size), zones (pass / floor / VIP), seats (valid id, free,
 * one per person), removal when the arena closes or someone is barred (state poll every ~5 s).
 */
export class ArenaHall {
  private zone = new Map<string, ArenaZone>();
  private seatOf = new Map<string, string>();
  private seatBy = new Map<string, string>(); // seat → sid
  private staff = new Set<string>();
  private removed = new Set<string>();
  private rate = new RateLimiter();
  private eventKey: string | null = null; // `${id}:${status}`
  private eventId: string | null = null;
  private reportQueued = false;
  /** commentator desk: the staff member on air (arena-wide voice), P2-ARN-04 */
  private onAir: string | null = null;

  constructor(private readonly host: ArenaHost) {}

  // ---------------------------------------------------------------- join / leave

  /** Entry check before the person becomes visible. `count` = people already inside. */
  async gate(sid: string, uid: string | undefined, count: number): Promise<ArenaDenial | null> {
    const s = await arenaState();
    let staff = false;
    if (uid) {
      const acc = await arenaAccessOf(uid, s.current?.id);
      staff = isStaff(acc.roles);
      if (!staff && (acc.barred || s.barred.includes(uid))) return "BARRED";
    }
    if (!s.open && !staff) return "ARENA_CLOSED";
    if (!staff && count >= s.maxConcourse) return "ROOM_FULL";
    if (staff) this.staff.add(sid);
    return null;
  }

  /** Refuse entry: tell the client (it walks back to the plaza), then drop it. */
  refuse(sid: string, reason: ArenaDenial): void {
    this.removed.add(sid);
    this.host.send(sid, ArenaEvt.denied, { action: "enter", reason });
    this.host.later(() => this.host.kick(sid), arenaConfig.removeGraceMs);
  }

  async joined(sid: string): Promise<void> {
    this.zone.set(sid, "concourse");
    const s = await arenaState();
    if (!this.noteEvent(s) && s.current) this.host.send(sid, ArenaEvt.event, { eventId: s.current.id, status: s.current.status });
    this.host.send(sid, ArenaEvt.seats, { taken: [...this.seatBy.keys()] });
    this.host.send(sid, ArenaEvt.onAir, { sid: this.onAir });
    this.changed();
  }

  left(sid: string): void {
    const hadSeat = this.free(sid);
    if (this.onAir === sid) {
      this.onAir = null;
      this.host.broadcast(ArenaEvt.onAir, { sid: null });
    }
    this.zone.delete(sid);
    this.staff.delete(sid);
    this.removed.delete(sid);
    this.rate.forget(`${sid}:`);
    if (hadSeat) this.seatsChanged();
    this.changed();
  }

  // ---------------------------------------------------------------- messages

  private deny(sid: string, action: Action, reason: ArenaDenial) {
    this.host.send(sid, ArenaEvt.denied, { action, reason });
  }

  private allowed(sid: string, action: Action): boolean {
    if (this.removed.has(sid) || !this.zone.has(sid)) return false;
    if (this.rate.allow(`${sid}:arena`, arenaConfig.actionMax, arenaConfig.actionWindowMs, Date.now())) return true;
    this.deny(sid, action, "RATE_LIMITED");
    return false;
  }

  /** May `sid` be in `zone` right now? null = yes. */
  private async zoneCheck(sid: string, zone: Exclude<ArenaZone, "concourse">): Promise<ArenaDenial | null> {
    const s = await arenaState();
    const staff = this.staff.has(sid);
    if (staff) return null;
    if (!s.open) return "ARENA_CLOSED";
    const ev = s.current;
    if (!ev) return zone === "floor" ? "EVENT_NOT_OPEN" : null; // no event: the bowl is free for all, the floor is staff only
    if (zone === "seats" && ev.openSeating) return null;
    const uid = this.host.uidOf(sid);
    if (!uid) return "LOGIN_REQUIRED";
    const fits = (p: { eventId: string; zone: string } | null) =>
      !!p && p.eventId === ev.id && (zone === "seats" || p.zone === zone);
    let acc = await arenaAccessOf(uid, ev.id);
    if (acc.barred) return "BARRED";
    if (!fits(acc.pass)) acc = await arenaAccessOf(uid, ev.id, true); // claimed a moment ago? ask the API once more
    if (fits(acc.pass)) return null;
    return zone === "floor" ? "NOT_PARTICIPANT" : "NO_PASS";
  }

  async onZone(sid: string, raw: unknown): Promise<void> {
    const parsed = ArenaZoneMsgSchema.safeParse(raw);
    if (!parsed.success || !this.allowed(sid, "zone")) return;
    const zone = parsed.data.zone;
    const denial = await this.zoneCheck(sid, zone);
    if (!this.zone.has(sid) || this.removed.has(sid)) return; // left meanwhile
    if (denial) return this.deny(sid, "zone", denial);
    this.enterZone(sid, zone);
  }

  private enterZone(sid: string, zone: ArenaZone) {
    const prev = this.zone.get(sid);
    if (prev === zone) return void this.host.send(sid, ArenaEvt.zoneOk, { zone });
    this.zone.set(sid, zone);
    const seat = this.seatOf.get(sid);
    if (seat && (zone === "concourse" || zone === "floor" || arenaSeatZone(seat) !== zone)) {
      this.free(sid);
      this.seatsChanged();
    }
    this.host.send(sid, ArenaEvt.zoneOk, { zone });
    this.changed();
  }

  async onSit(sid: string, raw: { seat?: unknown } | undefined): Promise<void> {
    const seat = raw?.seat;
    if (!ArenaSeatSchema.safeParse(seat).success || !isValidArenaSeat(seat)) return; // not a bowl seat: ignored
    if (!this.allowed(sid, "sit")) return;
    const zone = arenaSeatZone(seat);
    const denial = await this.zoneCheck(sid, zone);
    if (!this.zone.has(sid) || this.removed.has(sid)) return;
    if (denial) return this.deny(sid, "sit", denial);
    const holder = this.seatBy.get(seat);
    if (holder === sid) return void this.host.send(sid, ArenaEvt.seated, { seat });
    if (holder) return this.deny(sid, "sit", "SEAT_TAKEN");
    const s = await arenaState();
    if (s.current?.openSeating && zone === "seats" && !this.staff.has(sid) && !this.seatOf.has(sid)) {
      const seatedInSeats = [...this.seatBy.keys()].filter((k) => arenaSeatZone(k) === "seats").length;
      if (seatedInSeats >= s.current.capacity) return this.deny(sid, "sit", "SOLD_OUT");
    }
    if (this.seatBy.has(seat)) return this.deny(sid, "sit", "SEAT_TAKEN"); // taken while we waited
    if (this.zone.get(sid) !== zone) this.enterZone(sid, zone);
    this.free(sid);
    this.seatBy.set(seat, sid);
    this.seatOf.set(sid, seat);
    this.host.send(sid, ArenaEvt.seated, { seat });
    this.seatsChanged();
    this.changed();
  }

  onStand(sid: string): void {
    if (this.removed.has(sid) || !this.zone.has(sid)) return;
    if (this.free(sid)) {
      this.seatsChanged();
      this.changed();
    }
  }

  /** The commentator desk mic: staff only, one voice at a time; releasing is always allowed for the holder. */
  onMic(sid: string, raw: { on?: unknown } | undefined): void {
    if (!this.allowed(sid, "zone")) return;
    const on = raw?.on === true;
    if (on) {
      if (!this.staff.has(sid)) return this.deny(sid, "zone", "ROLE_REQUIRED");
      if (this.onAir === sid) return;
      this.onAir = sid; // a second staff member takes over the desk
    } else {
      if (this.onAir !== sid) return;
      this.onAir = null;
    }
    this.host.broadcast(ArenaEvt.onAir, { sid: this.onAir });
  }

  // ---------------------------------------------------------------- state poll

  /** Apply the latest building state: close → everyone (but staff) out; barred → out; event change → back to the concourse. */
  async sync(): Promise<void> {
    const s = await arenaState(true);
    for (const sid of this.host.players()) {
      if (this.removed.has(sid) || this.staff.has(sid)) continue;
      const uid = this.host.uidOf(sid);
      if (!s.open) this.remove(sid, "ARENA_CLOSED");
      else if (uid && s.barred.includes(uid)) this.remove(sid, "BARRED");
    }
    this.noteEvent(s);
  }

  /** true when the event (or its status) changed and was announced */
  private noteEvent(s: ArenaRealtimeState): boolean {
    const key = s.current ? `${s.current.id}:${s.current.status}` : null;
    if (key === this.eventKey) return false;
    const prevId = this.eventId;
    const prevKey = this.eventKey;
    this.eventKey = key;
    this.eventId = s.current?.id ?? null;
    if (s.current) this.host.broadcast(ArenaEvt.event, { eventId: s.current.id, status: s.current.status });
    else if (prevId && prevKey) this.host.broadcast(ArenaEvt.event, { eventId: prevId, status: "ended" });
    if (prevId === this.eventId) return true; // same event, new status (doors_open → live)
    // a different event (or none): passes of the old one no longer count — back to the concourse, seats freed
    let seatsMoved = false;
    for (const sid of this.host.players()) {
      if (this.staff.has(sid) || this.removed.has(sid)) continue;
      const z = this.zone.get(sid);
      const keep = !s.current && (z === "seats" || z === "vip"); // event over: free seating again
      if (!z || z === "concourse" || keep) continue;
      if (this.free(sid)) seatsMoved = true;
      this.zone.set(sid, "concourse");
      this.host.send(sid, ArenaEvt.zoneOk, { zone: "concourse" });
    }
    if (seatsMoved) this.seatsChanged();
    this.changed();
    return true;
  }

  private remove(sid: string, reason: "ARENA_CLOSED" | "BARRED") {
    this.removed.add(sid);
    if (this.free(sid)) this.seatsChanged();
    this.zone.set(sid, "concourse");
    this.host.send(sid, ArenaEvt.removed, { reason });
    this.host.later(() => this.host.kick(sid), arenaConfig.removeGraceMs);
    this.changed();
  }

  // ---------------------------------------------------------------- occupancy

  private free(sid: string): boolean {
    const seat = this.seatOf.get(sid);
    if (!seat) return false;
    this.seatOf.delete(sid);
    if (this.seatBy.get(seat) === sid) this.seatBy.delete(seat);
    return true;
  }

  private seatsChanged() {
    this.host.broadcast(ArenaEvt.seats, { taken: [...this.seatBy.keys()] });
  }

  occupancy() {
    const inRoom = [...this.zone.keys()].filter((sid) => !this.removed.has(sid));
    return {
      concourse: inRoom.length,
      seats: [...this.seatOf.keys()].filter((sid) => !this.removed.has(sid)).length,
      inside: inRoom.map((sid) => this.host.uidOf(sid)).filter((u): u is string => !!u),
    };
  }

  /** broadcast + (throttled) report to the API */
  private changed() {
    const o = this.occupancy();
    this.host.broadcast(ArenaEvt.occupancy, { concourse: o.concourse, seats: o.seats });
    if (this.reportQueued) return;
    this.reportQueued = true;
    this.host.later(() => {
      this.reportQueued = false;
      this.report();
    }, 1_000);
  }

  report(): void {
    reportArena(this.host.roomId, this.occupancy());
  }
}
