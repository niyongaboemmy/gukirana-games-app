import { createHash } from "node:crypto";
import { Room, matchMaker, type Client } from "@colyseus/core";
import {
  COUNTDOWN_TICKS,
  auditFight,
  logStep,
  logText,
  newFightLog,
  beginFight,
  createFight,
  fightStatsOf,
  forfeitFight,
  hasBegun,
  hashFight,
  matchResultOf,
  maxFightTicks,
  pauseFight,
  resumeFight,
  snapshotOf,
  stepFight,
  voidFight,
  type FightLog,
  type FightState,
} from "@gukirana/boxing";
import {
  BOXING_GAME_ID,
  DEFAULT_FIGHT_RULES,
  FIGHTER_SNAPSHOT_HZ,
  FightEvt,
  FightInputSchema,
  FightMsg,
  MAX_INPUTS_PER_SECOND,
  SPECTATOR_FRAME_HZ,
  TICK_HZ,
  type BoxingAction,
  type FightEvent,
  type FightInput,
  type FightInputRejection,
  type ForfeitCause,
  type MatchRules,
  type RingId,
  type VoidCause,
} from "@gukirana/contracts";
import { keyFromSeed, signResult } from "@gukirana/signing";
import { loadEnv } from "@gukirana/config";
import { createLogger } from "@gukirana/observability";
import { verifyToken } from "../auth.js";
import { api, ApiError } from "../api-client.js";
import { eligibilityOf, trackAccount } from "../social/accounts.js";
import { DEFAULT_RULES, liveSeats, matchConfig, reconnectBudgetOf, reportRoom, trackLiveMatch, untrackLiveMatch } from "./match-room.js";
import { boxingHallOf, type StartFightInput, type StartedFight } from "./boxing-hall.js";

const log = createLogger("boxing-room");
const { privateKey } = keyFromSeed(loadEnv().RESULT_SIGNING_SEED);
const TICK_MS = 1000 / TICK_HZ;
const SNAP_EVERY = Math.round(TICK_HZ / FIGHTER_SNAPSHOT_HZ);
const FRAME_EVERY = Math.round(TICK_HZ / SPECTATOR_FRAME_HZ);
const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

/**
 * The signed `stateHash` of a boxing result (P3-FGT-06): it commits to the final engine state (judges' cards,
 * deductions, decision) AND to the fight log (every input the engine was given), so the settled match can be
 * re-derived and checked by replaying the log (docs/BOXING-SCORING.md §6).
 */
export const boxingResultHash = (fight: FightState, log: FightLog): string =>
  // "v2" = the P3-FGT-06 hash of a v1-engine fight; "v3" = the same commitment for an engine-v2 fight (P3-FGT-10)
  sha256(`boxing:${log.engine === 2 ? "v3" : "v2"}:${sha256(hashFight(fight))}:${sha256(logText(log))}`);

/** knobs tests shorten */
export const boxingConfig = {
  /** gloving-up: the bell countdown starts when both sent `ready`, or this long after both joined */
  introMs: 1_500,
  /** a connected fighter that sends nothing (no input, no ping) this long during the fight is treated as gone (plan §3.4) */
  staleMs: 3_000,
  /** ticks stepped at most per timer callback when the process lagged (drift correction) */
  maxCatchUp: 5,
};

export interface BoxingPlayerInfo {
  userId: string;
  seat: number;
  name: string;
  color: string;
  rating: number;
}
export interface BoxingOptions {
  matchId: string;
  stake: number;
  /** seat 0 = red corner, 1 = blue */
  players: BoxingPlayerInfo[];
  rules?: Partial<MatchRules>;
  ring: RingId;
  /** the Boxing hall room that holds the ring (status, spectator frames) */
  hallId?: string;
}

/** fight rooms of this process by room id (the hall forwards a fighter's Leave) */
const rooms = new Map<string, BoxingRoom>();
export const boxingRoomOf = (roomId: string): BoxingRoom | undefined => rooms.get(roomId);

