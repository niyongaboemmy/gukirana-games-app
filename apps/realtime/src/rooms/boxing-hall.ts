import {
  BOXING_AOI_RADIUS,
  BoxingClaimSchema,
  BoxingHallEvt,
  BoxingQuickSchema,
  BoxingRingMsgSchema,
  BoxingWatchSchema,
  FEATURE_RINGS,
  FIGHT_MATCH_WINDOW,
  MAX_FIGHT_PING_MS,
  PERSONAL_REFUSALS,
  RING_IDS,
  RING_REACH_M,
  RING_RESULT_SECONDS,
  RING_WATCHERS_MAX,
  type BoxingDenial,
  type BoxingSnapshot,
  type Corner,
  type FightEvent,
  type FightRules,
  type MatchRules,
  type RingFighter,
  type RingId,
  type RingState,
} from "@gukirana/contracts";
import { RateLimiter } from "../social/rate.js";
import type { Eligibility } from "../api-client.js";
import { distanceToRing } from "./boxing-rings.js";

/**
 * P2-NET-06: what the hall asks its room to keep when a waiting / practising fighter loses their connection. The room
 * answers with the hold (its `until`) or null (holds off, the abuse limit): then the ring frees at once, as before.
 */
export interface RingKeep {
  place: RingId;
  state: "waiting" | "practice";
  stake?: number;
  since: number;
}
export type KeepRing = (k: RingKeep) => { until: number } | null;

/** What the Boxing hall logic needs from its WorldRoom (keeps world-room.ts edits small, like ArenaHost). */
export interface BoxingHost {
  roomId: string;
  uidOf(sid: string): string | undefined;
  nameOf(sid: string): string;
  levelOf(sid: string): number | undefined;
  /** last server-kept position (metres, hall coordinates) */
  posOf(sid: string): { x: number; z: number } | undefined;
  /** the session is still in the room */
  has(sid: string): boolean;
  send(sid: string, type: string, msg: unknown): void;
  broadcast(type: string, msg: unknown): void;
  later(fn: () => void, ms: number): void;
}

/** a fight room the hall started (rooms/boxing-room.ts) */
export interface StartedFight {
  roomId: string;
  matchId: string;
  rules: MatchRules;
}
export interface StartFightInput {
  hallId: string;
  ring: RingId;
  stake: number;
  red: RingFighter & { userId: string };
  blue: RingFighter & { userId: string };
}
export interface BoxingDeps {
  /** games API pre-check for this player at this stake in game boxing (fail-open; createMatch re-checks) */
  eligibility(userId: string, stake: number): Promise<Eligibility>;
  /** API createMatch (escrow) + the authoritative fight room */
  start(input: StartFightInput): Promise<StartedFight>;
  /** a fighter pressed Leave in the hall while their fight runs: the fight room applies the exit rules */
  leaveFight(roomId: string, userId: string): void;
  /** the player's boxing rating for matchmaking (P3-FGT-10; fail-open: null = unrated) */
  rating?(userId: string): Promise<{ rating: number; rd: number } | null>;
}

/**
 * Quick-fight rating window (P3-FGT-10, docs/FIGHT-GAME-V2.md §7.4): a waiting player accepts opponents within
 * `start` rating points, widening by `step` every `stepSeconds` up to `max`; after that anyone at the stake.
 * Two players match when the gap fits the wider of their two windows; the closest rating wins, then the longest wait.
 */
export function matchWindow(waitedMs: number): number {
  const w = FIGHT_MATCH_WINDOW;
  const steps = Math.floor(waitedMs / (w.stepSeconds * 1000));
  const win = w.start + w.step * steps;
  return win > w.max ? Infinity : win;
}

/** knobs tests shorten */
export const boxingHallConfig = {
  /** the server checks the claimer stands near the ring (off only in tests without positions) */
  checkReach: true,
  actionMax: 12,
  actionWindowMs: 5_000,
  pingEveryMs: 5_000,
  /** pings kept for the median */
  pingSamples: 5,
  resultMs: RING_RESULT_SECONDS * 1000,
};

type Action = "claim" | "join" | "leave" | "quick" | "practice" | "watch" | "proposal";
const PERSONAL = new Set<string>(PERSONAL_REFUSALS);
const OPPONENT_CANT_PLAY = "OPPONENT_CANT_PLAY";
const watchersMax = (id: RingId) => ((FEATURE_RINGS as readonly string[]).includes(id) ? 2 * RING_WATCHERS_MAX : RING_WATCHERS_MAX);
const errCode = (e: unknown) => (e instanceof Error ? e.message : String(e));
const errUser = (e: unknown) => (e as { userId?: string } | undefined)?.userId;
const errLimit = (e: unknown) => (e as { limit?: number } | undefined)?.limit;

/** every Boxing hall instance in this process (fight rooms report ring status / frames back to their hall) */
const halls = new Map<string, BoxingHall>();
export const boxingHallOf = (roomId: string): BoxingHall | undefined => halls.get(roomId);

