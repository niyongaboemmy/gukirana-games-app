import {
  GAME_HALL,
  INVITE_LIMITS,
  InviteCancelSchema,
  InviteRespondSchema,
  InviteSendSchema,
  isPersonalRefusal,
  MM_TIMING,
  MmEvt,
  MmFindSchema,
  MmRespondSchema,
  MmWidenSchema,
  VenuesGetSchema,
  type GameId,
  type InviteClosedMsg,
  type InviteMsg,
  type MmClosedMsg,
  type MmFoundMsg,
  type MmGoMsg,
  type MmPerson,
  type MmStatusMsg,
  type VenuesMsg,
} from "@gukirana/contracts";
import { createLogger } from "@gukirana/observability";
import { ApiError, type Eligibility } from "./api-client.js";
import { MatchFinder, type Offer, type RespondResult, type Ticket } from "./social/match-finder.js";
import { InviteBook, type Invite } from "./social/invites.js";
import { MmHub, type HallPort, type SessionPort } from "./social/mm-hub.js";

const log = createLogger("matchmaker");

/**
 * Matchmaking v2 (P2-MM-05, docs/MATCHMAKING-V2.md): Find an opponent, challenges and the rendezvous at a reserved
 * table / ring, for every room of this process. Rooms forward their messages here; this service answers through the
 * hub, so a player hears about their search, a found opponent or a challenge in whatever hall / plaza they are in.
 *
 * Money: nothing moves here. The match is created (Stars locked in escrow by the API's LedgerService) only once both
 * players are at the reserved place — the same `startMatch` the v1 flow uses. No bots: only real accounts are paired.
 */
export const mmConfig = {
  enabled: process.env.FF_MATCH_V2 !== "0",
  acceptMs: MM_TIMING.acceptSeconds * 1000,
  inviteMs: MM_TIMING.inviteSeconds * 1000,
  arriveMs: MM_TIMING.arriveSeconds * 1000,
  /** a hall change (leave one room, join the next) must not cancel anything: gone this long = offline */
  offlineGraceMs: 12_000,
  tickMs: 500,
};

export interface MmDeps {
  eligibility(uid: string, stake: number, game: string): Promise<Eligibility>;
  startMatch(game: GameId, stake: number, uids: [string, string]): Promise<{ roomId: string; matchId: string }>;
  /** a hall room for `game` (nobody inside yet): its room id once it registered with the hub */
  createHall(game: string): Promise<string>;
}

interface Meet {
  id: string;
  game: GameId;
  stake: number;
  players: [MmPerson, MmPerson];
  roomId: string;
  hall: MmGoMsg["hall"];
  table?: string;
  seats: Record<string, string>;
  arrived: Set<string>;
  expires: number;
  starting: boolean;
}

/** Reasons about one player's own account: only that player hears them; the other side hears OPPONENT_CANT_PLAY. */
function reasonFor(e: unknown, viewer: string): { reason: string; limit?: number } {
  const reason = e instanceof Error ? e.message : String(e);
  if (!isPersonalRefusal(reason)) return { reason };
  if (e instanceof ApiError && e.userId === viewer) return e.limit !== undefined ? { reason, limit: e.limit } : { reason };
  return { reason: "OPPONENT_CANT_PLAY" };
}
const refusal = (e: Eligibility): { reason: string; limit?: number } | null =>
  e.ok || !e.reason || e.reason === "UNKNOWN_PLAYER" ? null : { reason: e.reason, ...(e.limit !== undefined ? { limit: e.limit } : {}) };