/** the hall's deps.start: API createMatch (escrow before the bell) + the authoritative fight room */
export async function startBoxing(input: StartFightInput): Promise<StartedFight> {
  const created = await api.createMatch({
    game: BOXING_GAME_ID,
    variant: "standard",
    stake: input.stake,
    players: [
      { userId: input.red.userId, seat: 0 },
      { userId: input.blue.userId, seat: 1 },
    ],
  });
  const rules: MatchRules = created.rules ?? { ...DEFAULT_RULES, maxMatchMinutes: 15, fight: DEFAULT_FIGHT_RULES };
  try {
    const room = await matchMaker.createRoom("boxing", {
      matchId: created.matchId,
      stake: input.stake,
      players: created.players,
      rules,
      ring: input.ring,
      hallId: input.hallId,
    } satisfies BoxingOptions);
    reportRoom(created.matchId, room.roomId, input.ring); // P2-NET-05 resume (the hall also re-sends fight-ready)
    return { roomId: room.roomId, matchId: created.matchId, rules };
  } catch (e) {
    // no room to run it: refund at once (never a stuck escrow)
    await api.voidMatch(created.matchId, "SERVER_ERROR").catch(() => undefined);
    throw e;
  }
}

type Reason = "normal" | "forfeit" | "void";
type Seat = 0 | 1;

interface Pending {
  a?: BoxingAction;
  g?: boolean;
  /** engine v2: the held footwork direction (latest this tick) and the body flag of the press */
  mv?: [number, number];
  b?: boolean;
}

/**
 * The authoritative Boxing fight (P3-FGT-01, docs/FIGHT-GAMES-PLAN.md §3, docs/GAME-EXIT-RULES.md "Boxing"). The room
 * owns the FightState and steps the pure engine at TICK_HZ; clients only send presses (`in`). No randomness, no bots.
 * Escrow happened in the API before this room exists (startBoxing); the result is Ed25519-signed and settled exactly
 * like match-room.ts (retries → void, heartbeat, sweep).
 *
 * Exit paths: Leave before the first move (bell + an input) → void, after → forfeit; a disconnect is a referee
 * time-out (clock stops for both) drawn from that fighter's `reconnectSeconds` budget → back: 3 s countdown; budget
 * used → forfeit (void before the first move; void when nobody is left); IDLE strikes `maxTimeouts` in a row →
 * forfeit; nobody acting within idleSeconds after the bell → void NO_FIRST_MOVE; no-show `joinSeconds`, longer than
 * `maxMatchMinutes` or the engine's tick bound → void; suspension → void; room closed early → void.
 */
export class BoxingRoom extends Room {
  override maxClients = 6; // two fighters, each with a spare tab / reload
  private opts!: BoxingOptions;
  private rules: MatchRules = DEFAULT_RULES;
  private fight!: FightState;
  /** every engine call, for the pre-sign replay audit (P3-FGT-06) */
  private log!: FightLog;
  private ids!: [string, string];
  private sessions = new Map<string, string>(); // sessionId → userId
  private seqs = new Map<string, number>(); // sessionId → last seq
  private bucket = new Map<string, { tokens: number; at: number; warned: number }>();
  private pending: [Pending, Pending] = [{}, {}];
  private engineSeq: [number, number] = [0, 0];
  private ready = new Set<string>();
  private started = false;
  private finished = false;
  private t0 = 0;
  private stepped = 0;
  /** ticks stepped outside a pause + the countdowns added by resumes (watchdog) */
  private budgetTicks = 0;
  private lastSeen = new Map<string, number>();
  /** pause budget left per fighter (ms) and when their current absence began */
  private budget: [number, number] = [0, 0];
  private away: [number | null, number | null] = [null, null];
  /** a fighter treated as gone without closing the socket (stale): any message brings them back */
  private stale: [boolean, boolean] = [false, false];
  private awayTimer: [{ clear(): void } | null, { clear(): void } | null] = [null, null];
  /** P2-NET-05: time-outs per fighter (one more than maxDisconnects forfeits at once) and the current one's length */
  private drops: [number, number] = [0, 0];
  private windowMs: [number, number] = [0, 0];
  private joinTimer: { clear(): void } | null = null;
  private maxTimer: { clear(): void } | null = null;
  private introTimer: { clear(): void } | null = null;
  private tracked = new Map<string, () => void>();
  private lastStatus = "";