/**
 * The Boxing sub-hall (hall room with game "boxing", P3-FGT-01, docs/FIGHT-GAMES-PLAN.md §4.3, §7.1): the registry of
 * the rings of this instance (BOXING_RING_COUNT), every ring action with its server checks, the quick-fight queue per stake, fight
 * assignment (escrow happens in the API through `deps.start`), spectator relay and the world-move area of interest.
 * The fight itself runs in its own `boxing` room; it reports back here (`fightStatus`, `fightFrame`, `fightOver`).
 * No bots: practice runs in the player's browser; the hall only marks the ring and relays its score.
 */
export class BoxingHall {
  private rings = new Map<RingId, RingState>();
  /** session → the ring it holds (one ring per person) */
  private holding = new Map<string, RingId>();
  private watching = new Map<string, RingId>();
  private watchers = new Map<RingId, Set<string>>();
  /** quick fight: stake → sessions waiting, in arrival order; their rating and when they joined the queue */
  private queue = new Map<number, string[]>();
  private qInfo = new Map<string, { rating: number; at: number }>();
  private rate = new RateLimiter();
  private rtt = new Map<string, number[]>();
  private pings = new Map<string, { n: number; at: number }>();
  private pingN = 0;
  /** a fighter pressed Leave while the match was being created: applied once the room exists */
  private leaveAfterStart = new Map<RingId, string>();
  /** P2-NET-06: rings kept for a fighter who lost their connection: ring → when the hold ends; account → its ring */
  private heldUntil = new Map<RingId, number>();
  private heldBy = new Map<string, RingId>();

  constructor(
    private readonly host: BoxingHost,
    private readonly deps: BoxingDeps,
  ) {
    const now = Date.now();
    for (const id of RING_IDS) this.rings.set(id, { id, status: "free", watchers: 0, since: now });
    halls.set(host.roomId, this);
  }

  dispose(): void {
    halls.delete(this.host.roomId);
  }

  // ---------------------------------------------------------------- join / leave

  joined(sid: string, back?: { place: string }): void {
    const uid = this.host.uidOf(sid);
    // P2-NET-06: back inside the hold → the same ring, the same state (waiting at its stake / practice)
    const kept = uid ? this.heldBy.get(uid) : undefined;
    if (uid && kept && back?.place === kept) {
      const r = this.rings.get(kept)!;
      this.heldBy.delete(uid);
      this.heldUntil.delete(kept);
      if (r.red?.userId === uid && (r.status === "waiting" || r.status === "practice")) {
        r.red.sid = sid;
        r.red.name = this.host.nameOf(sid);
        this.holding.set(sid, kept);
        this.host.send(sid, BoxingHallEvt.rings, this.list());
        this.host.send(sid, BoxingHallEvt.assigned, { ring: kept, corner: "red" });
        this.ringChanged(r);
        return;
      }
    }
    this.host.send(sid, BoxingHallEvt.rings, this.list());
    // back after a reload while their fight runs: the ring is theirs again (kit, fight room)
    if (!uid) return;
    for (const r of this.rings.values()) {
      const corner: Corner | null = r.red?.userId === uid ? "red" : r.blue?.userId === uid ? "blue" : null;
      if (!corner || r.status === "free" || r.status === "practice" || this.heldUntil.has(r.id)) continue;
      const f = r[corner]!;
      if (f.sid !== sid) {
        for (const [s, id] of this.holding) if (id === r.id && s === f.sid) this.holding.delete(s);
        f.sid = sid;
        this.holding.set(sid, r.id);
        this.ringChanged(r);
      }
      this.host.send(sid, BoxingHallEvt.assigned, { ring: r.id, corner });
      if (r.roomId && r.matchId && (r.status === "starting" || r.status === "fighting")) this.host.send(sid, BoxingHallEvt.fightReady, this.readyMsg(r, corner));
    }
  }

  /**
   * The session left the hall. `keep` (P2-NET-06, a signed-in fighter whose connection ended without a deliberate
   * leave): a waiting / practice ring is held for them instead of freed (Held · returning, nobody may take it).
   */
  left(sid: string, keep?: KeepRing): void {
    this.unqueue(sid);
    this.unwatch(sid);
    this.rate.forget(`${sid}:`);
    this.rtt.delete(sid);
    this.pings.delete(sid);
    const id = this.holding.get(sid);
    if (!id) return;
    const r = this.rings.get(id)!;
    // a running fight keeps its ring: the fight room has its own connection + exit rules (pause, forfeit, void)
    if (r.status === "starting" || r.status === "fighting") return;
    const uid = r.red?.sid === sid ? r.red.userId : undefined;
    if (keep && uid && (r.status === "waiting" || r.status === "practice")) {
      const h = keep({ place: r.id, state: r.status, ...(r.status === "waiting" ? { stake: r.stake ?? 0 } : {}), since: r.since });
      if (h) {
        this.holding.delete(sid);
        this.heldUntil.set(r.id, h.until);
        this.heldBy.set(uid, r.id);
        this.ringChanged(r);
        return;
      }
    }
    this.release(r, sid);
  }