export class MatchService {
  readonly hub = new MmHub();
  readonly finder: MatchFinder;
  readonly invites: InviteBook;
  private meets = new Map<string, Meet>();
  private gone = new Map<string, number>();
  private seq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private deps: MmDeps,
    private clock: () => number = Date.now,
  ) {
    this.finder = new MatchFinder(mmConfig.acceptMs, (a, b) => this.hub.separated(a, b));
    this.invites = new InviteBook({ ttlMs: mmConfig.inviteMs, perMinute: INVITE_LIMITS.perMinute, open: INVITE_LIMITS.open });
  }

  setDeps(d: Partial<MmDeps>): void {
    this.deps = { ...this.deps, ...d };
  }

  // ---------------------------------------------------------------- presence

  /** a signed-in session joined a plaza / hall room; returns the unregister */
  register(uid: string, port: SessionPort): () => void {
    this.ensureTimer();
    const off = this.hub.register(uid, port);
    this.gone.delete(uid);
    this.resync(uid, port);
    // a meeting in this hall is waiting for them (Boxing: the ring is assigned once both are in)
    for (const m of this.meets.values()) if (m.roomId === port.roomId && m.players.some((p) => p.uid === uid)) void this.checkBoxing(m);
    return () => {
      off();
      if (!this.hub.online(uid)) this.gone.set(uid, this.clock());
    };
  }
  addHall(port: HallPort): () => void {
    return this.hub.addHall(port);
  }

  /** what a fresh session must know: my search, an open "found", a meeting, challenges to me */
  private resync(uid: string, port: SessionPort): void {
    const t = this.finder.ticketOf(uid);
    if (t) port.send(MmEvt.status, this.statusOf(t));
    const o = this.finder.offerOf(uid);
    if (o && !o.accepted.has(uid)) port.send(MmEvt.found, this.foundMsg(o, uid));
    const m = this.meetOf(uid);
    if (m) port.send(MmEvt.go, this.goMsg(m, uid));
    for (const i of this.invites.incoming(uid)) port.send(MmEvt.invite, this.inviteMsg(i));
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), mmConfig.tickMs);
    this.timer.unref?.();
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** expiries: found offers, challenges, meetings; accounts gone past the grace */
  tick(now = this.clock()): void {
    for (const x of this.finder.sweep(now)) {
      const o = x.offer;
      for (const uid of x.dropped) this.sendClosed(uid, { id: o.id, kind: "found", reason: "EXPIRED" }, true);
      for (const uid of x.requeued) this.sendClosed(uid, { id: o.id, kind: "found", reason: "OPPONENT_TIMEOUT", requeued: true });
    }
    this.pair(now);
    for (const i of this.invites.sweep(now)) {
      this.hub.send(i.from.uid, MmEvt.inviteClosed, { id: i.id, reason: "EXPIRED", name: i.to.name } satisfies InviteClosedMsg);
      this.hub.send(i.to.uid, MmEvt.inviteClosed, { id: i.id, reason: "EXPIRED", name: i.from.name } satisfies InviteClosedMsg);
    }
    for (const m of [...this.meets.values()])
      if (!m.starting && now > m.expires)
        this.closeMeet(m, (uid) => (m.arrived.has(uid) ? "OPPONENT_NO_SHOW" : "NO_SHOW"));
    for (const [uid, at] of [...this.gone]) {
      if (this.hub.online(uid)) {
        this.gone.delete(uid);
        continue;
      }
      if (now - at < mmConfig.offlineGraceMs) continue;
      this.gone.delete(uid);
      this.offline(uid, now);
    }
  }

  /** the account is gone: its search ends, its challenges close, a meeting with it is called off */
  private offline(uid: string, now: number): void {
    const r = this.finder.leave(uid, now);
    if (r?.kind === "declined") for (const o of r.requeued) this.sendClosed(o, { id: r.offer.id, kind: "found", reason: "OPPONENT_DECLINED", requeued: true });
    for (const i of this.invites.forget(uid)) {
      const other = i.from.uid === uid ? i.to : i.from;
      this.hub.send(other.uid, MmEvt.inviteClosed, { id: i.id, reason: "PLAYER_LEFT", name: (i.from.uid === uid ? i.from : i.to).name } satisfies InviteClosedMsg);
    }
    const m = this.meetOf(uid);
    if (m && !m.starting) this.closeMeet(m, () => "PLAYER_LEFT");
    this.pair(now);
  }

  /** a block between two accounts: nothing passes between them any more */
  blocked(a: string, b: string): void {
    for (const i of this.invites.forgetPair(a, b)) {
      this.hub.send(i.from.uid, MmEvt.inviteClosed, { id: i.id, reason: "PLAYER_UNAVAILABLE" } satisfies InviteClosedMsg);
      this.hub.send(i.to.uid, MmEvt.inviteClosed, { id: i.id, reason: "PLAYER_UNAVAILABLE" } satisfies InviteClosedMsg);
    }
    const o = this.finder.offerOf(a);
    if (o && (o.a.uid === b || o.b.uid === b)) {
      const r = this.finder.respond(o.id, a, false, this.clock());
      this.sendClosed(a, { id: o.id, kind: "found", reason: "CANCELLED" }, true);
      if (r?.kind === "declined") for (const u of r.requeued) this.sendClosed(u, { id: o.id, kind: "found", reason: "OPPONENT_DECLINED", requeued: true });
    }
  }

  // ---------------------------------------------------------------- find an opponent

  async find(uid: string, raw: unknown, from?: SessionPort): Promise<void> {
    const p = MmFindSchema.safeParse(raw);
    if (!p.success) return this.hub.send(uid, MmEvt.status, { status: "error", reason: "INVALID" } satisfies MmStatusMsg);
    const { game, venue } = p.data;
    if (this.meetOf(uid)) return this.hub.send(uid, MmEvt.status, { status: "error", game, reason: "BUSY" } satisfies MmStatusMsg);
    // checked before queueing (GAP-011): every stake I can't play is dropped; none left → the first reason
    const checks = await Promise.all(p.data.stakes.map(async (s) => ({ s, why: refusal(await this.deps.eligibility(uid, s, game).catch(() => ({ ok: true }) as Eligibility)) })));
    const stakes = checks.filter((c) => !c.why).map((c) => c.s);
    if (!stakes.length) {
      const why = checks[0]!.why!;
      return this.hub.send(uid, MmEvt.status, { status: "error", game, ...why } satisfies MmStatusMsg);
    }
    const me = this.hub.person(uid);
    if (!me) return; // left meanwhile
    const prev = this.finder.ticketOf(uid);
    const where = from ?? this.hub.latest(uid);
    const hallHere = where && where.hall === GAME_HALL[game] ? where.roomId : undefined;
    const ticket: Ticket = {
      ...me,
      game,
      stakes,
      since: prev && prev.game === game ? prev.since : this.clock(),
      ...(hallHere ? { venue: { roomId: hallHere, ...(venue?.place ? { place: venue.place } : {}) } } : {}),
    };
    // one thing at a time: a search replaces my open challenges' "wait" (they stay open; accepting one ends the search)
    this.finder.join(ticket);
    this.statusToGame(game);
    this.pair(this.clock());
  }

  cancel(uid: string): void {
    const t = this.finder.ticketOf(uid);
    const r = this.finder.leave(uid, this.clock());
    this.hub.send(uid, MmEvt.status, { status: "idle" } satisfies MmStatusMsg);
    if (r?.kind === "declined") {
      this.sendClosed(uid, { id: r.offer.id, kind: "found", reason: "CANCELLED" });
      for (const o of r.requeued) this.sendClosed(o, { id: r.offer.id, kind: "found", reason: "OPPONENT_DECLINED", requeued: true });
    }
    if (t) this.statusToGame(t.game);
    this.pair(this.clock());
  }

  async widen(uid: string, raw: unknown): Promise<void> {
    const p = MmWidenSchema.safeParse(raw);
    const t = this.finder.ticketOf(uid);
    if (!p.success || !t) return;
    const ok = await Promise.all(p.data.stakes.map(async (s) => (refusal(await this.deps.eligibility(uid, s, t.game).catch(() => ({ ok: true }) as Eligibility)) ? null : s)));
    const stakes = ok.filter((s): s is number => s !== null);
    if (!stakes.length || !this.finder.widen(uid, stakes)) return;
    this.statusToGame(t.game);
    this.pair(this.clock());
  }

  respond(uid: string, raw: unknown): void {
    const p = MmRespondSchema.safeParse(raw);
    if (!p.success) return;
    const now = this.clock();
    const r = this.finder.respond(p.data.id, uid, p.data.accept, now);
    if (!r) return;
    this.afterRespond(r, uid);
    this.pair(now);
  }

  private afterRespond(r: RespondResult, uid: string): void {
    const o = r.offer;
    if (r.kind === "pending") return this.hub.send(uid, MmEvt.status, { status: "searching", game: o.game, stakes: [o.stake], searching: {} } satisfies MmStatusMsg);
    if (r.kind === "declined") {
      this.sendClosed(uid, { id: o.id, kind: "found", reason: "DECLINED" }, true);
      for (const other of r.requeued) this.sendClosed(other, { id: o.id, kind: "found", reason: "OPPONENT_DECLINED", requeued: true });
      return;
    }
    // both said yes: the older ticket's chosen place first, then the other one's
    const prefer = o.a.venue ?? o.b.venue;
    void this.beginMeet(o.game, o.stake, [person(o.a), person(o.b)], prefer);
  }

  private pair(now: number): void {
    for (const o of this.finder.pairAll(now)) {
      log.info({ event: "mm.found", game: o.game, stake: o.stake, offer: o.id }, "opponent found");
      for (const uid of [o.a.uid, o.b.uid]) this.hub.send(uid, MmEvt.found, this.foundMsg(o, uid));
      this.statusToGame(o.game);
    }
  }

  // ---------------------------------------------------------------- challenges

  async invite(uid: string, raw: unknown): Promise<void> {
    const p = InviteSendSchema.safeParse(raw);
    const fail = (reason: string, extra: Partial<InviteClosedMsg> = {}) => this.hub.send(uid, MmEvt.inviteClosed, { id: null, reason, ...extra } satisfies InviteClosedMsg);
    if (!p.success) return fail("INVALID_PROPOSAL");
    const { to, game, stake, venue } = p.data;
    const me = this.hub.person(uid);
    if (!me) return;
    if (to === uid) return fail("PLAYER_UNAVAILABLE");
    // blocked either way: the same words as for someone who isn't there (a block is never revealed)
    if (this.hub.separated(uid, to)) return fail("PLAYER_UNAVAILABLE");
    const them = this.hub.person(to);
    if (!them) return fail("OFFLINE");
    if (this.meetOf(to) || this.finder.offerOf(to)) return fail("BUSY", { name: them.name });
    const [mine, theirs] = await Promise.all([this.deps.eligibility(uid, stake, game).catch(() => ({ ok: true }) as Eligibility), this.deps.eligibility(to, stake, game).catch(() => ({ ok: true }) as Eligibility)]);
    const myWhy = refusal(mine);
    if (myWhy) return fail(myWhy.reason, { game, ...(myWhy.limit !== undefined ? { limit: myWhy.limit } : {}) });
    const theirWhy = refusal(theirs);
    if (theirWhy) return fail(theirWhy.reason === "ALREADY_IN_MATCH" ? "BUSY" : theirWhy.reason === "GAME_DISABLED" || theirWhy.reason === "STAKE_NOT_ALLOWED" ? theirWhy.reason : "OPPONENT_CANT_PLAY", { name: them.name, game });
    if (!this.hub.online(to) || this.hub.separated(uid, to)) return fail("OFFLINE");
    // the place named in the challenge is in the hall instance I am in, else the one they are in, else the open one
    const hall = GAME_HALL[game];
    const inHall = (u: string) => {
      const s = this.hub.latest(u);
      return s?.hall === hall ? s.roomId : undefined;
    };
    const roomId = inHall(uid) ?? inHall(to) ?? this.hub.hallsOf(hall)[0]?.roomId;
    const v = { hall, ...(roomId ? { roomId } : {}), ...(venue?.place ? { place: venue.place } : {}) };
    const r = this.invites.send({ from: me, to: them, game, stake, venue: v }, this.clock());
    if (!r.ok) {
      if (r.reason === "CROSSED") return fail("CROSSED", { name: them.name, id: r.invite.id });
      return fail(r.reason, { name: them.name });
    }
    const i = r.invite;
    log.info({ event: "mm.invite", game, stake, invite: i.id }, "challenge sent");
    this.hub.send(to, MmEvt.invite, this.inviteMsg(i));
    this.hub.send(uid, MmEvt.inviteSent, { id: i.id, to: them, game, stake, ttlMs: i.expires - this.clock() });
  }

  inviteRespond(uid: string, raw: unknown): void {
    const p = InviteRespondSchema.safeParse(raw);
    if (!p.success) return;
    const i = this.invites.respond(p.data.id, uid, this.clock());
    if (!i) return this.hub.send(uid, MmEvt.inviteClosed, { id: p.data.id, reason: "EXPIRED" } satisfies InviteClosedMsg);
    if (!p.data.accept) return this.hub.send(i.from.uid, MmEvt.inviteClosed, { id: i.id, reason: "DECLINED", name: i.to.name } satisfies InviteClosedMsg);
    if (!this.hub.online(i.from.uid)) return this.hub.send(uid, MmEvt.inviteClosed, { id: i.id, reason: "PLAYER_LEFT", name: i.from.name } satisfies InviteClosedMsg);
    if (this.meetOf(i.from.uid)) return this.hub.send(uid, MmEvt.inviteClosed, { id: i.id, reason: "BUSY", name: i.from.name } satisfies InviteClosedMsg);
    this.hub.send(i.from.uid, MmEvt.inviteClosed, { id: i.id, reason: "ACCEPTED", name: i.to.name } satisfies InviteClosedMsg);
    // both stop searching: they are on their way to play each other
    for (const u of [i.from.uid, i.to.uid]) if (this.finder.ticketOf(u)) this.cancel(u);
    void this.beginMeet(i.game, i.stake, [i.from, i.to], i.venue?.roomId ? { roomId: i.venue.roomId, ...(i.venue.place ? { place: i.venue.place } : {}) } : undefined);
  }

  inviteCancel(uid: string, raw: unknown): void {
    const p = InviteCancelSchema.safeParse(raw);
    if (!p.success) return;
    const i = this.invites.cancel(p.data.id, uid);
    if (!i) return;
    this.hub.send(i.to.uid, MmEvt.inviteClosed, { id: i.id, reason: "CANCELLED", name: i.from.name } satisfies InviteClosedMsg);
    this.hub.send(uid, MmEvt.inviteClosed, { id: i.id, reason: "CANCELLED_BY_YOU", name: i.to.name } satisfies InviteClosedMsg);
  }

  // ---------------------------------------------------------------- venues + people

  venues(uid: string, raw: unknown): void {
    const p = VenuesGetSchema.safeParse(raw);
    if (!p.success) return;
    const game = p.data.game;
    const port = this.hallFor(game, uid);
    const places = port?.places() ?? {};
    // a table where someone sits searching shows as "waiting" (sit down and Find an opponent to play them)
    const waits: Record<string, { name: string; stakes: number[] }> = {};
    for (const t of this.finder.tickets())
      if (t.game === game && port && t.venue?.roomId === port.roomId && t.venue.place && t.uid !== uid) waits[t.venue.place] = { name: t.name, stakes: t.stakes };
    const msg: VenuesMsg & { waits: typeof waits } = { game, hall: GAME_HALL[game], places, searching: this.finder.counts(game, uid), waits };
    this.hub.send(uid, MmEvt.venues, msg);
  }

  online(uid: string): void {
    const people = [];
    for (const other of this.hub.accounts()) {
      if (other === uid || this.hub.separated(uid, other)) continue;
      const s = this.hub.latest(other);
      if (!s) continue;
      people.push({ ...s.person(), where: s.hall ?? "plaza", busy: !!this.meetOf(other) || !!this.finder.offerOf(other) });
      if (people.length >= 60) break;
    }
    this.hub.send(uid, MmEvt.online, { people });
  }

  // ---------------------------------------------------------------- rendezvous

  private meetOf(uid: string): Meet | undefined {
    for (const m of this.meets.values()) if (m.players.some((p) => p.uid === uid)) return m;
    return undefined;
  }
  busy(uid: string): boolean {
    return !!this.meetOf(uid) || !!this.finder.offerOf(uid);
  }

  /** the hall to play `game` in: where `uid` is, else the busiest open one */
  private hallFor(game: GameId, uid?: string): HallPort | undefined {
    const halls = this.hub.hallsOf(GAME_HALL[game]);
    const here = uid ? this.hub.latest(uid) : undefined;
    return halls.find((h) => h.roomId === here?.roomId) ?? halls[0];
  }

  private async beginMeet(game: GameId, stake: number, players: [MmPerson, MmPerson], prefer?: { roomId: string; place?: string }): Promise<void> {
    const uids = players.map((p) => p.uid);
    const halls = this.hub.hallsOf(GAME_HALL[game]);
    const at = (u: string) => this.hub.latest(u)?.roomId;
    let port = (prefer && this.hub.hall(prefer.roomId)) || halls.find((h) => uids.some((u) => at(u) === h.roomId)) || halls[0];
    if (!port) {
      try {
        const roomId = await this.deps.createHall(GAME_HALL[game]);
        port = this.hub.hall(roomId);
      } catch (e) {
        log.warn({ event: "mm.hall_failed", game, err: String(e) }, "could not open a hall for the match");
      }
    }
    if (!port) return this.closeAll(uids, "NO_FREE_PLACE");
    const id = `m${++this.seq}`;
    const meet: Meet = { id, game, stake, players, roomId: port.roomId, hall: port.game, seats: {}, arrived: new Set(), expires: this.clock() + mmConfig.arriveMs, starting: false };
    if (game !== "boxing") {
      const want = prefer?.roomId === port.roomId ? prefer.place : undefined;
      const r = port.reserve?.(uids, want) ?? null;
      if (!r) return this.closeAll(uids, "NO_FREE_PLACE");
      meet.table = r.table;
      meet.seats = r.seats;
      for (const u of r.seated) meet.arrived.add(u);
    }
    port.keepAlive(true);
    this.meets.set(id, meet);
    log.info({ event: "mm.meet", game, stake, meet: id, hall: port.roomId, table: meet.table }, "players sent to their place");
    for (const u of uids) this.hub.send(u, MmEvt.go, this.goMsg(meet, u));
    if (game === "boxing") await this.checkBoxing(meet);
    else if (meet.arrived.size === 2) await this.startMeet(meet);
  }

  /** a player sat down in a hall: their reserved chair → arrived; both there → the match starts */
  async seated(uid: string, roomId: string, seat: string): Promise<void> {
    const m = this.meetOf(uid);
    if (!m || m.starting || m.roomId !== roomId || m.seats[uid] !== seat) return;
    m.arrived.add(uid);
    if (m.arrived.size === 2) await this.startMeet(m);
  }

  private async checkBoxing(m: Meet): Promise<void> {
    if (m.game !== "boxing" || m.starting) return;
    if (!m.players.every((p) => this.hub.inRoom(p.uid, m.roomId))) return;
    const port = this.hub.hall(m.roomId);
    if (!port?.assignBoxing) return this.closeMeet(m, () => "NO_FREE_PLACE");
    m.starting = true;
    try {
      await port.assignBoxing(m.players[0].uid, m.players[1].uid, m.stake);
      this.endMeet(m);
    } catch (e) {
      m.starting = false;
      this.closeMeet(m, (u) => reasonFor(e, u).reason, e);
    }
  }

  private async startMeet(m: Meet): Promise<void> {
    m.starting = true;
    const [a, b] = m.players;
    try {
      const r = await this.deps.startMatch(m.game, m.stake, [a.uid, b.uid]);
      log.info({ event: "mm.start", game: m.game, stake: m.stake, meet: m.id, match: r.matchId }, "match started at the reserved table");
      for (const p of m.players) this.hub.send(p.uid, "match-ready", { ...r, game: m.game, stake: m.stake });
      this.endMeet(m);
    } catch (e) {
      this.closeMeet(m, (u) => reasonFor(e, u).reason, e);
    }
  }

  private endMeet(m: Meet): void {
    this.meets.delete(m.id);
    const port = this.hub.hall(m.roomId);
    port?.release?.(m.players.map((p) => p.uid));
    port?.keepAlive(this.hasMeetIn(m.roomId));
  }
  private hasMeetIn(roomId: string): boolean {
    for (const m of this.meets.values()) if (m.roomId === roomId) return true;
    return false;
  }

  private closeMeet(m: Meet, why: (uid: string) => string, e?: unknown): void {
    this.endMeet(m);
    for (const p of m.players) {
      const extra = e instanceof ApiError && e.userId === p.uid && e.limit !== undefined ? { limit: e.limit } : {};
      this.sendClosed(p.uid, { id: m.id, kind: "meet", reason: why(p.uid), game: m.game, ...extra });
    }
  }
  private closeAll(uids: string[], reason: string): void {
    for (const u of uids) this.sendClosed(u, { id: `m${this.seq}`, kind: "meet", reason });
  }

  // ---------------------------------------------------------------- messages

  private sendClosed(uid: string, msg: MmClosedMsg, idle = false): void {
    this.hub.send(uid, MmEvt.closed, msg);
    if (idle) this.hub.send(uid, MmEvt.status, { status: "idle" } satisfies MmStatusMsg);
    else if (msg.requeued) {
      const t = this.finder.ticketOf(uid);
      if (t) this.hub.send(uid, MmEvt.status, this.statusOf(t));
    }
  }
  private statusOf(t: Ticket): MmStatusMsg {
    return { status: "searching", game: t.game, stakes: t.stakes, waitedMs: this.clock() - t.since, searching: this.finder.counts(t.game, t.uid) };
  }
  /** everyone searching this game hears the new counters */
  private statusToGame(game: GameId): void {
    for (const t of this.finder.tickets()) if (t.game === game) this.hub.send(t.uid, MmEvt.status, this.statusOf(t));
  }
  private foundMsg(o: Offer, uid: string): MmFoundMsg {
    const other = o.a.uid === uid ? o.b : o.a;
    return { id: o.id, game: o.game, stake: o.stake, opponent: person(other), ttlMs: Math.max(0, o.expires - this.clock()) };
  }
  private goMsg(m: Meet, uid: string): MmGoMsg {
    const other = m.players[0].uid === uid ? m.players[1] : m.players[0];
    return {
      id: m.id,
      game: m.game,
      stake: m.stake,
      hall: m.hall,
      roomId: m.roomId,
      ...(m.table ? { table: m.table } : {}),
      ...(m.seats[uid] ? { seat: m.seats[uid] } : {}),
      opponent: other,
      ttlMs: Math.max(0, m.expires - this.clock()),
    };
  }
  private inviteMsg(i: Invite): InviteMsg {
    return { id: i.id, from: i.from, game: i.game, stake: i.stake, ...(i.venue ? { venue: { hall: i.venue.hall, ...(i.venue.place ? { place: i.venue.place } : {}) } } : {}), ttlMs: Math.max(0, i.expires - this.clock()) };
  }
}

const person = (t: MmPerson): MmPerson => ({ uid: t.uid, name: t.name, ...(t.level !== undefined ? { level: t.level } : {}), ...(t.color ? { color: t.color } : {}) });

/** the process-wide service (deps wired in index.ts / tests) */
export const matchService = new MatchService({
  eligibility: async () => ({ ok: true }),
  startMatch: async () => {
    throw new Error("NOT_WIRED");
  },
  createHall: async () => {
    throw new Error("NOT_WIRED");
  },
});