  override onCreate(options: BoxingOptions): void {
    this.opts = options;
    this.rules = { ...DEFAULT_RULES, ...(options.rules ?? {}) };
    const fr = this.rules.fight ?? DEFAULT_FIGHT_RULES;
    const bySeat = [...options.players].sort((a, b) => a.seat - b.seat);
    this.ids = [bySeat[0]!.userId, bySeat[1]!.userId];
    // staked fights must name a winner on the cards (countback, drawTiebreak "staked"); friendlies may be drawn
    const staked = options.stake > 0;
    this.fight = createFight(this.ids, fr, { staked });
    this.log = newFightLog([...this.ids], fr, staked);
    const total = reconnectBudgetOf(this.rules, true).totalMs;
    this.budget = [total, total];
    this.autoDispose = true;
    this.setPrivate(true);
    rooms.set(this.roomId, this);
    trackLiveMatch(options.matchId, this);
    for (const p of options.players) liveSeats.set(p.userId, { roomId: this.roomId, matchId: options.matchId, game: BOXING_GAME_ID });
    this.joinTimer = this.clock.setTimeout(() => void this.finish("void", "NO_SHOW"), this.rules.joinSeconds * 1000);
    this.maxTimer = this.clock.setTimeout(() => void this.finish("void", "MATCH_TOO_LONG"), this.rules.maxMatchMinutes * 60_000);

    this.onMessage(FightMsg.input, (client, raw: unknown) => this.onInput(client, raw));
    this.onMessage(FightMsg.ready, (client) => {
      const uid = this.seen(client);
      if (!uid || this.finished) return;
      this.ready.add(uid);
      if (this.ids.every((id) => this.ready.has(id))) this.begin();
    });
    this.onMessage(FightMsg.ping, (client, raw: { t?: unknown } | undefined) => {
      this.seen(client);
      client.send(FightEvt.pong, { t: typeof raw?.t === "number" ? raw.t : 0, now: Date.now() });
    });
    this.onMessage(FightMsg.sync, (client) => {
      const uid = this.seen(client);
      if (!uid) return;
      client.send("init", this.initFor(uid));
      client.send(FightEvt.snap, snapshotOf(this.fight, this.opts.ring));
    });
    this.onMessage(FightMsg.resign, (client) => {
      const uid = this.sessions.get(client.sessionId);
      if (uid && !this.finished) void this.leaveVoluntarily(uid);
    });
    this.setSimulationInterval(() => this.onTimer(), TICK_MS);
  }

  override async onAuth(_client: Client, options: { token?: unknown }): Promise<{ userId: string }> {
    const claims = await verifyToken(options?.token);
    if (!claims || !this.ids.includes(claims.sub)) throw new Error("NOT_A_PLAYER");
    if ((await eligibilityOf(claims.sub, 0)).reason === "ACCOUNT_INACTIVE") throw new Error("ACCOUNT_INACTIVE");
    return { userId: claims.sub };
  }

  private seatOf(userId: string): Seat {
    return this.ids[0] === userId ? 0 : 1;
  }
  private connected(userId: string): boolean {
    return [...this.sessions.values()].includes(userId);
  }
  /** note a message from a fighter (staleness); returns its user id */
  private seen(client: Client): string | undefined {
    const uid = this.sessions.get(client.sessionId);
    if (!uid) return undefined;
    this.lastSeen.set(uid, Date.now());
    const seat = this.seatOf(uid);
    if (this.stale[seat]) {
      this.stale[seat] = false;
      this.back(seat);
    }
    return uid;
  }

  private initFor(userId: string) {
    const seat = this.seatOf(userId);
    return {
      you: userId,
      seat,
      corner: seat === 0 ? "red" : "blue",
      ring: this.opts.ring,
      matchId: this.opts.matchId,
      stake: this.opts.stake,
      players: this.opts.players,
      rules: this.rules,
      fight: this.fight.rules,
      begun: hasBegun(this.fight),
    };
  }