  /** P2-NET-06: the hold ran out (or was refused): the ring is free again */
  holdEnded(uid: string): void {
    const id = this.heldBy.get(uid);
    if (!id) return;
    this.heldBy.delete(uid);
    this.heldUntil.delete(id);
    const r = this.rings.get(id)!;
    if (r.red?.userId === uid && (r.status === "waiting" || r.status === "practice")) this.free(r);
  }

  // ---------------------------------------------------------------- latency (plan §3.4)

  /** called every pingEveryMs by the room */
  probe(sids: Iterable<string>): void {
    const n = ++this.pingN;
    const at = Date.now();
    for (const sid of sids) {
      if (!this.host.uidOf(sid)) continue; // guests never fight live
      this.pings.set(sid, { n, at });
      this.host.send(sid, BoxingHallEvt.ping, { n });
    }
  }
  onPong(sid: string, raw: { n?: unknown } | undefined): void {
    const p = this.pings.get(sid);
    if (!p || raw?.n !== p.n) return;
    this.pings.delete(sid);
    this.noteRtt(sid, Date.now() - p.at);
  }
  noteRtt(sid: string, ms: number): void {
    const xs = [...(this.rtt.get(sid) ?? []), ms].slice(-boxingHallConfig.pingSamples);
    this.rtt.set(sid, xs);
  }
  /** median of the last pings; undefined until one came back */
  pingOf(sid: string): number | undefined {
    const xs = this.rtt.get(sid);
    if (!xs?.length) return undefined;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  // ---------------------------------------------------------------- area of interest

  /** should `viewer` get `mover`'s world moves? (within BOXING_AOI_RADIUS; fighters in a running fight send none) */
  sendsMove(viewer: { x: number; z: number }, mover: { id: string; x: number; z: number }): boolean {
    const id = this.holding.get(mover.id);
    if (id) {
      const st = this.rings.get(id)!.status;
      if (st === "starting" || st === "fighting") return false;
    }
    return Math.hypot(mover.x - viewer.x, mover.z - viewer.z) <= BOXING_AOI_RADIUS * 100;
  }

  // ---------------------------------------------------------------- checks

  private deny(sid: string, action: Action, reason: BoxingDenial | string, ring?: RingId, extra: Record<string, unknown> = {}): void {
    this.host.send(sid, BoxingHallEvt.denied, { action, reason, ...(ring ? { ring } : {}), ...extra });
  }

  private allowed(sid: string, action: Action): boolean {
    if (!this.host.has(sid)) return false;
    if (this.rate.allow(`${sid}:boxing`, boxingHallConfig.actionMax, boxingHallConfig.actionWindowMs, Date.now())) return true;
    this.deny(sid, action, "RATE_LIMITED");
    return false;
  }

  /** the account is a fighter in a ring whose fight is being created or running */
  private inLiveFight(uid: string | undefined): boolean {
    if (!uid) return false;
    for (const r of this.rings.values())
      if ((r.status === "starting" || r.status === "fighting") && (r.red?.userId === uid || r.blue?.userId === uid)) return true;
    return false;
  }
  /** this person (session, or the same account in another tab) already holds a ring */
  private holdsRing(sid: string): boolean {
    if (this.holding.has(sid)) return true;
    const uid = this.host.uidOf(sid);
    if (!uid) return false;
    for (const r of this.rings.values()) if (r.status !== "free" && (r.red?.userId === uid || r.blue?.userId === uid)) return true;
    return false;
  }

  /** the checks every ring action shares (§7.1). Returns the denial, or null. */
  private ringCheck(sid: string, ring: RingId, live: boolean): BoxingDenial | "ALREADY_IN_MATCH" | null {
    const r = this.rings.get(ring);
    if (!r) return "UNKNOWN_RING";
    if (r.status === "closed") return "RING_CLOSED";
    if (this.heldUntil.has(ring)) return "RING_HELD";
    if (this.holding.get(sid) === ring && r.status === "waiting") return "OWN_RING";
    if (this.holdsRing(sid)) return "ALREADY_IN_RING";
    if (this.inLiveFight(this.host.uidOf(sid))) return "ALREADY_IN_MATCH";
    if (live && !this.host.uidOf(sid)) return "SIGN_IN_REQUIRED";
    if (boxingHallConfig.checkReach) {
      const p = this.host.posOf(sid);
      if (!p || distanceToRing(ring, p.x, p.z) > RING_REACH_M) return "TOO_FAR";
    }
    if (live) {
      const ping = this.pingOf(sid);
      if (ping !== undefined && ping > MAX_FIGHT_PING_MS) return "HIGH_LATENCY";
    }
    return null;
  }

  /** games API eligibility (personal reasons only to this player). null = may play. */
  private async eligible(sid: string, stake: number): Promise<{ reason: string; limit?: number } | null> {
    const uid = this.host.uidOf(sid);
    if (!uid) return { reason: "SIGN_IN_REQUIRED" };
    const e = await this.deps.eligibility(uid, stake);
    if (e.ok || !e.reason || e.reason === "UNKNOWN_PLAYER") return null; // unknown: the API decides at createMatch
    return { reason: e.reason, ...(e.limit !== undefined ? { limit: e.limit } : {}) };
  }

  private fighter(sid: string, corner: Corner): RingFighter & { userId: string } {
    return { sid, userId: this.host.uidOf(sid)!, name: this.host.nameOf(sid), corner, ...(this.host.levelOf(sid) !== undefined ? { level: this.host.levelOf(sid) } : {}) };
  }

  // ---------------------------------------------------------------- ring actions

  /** step into a free ring and wait for an opponent (open challenge at `stake`, 0 = friendly) */
  async onClaim(sid: string, raw: unknown): Promise<void> {
    const p = BoxingClaimSchema.safeParse(raw);
    if (!p.success) return this.deny(sid, "claim", "UNKNOWN_RING");
    if (!this.allowed(sid, "claim")) return;
    const { ring, stake } = p.data;
    const first = this.ringCheck(sid, ring, true) ?? (this.rings.get(ring)!.status !== "free" ? "RING_TAKEN" : null);
    if (first) return this.deny(sid, "claim", first, ring);
    const why = await this.eligible(sid, stake);
    if (!this.host.has(sid)) return;
    if (why) return this.deny(sid, "claim", why.reason, ring, why.limit !== undefined ? { limit: why.limit } : {});
    // somebody may have taken it (or this person another ring) while the API answered
    const again = this.ringCheck(sid, ring, true) ?? (this.rings.get(ring)!.status !== "free" ? "RING_TAKEN" : null);
    if (again) return this.deny(sid, "claim", again, ring);
    this.unqueue(sid);
    const r = this.rings.get(ring)!;
    Object.assign(r, { status: "waiting", red: this.fighter(sid, "red"), blue: undefined, stake, since: Date.now() });
    this.clearFight(r);
    this.holding.set(sid, ring);
    this.host.send(sid, BoxingHallEvt.assigned, { ring, corner: "red" });
    this.ringChanged(r);
  }

  /** take the blue corner of a waiting ring (stake = the ring's; an optional `stake` must match it) */
  async onJoin(sid: string, raw: unknown): Promise<void> {
    const p = BoxingRingMsgSchema.safeParse(raw);
    if (!p.success) return this.deny(sid, "join", "UNKNOWN_RING");
    if (!this.allowed(sid, "join")) return;
    const ring = p.data.ring;
    const expect = (raw as { stake?: unknown }).stake;
    const check = (): string | null => {
      const r = this.rings.get(ring);
      const base = this.ringCheck(sid, ring, true);
      if (base) return base;
      if (r!.status !== "waiting" || !r!.red) return "RING_TAKEN";
      if (typeof expect === "number" && expect !== r!.stake) return "STAKE_MISMATCH";
      return null;
    };
    const first = check();
    if (first) return this.deny(sid, "join", first, ring);
    const r = this.rings.get(ring)!;
    const redSid = r.red!.sid;
    const why = await this.eligible(sid, r.stake ?? 0);
    if (!this.host.has(sid)) return;
    if (why) return this.deny(sid, "join", why.reason, ring, why.limit !== undefined ? { limit: why.limit } : {});
    const again = check() ?? (r.red?.sid !== redSid ? "RING_TAKEN" : null);
    if (again) return this.deny(sid, "join", again, ring);
    this.unqueue(sid);
    this.unqueue(redSid);
    r.blue = this.fighter(sid, "blue");
    this.holding.set(sid, ring);
    this.host.send(sid, BoxingHallEvt.assigned, { ring, corner: "blue" });
    await this.startFight(r, "join");
  }

  /** quick fight: any opponent at this stake; the server picks a free ring and both walk to it */
  async onQuick(sid: string, raw: unknown): Promise<void> {
    const p = BoxingQuickSchema.safeParse(raw);
    if (!p.success) return this.deny(sid, "quick", "STAKE_NOT_ALLOWED");
    if (!this.allowed(sid, "quick")) return;
    const stake = p.data.stake;
    const pre = (): string | null => {
      if (!this.host.uidOf(sid)) return "SIGN_IN_REQUIRED";
      if (this.holdsRing(sid)) return "ALREADY_IN_RING";
      if (this.inLiveFight(this.host.uidOf(sid))) return "ALREADY_IN_MATCH";
      const ping = this.pingOf(sid);
      if (ping !== undefined && ping > MAX_FIGHT_PING_MS) return "HIGH_LATENCY";
      return null;
    };
    const first = pre();
    if (first) return this.deny(sid, "quick", first);
    const why = await this.eligible(sid, stake);
    if (!this.host.has(sid)) return;
    if (why) return this.deny(sid, "quick", why.reason, undefined, why.limit !== undefined ? { limit: why.limit } : {});
    const again = pre();
    if (again) return this.deny(sid, "quick", again);
    this.unqueue(sid);
    const me = this.host.uidOf(sid);
    // the rating, for a fair pairing (no rating yet / API down: the 1500 starting point)
    const rated = me && this.deps.rating ? await this.deps.rating(me).catch(() => null) : null;
    if (!this.host.has(sid)) return;
    const mine = rated?.rating ?? 1500;
    const q = this.queue.get(stake) ?? [];
    const now = Date.now();
    let otherIdx = -1;
    let best = Infinity;
    q.forEach((o, i) => {
      if (o === sid || !this.host.has(o) || this.host.uidOf(o) === me || this.holdsRing(o)) return;
      const info = this.qInfo.get(o) ?? { rating: 1500, at: now };
      const gap = Math.abs(info.rating - mine);
      if (gap > Math.max(matchWindow(0), matchWindow(now - info.at)) || gap >= best) return;
      best = gap;
      otherIdx = i;
    });
    // P2-MM-05: nobody in the queue fits, but someone already stands in a ring waiting at this stake (an open
    // challenge from "Wait for an opponent"): take them on (before, the two waited side by side for ever)
    if (otherIdx < 0) {
      const waiting = this.waitingRingFor(sid, stake);
      if (waiting) return this.joinWaiting(sid, waiting);
    }
    const free = this.freeRing();
    if (otherIdx < 0 || !free) {
      q.push(sid);
      this.queue.set(stake, q);
      this.qInfo.set(sid, { rating: mine, at: now });
      // the window widens while they wait: look again at every step
      this.host.later(() => this.rematch(stake), FIGHT_MATCH_WINDOW.stepSeconds * 1000 + 50);
      return this.host.send(sid, BoxingHallEvt.quick, { status: "waiting", stake });
    }
    const [other] = q.splice(otherIdx, 1);
    this.queue.set(stake, q);
    this.qInfo.delete(other!);
    await this.pairQuick(other!, sid, stake, free);
  }

  /** waiting players whose windows now overlap are paired (closest ratings first) */
  private async rematch(stake: number): Promise<void> {
    const q = (this.queue.get(stake) ?? []).filter((s) => this.host.has(s) && !this.holdsRing(s));
    const now = Date.now();
    let pair: [number, number] | null = null;
    let best = Infinity;
    for (let i = 0; i < q.length; i++)
      for (let j = i + 1; j < q.length; j++) {
        const a = this.qInfo.get(q[i]!);
        const b = this.qInfo.get(q[j]!);
        if (!a || !b || this.host.uidOf(q[i]!) === this.host.uidOf(q[j]!)) continue;
        const gap = Math.abs(a.rating - b.rating);
        if (gap <= Math.max(matchWindow(now - a.at), matchWindow(now - b.at)) && gap < best) {
          best = gap;
          pair = [i, j];
        }
      }
    const free = this.freeRing();
    if (!pair || !free) {
      if (q.length >= 2) this.host.later(() => this.rematch(stake), FIGHT_MATCH_WINDOW.stepSeconds * 1000);
      return;
    }
    const red = q[pair[0]]!;
    const blue = q[pair[1]]!;
    this.unqueue(red);
    this.unqueue(blue);
    await this.pairQuick(red, blue, stake, free);
    void this.rematch(stake);
  }

  private async pairQuick(other: string, sid: string, stake: number, free: RingState): Promise<void> {
    this.host.send(other, BoxingHallEvt.quick, { status: "idle" });
    this.host.send(sid, BoxingHallEvt.quick, { status: "idle" });
    Object.assign(free, { red: this.fighter(other, "red"), blue: this.fighter(sid, "blue"), stake });
    this.clearFight(free);
    this.holding.set(other, free.id);
    this.holding.set(sid, free.id);
    this.host.send(other, BoxingHallEvt.assigned, { ring: free.id, corner: "red" });
    this.host.send(sid, BoxingHallEvt.assigned, { ring: free.id, corner: "blue" });
    await this.startFight(free, "quick");
  }

  /** the longest-waiting ring at this stake whose fighter is someone else (still here, not held) */
  private waitingRingFor(sid: string, stake: number): RingState | undefined {
    const me = this.host.uidOf(sid);
    let best: RingState | undefined;
    for (const r of this.rings.values()) {
      if (r.status !== "waiting" || !r.red || r.blue || (r.stake ?? 0) !== stake || this.heldUntil.has(r.id)) continue;
      if (r.red.sid === sid || (me && r.red.userId === me) || !this.host.has(r.red.sid)) continue;
      if (!best || r.since < best.since) best = r;
    }
    return best;
  }

  /** quick fight into a waiting ring: the blue corner, then the fight (the server walks both there) */
  private async joinWaiting(sid: string, r: RingState): Promise<void> {
    this.unqueue(sid);
    this.unqueue(r.red!.sid);
    r.blue = this.fighter(sid, "blue");
    this.holding.set(sid, r.id);
    this.host.send(sid, BoxingHallEvt.quick, { status: "idle" });
    this.host.send(sid, BoxingHallEvt.assigned, { ring: r.id, corner: "blue" });
    await this.startFight(r, "join");
  }

  /** P2-MM-05: ring → status for the Quick Play picker (free / waiting / playing / held) */
  statuses(): Record<string, "free" | "waiting" | "playing" | "held"> {
    const out: Record<string, "free" | "waiting" | "playing" | "held"> = {};
    for (const r of this.rings.values()) {
      if (r.status === "free") continue;
      out[r.id] = this.heldUntil.has(r.id) ? "held" : r.status === "waiting" ? "waiting" : "playing";
    }
    return out;
  }
  /** the client asks for the registry again (its Boxing client started after the hall join): rings + my ring */
  onSync(sid: string): void {
    if (!this.host.has(sid) || !this.rate.allow(`${sid}:sync`, 4, 10_000, Date.now())) return;
    this.host.send(sid, BoxingHallEvt.rings, this.list());
    const id = this.holding.get(sid);
    const r = id && this.rings.get(id);
    if (!r) return;
    const corner: Corner = r.blue?.sid === sid ? "blue" : "red";
    this.host.send(sid, BoxingHallEvt.assigned, { ring: r.id, corner });
    if (r.roomId && r.matchId && (r.status === "starting" || r.status === "fighting")) this.host.send(sid, BoxingHallEvt.fightReady, this.readyMsg(r, corner));
  }

  onQuickCancel(sid: string): void {
    this.unqueue(sid);
    this.host.send(sid, BoxingHallEvt.quick, { status: "idle" });
  }

  /**
   * A challenge accepted in the People / proposal flow with game boxing (world-room.ts): both get a free ring and a
   * fight room. Throws the refusal (like startMatch) so the proposal flow can tell each player.
   */
  async assignProposal(fromSid: string, toSid: string, stake: number): Promise<{ ring: RingId; roomId: string; matchId: string }> {
    for (const s of [fromSid, toSid]) if (this.holdsRing(s) || this.inLiveFight(this.host.uidOf(s))) throw Object.assign(new Error("ALREADY_IN_MATCH"), { userId: this.host.uidOf(s) });
    const free = this.freeRing();
    if (!free) throw new Error("RING_TAKEN");
    this.unqueue(fromSid);
    this.unqueue(toSid);
    Object.assign(free, { red: this.fighter(fromSid, "red"), blue: this.fighter(toSid, "blue"), stake });
    this.clearFight(free);
    this.holding.set(fromSid, free.id);
    this.holding.set(toSid, free.id);
    this.host.send(fromSid, BoxingHallEvt.assigned, { ring: free.id, corner: "red" });
    this.host.send(toSid, BoxingHallEvt.assigned, { ring: free.id, corner: "blue" });
    const started = await this.startFight(free, "proposal");
    if ("error" in started) throw started.error;
    return { ring: free.id, ...started };
  }

  /** train against the AI in a free ring (guests too; no stake, never counted) */
  onPractice(sid: string, raw: unknown): void {
    const p = BoxingRingMsgSchema.safeParse(raw);
    if (!p.success) return this.deny(sid, "practice", "UNKNOWN_RING");
    if (!this.allowed(sid, "practice")) return;
    const ring = p.data.ring;
    // back on my practice ring after a reload (P2-NET-06): a fresh practice fight in the same ring
    if (this.holding.get(sid) === ring && this.rings.get(ring)?.status === "practice") return this.host.send(sid, BoxingHallEvt.assigned, { ring, corner: "red" });
    const why = this.ringCheck(sid, ring, false) ?? (this.rings.get(ring)!.status !== "free" ? "RING_TAKEN" : null);
    if (why) return this.deny(sid, "practice", why, ring);
    this.unqueue(sid);
    const r = this.rings.get(ring)!;
    const uid = this.host.uidOf(sid);
    Object.assign(r, { status: "practice", red: { sid, ...(uid ? { userId: uid } : {}), name: this.host.nameOf(sid), corner: "red" }, blue: undefined, stake: 0, since: Date.now() });
    this.clearFight(r);
    this.holding.set(sid, ring);
    this.host.send(sid, BoxingHallEvt.assigned, { ring, corner: "red" });
    this.ringChanged(r);
  }

  /** the practising player's local score, for the status board and spectators */
  onPracticeScore(sid: string, raw: { round?: unknown; score?: unknown } | undefined): void {
    const id = this.holding.get(sid);
    const r = id && this.rings.get(id);
    if (!r || r.status !== "practice") return this.deny(sid, "leave", "NOT_IN_RING");
    if (!this.rate.allow(`${sid}:pscore`, 4, 1_000, Date.now())) return;
    const round = Number(raw?.round);
    const s = raw?.score as unknown;
    const sc = Array.isArray(s) ? s : s && typeof s === "object" ? [(s as Record<string, unknown>).red, (s as Record<string, unknown>).blue] : [];
    const ok = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 10_000;
    if (!Number.isSafeInteger(round) || round < 0 || round > 10 || !ok(sc[0]) || !ok(sc[1])) return;
    r.round = round;
    r.score = { red: sc[0] as number, blue: sc[1] as number };
    this.ringChanged(r);
  }

  /** step out of the ring: waiting / practice / result free at once; a running fight goes through its exit rules */
  onLeave(sid: string): void {
    if (!this.allowed(sid, "leave")) return;
    this.unqueue(sid);
    const id = this.holding.get(sid);
    if (!id) return this.deny(sid, "leave", "NOT_IN_RING");
    const r = this.rings.get(id)!;
    const uid = this.host.uidOf(sid);
    if (r.status === "starting" || r.status === "fighting") {
      if (!uid) return;
      if (r.roomId) this.deps.leaveFight(r.roomId, uid);
      else this.leaveAfterStart.set(r.id, uid);
      return;
    }
    this.release(r, sid);
  }

  /** watch a ring's spectator frames (one ring at a time; null stops) */
  onWatch(sid: string, raw: unknown): void {
    const p = BoxingWatchSchema.safeParse(raw);
    if (!p.success) return this.deny(sid, "watch", "UNKNOWN_RING");
    if (!this.allowed(sid, "watch")) return;
    const ring = p.data.ring;
    if (ring === null) return this.unwatch(sid);
    if (this.watching.get(sid) === ring) return;
    const set = this.watchers.get(ring) ?? new Set<string>();
    if (set.size >= watchersMax(ring)) return this.deny(sid, "watch", "HALL_FULL", ring);
    this.unwatch(sid);
    set.add(sid);
    this.watchers.set(ring, set);
    this.watching.set(sid, ring);
    const r = this.rings.get(ring)!;
    r.watchers = set.size;
    this.ringChanged(r);
  }

  // ---------------------------------------------------------------- fight lifecycle

  /** both corners are filled: escrow through the API, then the fight room; refusals go back to each player */
  private async startFight(r: RingState, action: Action): Promise<{ roomId: string; matchId: string } | { error: unknown }> {
    const red = r.red as RingFighter & { userId: string };
    const blue = r.blue as RingFighter & { userId: string };
    Object.assign(r, { status: "starting", since: Date.now() });
    this.ringChanged(r);
    try {
      const f = await this.deps.start({ hallId: this.host.roomId, ring: r.id, stake: r.stake ?? 0, red, blue });
      if (r.red?.userId !== red.userId || r.blue?.userId !== blue.userId) return { roomId: f.roomId, matchId: f.matchId }; // ring was reset meanwhile
      r.roomId = f.roomId;
      r.matchId = f.matchId;
      r.rounds = f.rules.fight?.rounds;
      this.ringChanged(r);
      for (const c of ["red", "blue"] as const) this.host.send(r[c]!.sid, BoxingHallEvt.fightReady, this.readyMsg(r, c, f.rules));
      const leaver = this.leaveAfterStart.get(r.id);
      if (leaver) {
        this.leaveAfterStart.delete(r.id);
        this.deps.leaveFight(f.roomId, leaver);
      }
      return { roomId: f.roomId, matchId: f.matchId };
    } catch (e) {
      this.leaveAfterStart.delete(r.id);
      const code = errCode(e);
      const about = errUser(e);
      for (const f of [red, blue]) {
        const reason = !PERSONAL.has(code) ? code : about === f.userId ? code : OPPONENT_CANT_PLAY;
        const limit = reason === "FRIENDLY_LIMIT_REACHED" ? errLimit(e) : undefined;
        if (action !== "proposal") this.deny(f.sid, action, reason, r.id, limit !== undefined ? { limit } : {});
      }
      // the challenger keeps waiting in their ring unless the refusal was about them (or both came from a queue / proposal)
      const keepRed = action === "join" && !(PERSONAL.has(code) && about === red.userId) && this.host.has(red.sid);
      this.holding.delete(blue.sid);
      this.host.send(blue.sid, BoxingHallEvt.assigned, { ring: null });
      if (keepRed) {
        Object.assign(r, { status: "waiting", blue: undefined, since: Date.now() });
        this.ringChanged(r);
      } else {
        this.holding.delete(red.sid);
        this.host.send(red.sid, BoxingHallEvt.assigned, { ring: null });
        this.free(r);
      }
      return { error: e };
    }
  }

  private readyMsg(r: RingState, corner: Corner, rules?: MatchRules) {
    return { ring: r.id, roomId: r.roomId, matchId: r.matchId, corner, stake: r.stake ?? 0, ...(rules?.fight ? { rules: rules.fight as FightRules } : r.rounds ? {} : {}) };
  }

  /** fight room → hall: phase changes and the live score (status board, far rings) */
  fightStatus(ring: RingId, matchId: string, patch: { status?: "starting" | "fighting"; round?: number; rounds?: number; score?: Record<Corner, number> }): void {
    const r = this.rings.get(ring);
    if (!r || r.matchId !== matchId) return;
    const changed =
      (patch.status && patch.status !== r.status) ||
      (patch.round !== undefined && patch.round !== r.round) ||
      (patch.score && (patch.score.red !== r.score?.red || patch.score.blue !== r.score?.blue));
    if (!changed) return;
    if (patch.status && patch.status !== r.status) {
      r.status = patch.status;
      r.since = Date.now();
    }
    if (patch.round !== undefined) r.round = patch.round;
    if (patch.rounds !== undefined) r.rounds = patch.rounds;
    if (patch.score) r.score = patch.score;
    this.ringChanged(r);
  }

  /** fight room → watchers of this ring (SPECTATOR_FRAME_HZ) */
  fightFrame(ring: RingId, matchId: string, snap: BoxingSnapshot, events: FightEvent[]): void {
    const r = this.rings.get(ring);
    if (!r || r.matchId !== matchId) return;
    const set = this.watchers.get(ring);
    if (!set?.size) return;
    for (const sid of set) {
      this.host.send(sid, BoxingHallEvt.frame, snap);
      if (events.length) this.host.send(sid, BoxingHallEvt.events, events);
    }
  }

  /** the fight ended (any exit path): the ring shows the result, then frees */
  fightOver(ring: RingId, matchId: string, summary: { score: Record<Corner, number>; round: number }): void {
    const r = this.rings.get(ring);
    if (!r || r.matchId !== matchId) return;
    Object.assign(r, { status: "result", score: summary.score, round: summary.round, since: Date.now() });
    this.ringChanged(r);
    this.host.later(() => {
      if (r.matchId === matchId && r.status === "result") {
        for (const c of ["red", "blue"] as const) {
          const f = r[c];
          if (f && this.holding.get(f.sid) === r.id) {
            this.holding.delete(f.sid);
            this.host.send(f.sid, BoxingHallEvt.assigned, { ring: null });
          }
        }
        this.free(r);
      }
    }, boxingHallConfig.resultMs);
  }

  // ---------------------------------------------------------------- registry helpers

  /** the first free ring for a quick fight / proposal (standard rings first, the feature rings last) */
  private freeRing(): RingState | undefined {
    const order = [...RING_IDS.filter((id) => !(FEATURE_RINGS as readonly string[]).includes(id)), ...FEATURE_RINGS];
    for (const id of order) {
      const r = this.rings.get(id)!;
      if (r.status === "free") return r;
    }
    return undefined;
  }

  private release(r: RingState, sid: string): void {
    this.holding.delete(sid);
    this.host.send(sid, BoxingHallEvt.assigned, { ring: null });
    if (r.status === "result") {
      // one fighter stepped out; the ring frees when the result is over (or the other one leaves too)
      const other = r.red?.sid === sid ? r.blue : r.red;
      if (other && this.holding.get(other.sid) === r.id) return;
    }
    this.free(r);
  }

  private free(r: RingState): void {
    for (const c of ["red", "blue"] as const) {
      const f = r[c];
      if (f && this.holding.get(f.sid) === r.id) this.holding.delete(f.sid);
      if (f?.userId && this.heldBy.get(f.userId) === r.id) this.heldBy.delete(f.userId);
    }
    this.heldUntil.delete(r.id);
    const watchers = r.watchers;
    for (const k of Object.keys(r) as (keyof RingState)[]) if (k !== "id") delete r[k];
    Object.assign(r, { status: "free", watchers, since: Date.now() });
    this.ringChanged(r);
  }

  private clearFight(r: RingState): void {
    delete r.roomId;
    delete r.matchId;
    delete r.round;
    delete r.rounds;
    delete r.score;
  }

  private unqueue(sid: string): void {
    for (const [k, q] of this.queue) if (q.includes(sid)) this.queue.set(k, q.filter((x) => x !== sid));
    this.qInfo.delete(sid);
  }

  private unwatch(sid: string): void {
    const id = this.watching.get(sid);
    if (!id) return;
    this.watching.delete(sid);
    const set = this.watchers.get(id);
    set?.delete(sid);
    const r = this.rings.get(id)!;
    r.watchers = set?.size ?? 0;
    this.ringChanged(r);
  }

  private ringChanged(r: RingState): void {
    this.host.broadcast(BoxingHallEvt.ring, this.wire(r));
  }
  /** a ring as clients get it (a held ring carries the time left of its hold) */
  private wire(r: RingState, now = Date.now()): RingState {
    const until = this.heldUntil.get(r.id);
    return { ...r, ...(r.red ? { red: { ...r.red } } : {}), ...(r.blue ? { blue: { ...r.blue } } : {}), ...(until !== undefined ? { held: { ms: Math.max(0, until - now) } } : {}) };
  }
  private list(): RingState[] {
    const now = Date.now();
    return [...this.rings.values()].map((r) => this.wire(r, now));
  }

  /** test / console view */
  ring(id: RingId): RingState | undefined {
    return this.rings.get(id);
  }
  queued(stake: number): number {
    return this.queue.get(stake)?.length ?? 0;
  }
}