  override onJoin(client: Client, _options: unknown, auth: { userId: string }): void {
    const uid = auth.userId;
    const wasConnected = this.connected(uid);
    this.sessions.set(client.sessionId, uid);
    this.lastSeen.set(uid, Date.now());
    this.tracked.set(client.sessionId, trackAccount(uid, () => this.suspended(uid)));
    client.send("init", this.initFor(uid));
    client.send(FightEvt.snap, snapshotOf(this.fight, this.opts.ring));
    if (this.finished) return;
    if (!this.started && this.ids.every((id) => this.connected(id))) {
      this.started = true;
      this.joinTimer?.clear();
      this.status();
      // gloving up: the countdown starts when both are ready, or shortly anyway
      this.introTimer = this.clock.setTimeout(() => this.begin(), boxingConfig.introMs);
      return;
    }
    if (!wasConnected) this.back(this.seatOf(uid));
  }

  override async onLeave(client: Client, consented: boolean): Promise<void> {
    const uid = this.sessions.get(client.sessionId);
    this.sessions.delete(client.sessionId);
    this.seqs.delete(client.sessionId);
    this.bucket.delete(client.sessionId);
    this.tracked.get(client.sessionId)?.();
    this.tracked.delete(client.sessionId);
    if (!uid || this.finished || this.connected(uid)) return;
    if (consented) return void this.leaveVoluntarily(uid);
    if (!this.started) return; // the join timer voids a no-show
    this.gone(this.seatOf(uid));
    try {
      const seat = this.seatOf(uid);
      const re = await this.allowReconnection(client, Math.max(0.05, this.windowMs[seat] / 1000));
      this.sessions.set(re.sessionId, uid);
      this.lastSeen.set(uid, Date.now());
      re.send("init", this.initFor(uid));
      this.back(seat);
    } catch {
      // came back by a fresh join (reload) → back() ran from onJoin; otherwise the budget timer decides
    }
  }

  /** the hall's Leave button while this fight runs (same as `resign`) */
  leaveFrom(userId: string): void {
    if (this.ids.includes(userId) && !this.finished) void this.leaveVoluntarily(userId);
  }

  // ---------------------------------------------------------------- pauses (referee time-out)

  /** a fighter is gone: clock stops for both; their own pause budget runs */
  private gone(seat: Seat): void {
    if (this.finished || this.away[seat] !== null) return;
    this.away[seat] = Date.now();
    // P2-NET-05: each time-out lasts at most reconnectSeconds, drawn from the fighter's total budget; past maxDisconnects
    // time-outs the next one forfeits at once
    this.drops[seat]++;
    const maxDrops = reconnectBudgetOf(this.rules, true).maxDrops;
    const windowMs = this.drops[seat] > maxDrops ? 0 : Math.min(this.rules.reconnectSeconds * 1000, this.budget[seat]);
    this.windowMs[seat] = windowMs;
    log.info({ event: "fight.disconnect", matchId: this.opts.matchId, userId: this.ids[seat], drop: this.drops[seat], windowMs }, "fighter gone: referee time-out");
    this.fight = pauseFight(this.fight, "DISCONNECT", seat);
    this.log.ops.push({ o: "pause", reason: "DISCONNECT", who: seat });
    this.flushEvents();
    for (const c of this.clients) c.send(FightEvt.snap, snapshotOf(this.fight, this.opts.ring));
    this.frame();
    this.broadcast(FightEvt.pause, { who: seat, connected: false, budgetMs: this.budget[seat], ms: windowMs, drop: this.drops[seat], maxDrops });
    // the other fighter gone too → nobody to win: void now (exit rules row 8)
    if (this.away[(1 - seat) as Seat] !== null) return void this.forfeitOrVoid(seat, "DISCONNECT");
    if (windowMs <= 0) return void this.forfeitOrVoid(seat, "DISCONNECT");
    this.awayTimer[seat] = this.clock.setTimeout(() => void this.forfeitOrVoid(seat, "DISCONNECT"), windowMs);
  }

  /** a fighter is back: their budget is charged; when nobody is away the fight resumes after a 3 s countdown */
  private back(seat: Seat): void {
    const since = this.away[seat];
    if (since === null || this.finished) return;
    this.budget[seat] = Math.max(0, this.budget[seat] - (Date.now() - since));
    this.away[seat] = null;
    this.awayTimer[seat]?.clear();
    this.awayTimer[seat] = null;
    log.info({ event: "fight.reconnect", matchId: this.opts.matchId, userId: this.ids[seat], awayMs: Date.now() - since }, "fighter back");
    this.broadcast(FightEvt.pause, { who: seat, connected: true, budgetMs: this.budget[seat] });
    if (this.away.every((a) => a === null) && this.fight.phase === "paused") {
      this.fight = resumeFight(this.fight);
      this.log.ops.push({ o: "resume", countdown: true });
      this.budgetTicks -= COUNTDOWN_TICKS;
      for (const id of this.ids) this.lastSeen.set(id, Date.now());
      this.flushEvents();
      for (const c of this.clients) c.send(FightEvt.snap, snapshotOf(this.fight, this.opts.ring));
      // a time-out during gloving up: back to the intro → the opening countdown starts now
      if (this.fight.phase === "intro") this.begin();
    }
  }

  // ---------------------------------------------------------------- inputs (plan §3.2)

  private reject(client: Client, reason: FightInputRejection): void {
    client.send(FightEvt.rejected, { reason });
  }

  private onInput(client: Client, raw: unknown): void {
    const uid = this.seen(client);
    if (!uid || this.finished) return;
    // token bucket: MAX_INPUTS_PER_SECOND, extra messages dropped (RATE_LIMITED at most once a second)
    const now = Date.now();
    const b = this.bucket.get(client.sessionId) ?? { tokens: MAX_INPUTS_PER_SECOND, at: now, warned: 0 };
    b.tokens = Math.min(MAX_INPUTS_PER_SECOND, b.tokens + ((now - b.at) * MAX_INPUTS_PER_SECOND) / 1000);
    b.at = now;
    this.bucket.set(client.sessionId, b);
    if (b.tokens < 1) {
      if (now - b.warned >= 1000) {
        b.warned = now;
        this.reject(client, "RATE_LIMITED");
      }
      return;
    }
    b.tokens -= 1;
    const p = FightInputSchema.safeParse(raw);
    if (!p.success) return this.reject(client, "BAD_INPUT");
    const last = this.seqs.get(client.sessionId) ?? -1;
    if (p.data.seq <= last) return this.reject(client, "STALE_SEQ");
    this.seqs.set(client.sessionId, p.data.seq);
    const slot = this.pending[this.seatOf(uid)];
    slot.g = p.data.g;
    if (p.data.mv) slot.mv = p.data.mv;
    if (!p.data.a) return;
    if (this.fight.phase !== "round") return this.reject(client, "NOT_FIGHTING");
    // at most one press per tick per fighter: a second press in the same tick is dropped
    if (slot.a) return;
    slot.a = p.data.a;
    if (p.data.b) slot.b = true;
  }

  // ---------------------------------------------------------------- the tick loop

  private begin(): void {
    this.introTimer?.clear();
    this.introTimer = null;
    if (this.finished || this.fight.phase !== "intro") return;
    this.fight = beginFight(this.fight);
    this.log.ops.push({ o: "begin" });
    this.t0 = Date.now();
    this.stepped = 0;
    for (const id of this.ids) this.lastSeen.set(id, Date.now());
    for (const c of this.clients) c.send(FightEvt.snap, snapshotOf(this.fight, this.opts.ring));
  }

  private onTimer(): void {
    if (this.finished || !this.t0) return;
    // drift correction: step by elapsed time, not by timer callbacks
    const due = Math.floor((Date.now() - this.t0) / TICK_MS);
    let n = 0;
    while (this.stepped < due && n < boxingConfig.maxCatchUp && !this.finished) {
      this.tick();
      n++;
    }
    if (this.stepped < due) this.stepped = due; // too far behind: skip (never fast-forward the fight)
    this.checkStale();
  }

  private tick(): void {
    this.stepped++;
    const s0 = this.fight;
    // the room's own seq per fighter (a reconnect restarts the client's seq; the engine only needs it increasing)
    const input = (i: Seat): FightInput | null => {
      const p = this.pending[i];
      if (p.a === undefined && p.g === undefined && p.mv === undefined) return null;
      this.engineSeq[i]++;
      return {
        seq: this.engineSeq[i],
        g: p.g ?? s0.fighters[i].guard,
        ...(p.mv ? { mv: p.mv } : {}),
        ...(p.a ? { a: p.a } : {}),
        ...(p.a && p.b ? { b: true } : {}),
      };
    };
    const inputs = [input(0), input(1)] as const;
    this.pending = [{}, {}];
    if (s0.phase === "paused") return;
    logStep(this.log, inputs);
    this.fight = stepFight(s0, inputs);
    this.budgetTicks++;
    const s = this.fight;
    const events = s.events;
    if (events.length) this.broadcast(FightEvt.events, events);
    this.frameEvents.push(...events);
    if (this.stepped % SNAP_EVERY === 0 || s.phase === "over") for (const c of this.clients) c.send(FightEvt.snap, snapshotOf(s, this.opts.ring));
    if (this.stepped % FRAME_EVERY === 0 || s.phase === "over") this.frame();
    this.status();
    if (s.phase === "over") return void this.settleOutcome();
    // IDLE strikes (exit rules row 9 / 10): engine counts; the room forfeits at maxTimeouts (void before the first move)
    for (const i of [0, 1] as const) {
      const f = s.fighters[i];
      if (f.idleStrikes > s0.fighters[i].idleStrikes) this.broadcast("timeout", { userId: f.id, strikes: f.idleStrikes, max: this.rules.maxTimeouts });
      if (!hasBegun(s) && f.idleStrikes >= 1) return void this.finish("void", "NO_FIRST_MOVE");
      if (f.idleStrikes >= this.rules.maxTimeouts) return void this.forfeitOrVoid(i, "TIMEOUTS");
    }
    // watchdog: the engine always ends within maxFightTicks(rules); past it something is wrong → void + refund
    if (this.budgetTicks > maxFightTicks(s.rules) + 2 * TICK_HZ) {
      log.error({ matchId: this.opts.matchId, ticks: this.budgetTicks }, "fight ran past its tick bound; voiding");
      void this.finish("void", "MATCH_TOO_LONG");
    }
  }

  private frameEvents: FightEvent[] = [];
  private frame(): void {
    const hall = this.opts.hallId ? boxingHallOf(this.opts.hallId) : undefined;
    hall?.fightFrame(this.opts.ring, this.opts.matchId, snapshotOf(this.fight, this.opts.ring), this.frameEvents);
    this.frameEvents = [];
  }

  /** ring status back to the hall (starting until the first bell, then fighting + live score) */
  private status(): void {
    const s = this.fight;
    const st = s.round >= 1 ? "fighting" : "starting";
    const key = `${st}:${s.round}:${s.fighters[0].points}:${s.fighters[1].points}`;
    if (key === this.lastStatus || s.phase === "over") return;
    this.lastStatus = key;
    const hall = this.opts.hallId ? boxingHallOf(this.opts.hallId) : undefined;
    hall?.fightStatus(this.opts.ring, this.opts.matchId, { status: st, round: s.round, rounds: s.rules.rounds, score: { red: s.fighters[0].points, blue: s.fighters[1].points } });
  }

  /** a connected fighter silent for staleMs during the fight is treated like a disconnect (pause, budget) */
  private checkStale(): void {
    const ph = this.fight.phase;
    // during a time-out the fighter still here just waits (they can't act, so silence is fine)
    if (ph === "intro" || ph === "over" || ph === "paused") return;
    const now = Date.now();
    for (const i of [0, 1] as const) {
      const uid = this.ids[i];
      if (this.away[i] !== null || !this.connected(uid)) continue;
      if (now - (this.lastSeen.get(uid) ?? now) > boxingConfig.staleMs) {
        this.stale[i] = true;
        this.gone(i);
      }
    }
  }

  private flushEvents(): void {
    const ev = this.fight.events;
    if (ev.length) {
      this.broadcast(FightEvt.events, ev);
      this.frameEvents.push(...ev);
    }
  }

  // ---------------------------------------------------------------- exits

  private async leaveVoluntarily(userId: string): Promise<void> {
    if (!hasBegun(this.fight)) return this.finish("void", "LEFT_BEFORE_START");
    await this.finish("forfeit", "RESIGN", this.seatOf(userId));
  }

  /** a forfeit nobody chose (budget used, idle strikes): void before the first move or when nobody is left to win */
  private async forfeitOrVoid(loser: Seat, cause: Exclude<ForfeitCause, "RESIGN">): Promise<void> {
    if (!hasBegun(this.fight)) return this.finish("void", cause === "TIMEOUTS" ? "NO_FIRST_MOVE" : "LEFT_BEFORE_START");
    const other = (1 - loser) as Seat;
    if (this.away[other] !== null || !this.connected(this.ids[other])) return this.finish("void", "BOTH_DISCONNECTED");
    await this.finish("forfeit", cause, loser);
  }

  private suspended(userId: string): void {
    if (!this.finished) {
      this.broadcast("player-removed", { userId, reason: "PLAYER_UNAVAILABLE" });
      void this.finish("void", "PLAYER_SUSPENDED");
    }
    for (const c of this.clients) if (this.sessions.get(c.sessionId) === userId) c.leave(4001);
  }

  /** the API no longer holds this match as active (sweep): end here too, without another call */
  endedElsewhere(): void {
    if (this.finished) return;
    this.finished = true;
    this.clearTimers();
    untrackLiveMatch(this.opts.matchId);
    for (const id of this.ids ?? []) if (liveSeats.get(id)?.roomId === this.roomId) liveSeats.delete(id);
    this.fight = voidFight(this.fight);
    this.log.ops.push({ o: "void" });
    const equal = Object.fromEntries(this.ids.map((id) => [id, 1]));
    this.broadcast(FightEvt.result, { ranks: equal, reason: "void", cause: "STALE_ESCROW", outcome: this.fight.outcome, settlement: { status: "void" } });
    this.over();
    this.clock.setTimeout(() => this.disconnect(), matchConfig.lingerMs);
  }

  /** the engine ended the fight (points / stoppage / draw) */
  private settleOutcome(): Promise<void> {
    const r = matchResultOf(this.fight);
    return this.finish(r.reason === "void" ? "void" : "normal");
  }

  private async settleWithRetry<T>(call: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
    let error: unknown = null;
    for (let i = 0; i < matchConfig.settleTries; i++) {
      try {
        return { ok: true, value: await call() };
      } catch (e) {
        error = e;
        if (e instanceof ApiError && !/^API_5\d\d$/.test(e.message)) break;
        if (i < matchConfig.settleTries - 1) await new Promise((r) => setTimeout(r, matchConfig.retryMs * (i + 1)));
      }
    }
    return { ok: false, error };
  }

  private async finish(reason0: Reason, cause0?: VoidCause | ForfeitCause, loser?: Seat): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    this.clearTimers();
    untrackLiveMatch(this.opts.matchId);
    for (const id of this.ids ?? []) if (liveSeats.get(id)?.roomId === this.roomId) liveSeats.delete(id);
    let reason = reason0;
    let cause = cause0;
    if (reason === "forfeit" && loser !== undefined) {
      this.fight = forfeitFight(this.fight, loser);
      this.log.ops.push({ o: "forfeit", loser });
    } else if (reason === "void") {
      this.fight = voidFight(this.fight);
      this.log.ops.push({ o: "void" });
    }
    // the engine's own end (points / stoppage / KO / DQ) was broadcast by its tick; forfeit / void made new events
    if (reason0 !== "normal") this.flushEvents();
    // pre-sign audit (P3-FGT-06): replay the log, re-derive every card and the decision; never sign a mismatch
    if (reason !== "void") {
      const errs = auditFight(this.fight, this.log);
      if (errs.length) {
        log.error({ matchId: this.opts.matchId, errs }, "boxing result failed its audit; voiding instead of signing");
        reason = "void";
        cause = "SERVER_ERROR";
      }
    }
    const res = matchResultOf(this.fight);
    const equal = Object.fromEntries(this.ids.map((id) => [id, 1]));
    const ranks = reason === "void" ? equal : res.ranks;
    const stateHash = boxingResultHash(this.fight, this.log);
    // the skill report (P3-FGT-10): computed here from the engine's own tallies, signed with the result
    const lines = fightStatsOf(this.fight);
    const stats = Object.fromEntries(this.ids.map((id, i) => [id, { ...lines[i]! }]));
    const signed = signResult(
      { matchId: this.opts.matchId, game: BOXING_GAME_ID, ranks, reason, stateHash, finishedAt: new Date().toISOString(), ...(reason !== "void" ? { stats } : {}) },
      privateKey,
    );
    let settlement: unknown = null;
    let outReason: Reason = reason;
    let outCause = cause;
    let pending = false;
    if (reason === "void") {
      const v = await this.settleWithRetry(() => api.voidMatch(this.opts.matchId, cause as VoidCause | undefined));
      if (v.ok) settlement = v.value;
      else pending = true;
    } else {
      const s = await this.settleWithRetry(() => api.submitResult(signed));
      if (s.ok) settlement = s.value;
      else {
        log.error({ err: String(s.error), matchId: this.opts.matchId }, "settlement failed; voiding instead");
        outReason = "void";
        outCause = "SERVER_ERROR";
        const v = await this.settleWithRetry(() => api.voidMatch(this.opts.matchId, "SERVER_ERROR"));
        if (v.ok) settlement = v.value;
        else pending = true;
      }
    }
    this.broadcast(FightEvt.result, {
      ranks: outReason === "void" ? equal : signed.ranks,
      reason: outReason,
      ...(outCause ? { cause: outCause } : {}),
      ...(loser !== undefined && outReason === "forfeit" ? { loser: this.ids[loser] } : {}),
      outcome: this.fight.outcome,
      stateHash,
      stats,
      settlement,
      ...(pending ? { pending: true } : {}),
    });
    this.over();
    this.clock.setTimeout(() => this.disconnect(), matchConfig.lingerMs);
  }

  /** read-only views for audits / tests: the engine state and the fight log the result was signed from */
  fightState(): FightState {
    return this.fight;
  }
  fightLog(): FightLog {
    return this.log;
  }

  /** tell the hall: the ring shows the result, then frees */
  private over(): void {
    const s = this.fight;
    const hall = this.opts.hallId ? boxingHallOf(this.opts.hallId) : undefined;
    hall?.fightFrame(this.opts.ring, this.opts.matchId, snapshotOf(s, this.opts.ring), this.frameEvents);
    this.frameEvents = [];
    hall?.fightOver(this.opts.ring, this.opts.matchId, { score: { red: s.fighters[0].points, blue: s.fighters[1].points }, round: s.round });
  }

  private clearTimers(): void {
    this.joinTimer?.clear();
    this.maxTimer?.clear();
    this.introTimer?.clear();
    for (const t of this.awayTimer) t?.clear();
  }

  override onDispose(): void {
    for (const off of this.tracked.values()) off();
    this.tracked.clear();
    this.clearTimers();
    rooms.delete(this.roomId);
    untrackLiveMatch(this.opts.matchId);
    for (const id of this.ids ?? []) if (liveSeats.get(id)?.roomId === this.roomId) liveSeats.delete(id);
    if (!this.finished) {
      void api.voidMatch(this.opts.matchId, "ROOM_CLOSED").catch(() => undefined);
      this.finished = true;
      this.over();
    }
  }
}
