import { Room, type Client } from "@colyseus/core";
import { createLogger } from "@gukirana/observability";
import {
  ArenaMsg,
  BlockListSchema,
  BOXING_GAME_ID,
  BOXING_HALL_CAPACITY,
  BoxingHallMsg,
  CALL_RING_MS,
  CallEndSchema,
  CallRespondSchema,
  CHAT_MIN_INTERVAL_MS,
  ChatSendSchema,
  DmSendSchema,
  EMOTE_COOLDOWN_MS,
  EmoteSendSchema,
  isHallId,
  isKnownAnim,
  NEARBY_CHAT_RANGE,
  PAIR_MS,
  PairRequestSchema,
  PairRespondSchema,
  plazaSeat,
  TargetSchema,
  UnblockSchema,
  WorldMoveSchema,
  PERSONAL_REFUSALS,
  HOLD_SEAT_HALLS,
  HALL_SEATING,
  MmMsg,
  reservedFor,
  type VenueStatus,
  type HallId,
  type PlaceMsg,
  type SeatHolds,
} from "@gukirana/contracts";
import { api, ApiError } from "../api-client.js";
import { filterChat, sanitizeName } from "../chat-filter.js";
import { verifyToken, type UserClaims } from "../auth.js";
import { isGame, isStake, quickMatch, startMatch, type GameId } from "../matchmaking.js";
import { SeatRegistry } from "../social/seats.js";
import { BlockGraph, blockKeyFor, type Ident } from "../social/blocks.js";
import { DmRouter } from "../social/dm.js";
import { CallRegistry } from "../social/calls.js";
import { InterestManager, TICK_MS, type Mover } from "../social/interest.js";
import { RateLimiter } from "../social/rate.js";
import { PairRegistry } from "../social/pairs.js";
import { MoveGuard } from "../social/movement.js";
import { OfficeDesk } from "./office-desk.js";
import { ArenaHall } from "./arena-hall.js";
import { BoxingHall, boxingHallConfig, type RingKeep } from "./boxing-hall.js";
import { boxingRoomOf, startBoxing } from "./boxing-room.js";
import { arenaConfig } from "../social/arena-access.js";
import { holdMsFor, info, placeHoldConfig, placeHolds, type Hold } from "../social/place-holds.js";
import { matchMaker } from "@colyseus/core";
import { matchService, mmConfig } from "../matchmaker-v2.js";
import type { HallPort, Reservation, SessionPort } from "../social/mm-hub.js";

// P2-MM-05: the matchmaking service asks the API like the v1 flows do, and opens a hall when none is open yet
matchService.setDeps({
  eligibility: (uid, stake, game) => eligibilityOf(uid, stake, game),
  startMatch: (game, stake, uids) => startMatch(game as GameId, stake, uids),
  createHall: async (game) => (await matchMaker.createRoom("hall", { game })).roomId,
});
const TABLE_HALLS = ["pool", "ludo", "igisoro"] as const;

/**
 * Farthest position a player may report (centimetres from the fountain, each axis). The campus (P2-WLD-12) reaches
 * r ≈ 245 m on its north arc and the frontage road at z ≈ 96 m; hall interiors are well inside this.
 */
const WORLD_EDGE_CM = 26_000;
const log = createLogger("world-room");
import { eligibilityOf, isRefusal, mutedUntil, signedOutSince, trackAccount } from "../social/accounts.js";

export interface WorldPlayer {
  id: string;
  name: string;
  color: string;
  level: number;
  x: number; // centimetres
  z: number;
  yaw: number; // 0–65535
  anim: number; // 0 idle, 1 walk, 2 run, 10+ emotes, 13 seated
  look?: string; // encoded avatar look (client renders; validated length/charset)
  bodyType?: string;
  verified: boolean; // logged in (can challenge, DM, call, voice)
  /** account id (signed-in players only): public profile lookups + persistent blocks */
  uid?: string;
}

interface Proposal {
  id: string;
  from: string; // sessionId
  to: string;
  /** boxing only inside the Boxing hall (a ring is assigned on accept) */
  game: GameId | typeof BOXING_GAME_ID;
  stake: number;
  expires: number;
}

const COLOR = /^#[0-9a-f]{6}$/i;
const LOOK = /^[\w.:;,|#=-]{0,300}$/;
const PROPOSAL_TTL = 60_000;
/**
 * Reasons about one player's own account or limits (responsible play, Stars, suspension). Only that player is told;
 * the other side of the challenge / quick match gets OPPONENT_CANT_PLAY ("They can't play right now", GAP-005).
 */
const PERSONAL_REASONS = new Set<string>(PERSONAL_REFUSALS);
export const OPPONENT_CANT_PLAY = "OPPONENT_CANT_PLAY";
/** the reason a failed match start is shown to `viewer` (account id) */
export function reasonFor(e: unknown, viewer: string): string {
  const reason = e instanceof Error ? e.message : String(e);
  if (!PERSONAL_REASONS.has(reason)) return reason;
  return e instanceof ApiError && e.userId === viewer ? reason : OPPONENT_CANT_PLAY;
}
/** the failure message for `viewer`: the reason, plus the friendly limit when it is their own (plain-words UI) */
export function refusalFor(e: unknown, viewer: string, game: GameId): { reason: string; game: GameId; limit?: number } {
  const reason = reasonFor(e, viewer);
  return reason === "FRIENDLY_LIMIT_REACHED" && e instanceof ApiError && e.limit !== undefined ? { reason, game, limit: e.limit } : { reason, game };
}
/** A plaza bench place is freed when its holder walks this far away from it (m). */
const SEAT_LEAVE_M = 2.5;

/**
 * Plaza / hall presence (SRS §8.4): movement (batched, distance-tiered), emotes, proximity + room chat with
 * speech bubbles, 1:1 DMs (chat requests), proximity voice signalling + private calls, server-claimed seats
 * (hall chairs, plaza benches), blocks (mutual invisibility), in-world proposals and Quick Match.
 * Guests can walk and chat; challenges, DMs, voice and calls need a signed-in account. All deals go through escrow.
 */
export class WorldRoom extends Room {
  override maxClients = 50;
  private players = new Map<string, WorldPlayer>();
  private seqs = new Map<string, number>();
  private users = new Map<string, UserClaims>(); // sessionId → claims
  private proposals = new Map<string, Proposal>();
  private seq = 0;
  private hallGame: HallId | null = null;
  private seats = new SeatRegistry("plaza");
  private blocks = new BlockGraph();
  private dms = new DmRouter();
  private calls = new CallRegistry();
  private interest = new InterestManager();
  private rate = new RateLimiter();
  private pairs = new PairRegistry();
  /** speed / teleport clamp on the positions the room keeps (social/movement.ts, GAP-014) */
  private moveGuard = new MoveGuard();
  /** Administrative Block only (hall "admin") */
  private desk: OfficeDesk | null = null;
  /** Tournament Arena rules (hall "arena" only, P2-ARN-02) */
  private arena: ArenaHall | null = null;
  /** Boxing sub-hall: ring registry, ring actions, fights, spectators (hall "boxing" only, P3-FGT-01) */
  private boxing: BoxingHall | null = null;
  private lastChat = new Map<string, number>();
  private lastEmote = new Map<string, number>();
  private tick = 0;
  private msgSeq = 0;
  /** sessionId → unregister from the account registry (social/accounts.ts: suspension closes the session) */
  private tracked = new Map<string, () => void>();
  /** P2-NET-06: the places this room keeps for players who lost their connection (uid → hold; social/place-holds.ts) */
  private heldHere = new Map<string, Hold>();
  /** P2-MM-05: sessionId → unregister from the matchmaking hub; this hall's port; kept alive for a reservation */
  private mmSessions = new Map<string, () => void>();
  private mmHall: (() => void) | null = null;
  private mmKeep = false;

  override async onAuth(_c: Client, options: { token?: unknown }): Promise<UserClaims | true> {
    if (!options?.token) return true; // guest
    const claims = await verifyToken(options.token);
    if (!claims) throw new Error("INVALID_TOKEN");
    // a token from before a staff "sign out everywhere" (P2-CON-02)
    if (signedOutSince(claims.sub, claims.iat)) throw new Error("SESSION_REVOKED");
    // a suspended account's access token stays valid up to 15 min: the account itself must still be active
    if ((await eligibilityOf(claims.sub, 0)).reason === "ACCOUNT_INACTIVE") throw new Error("ACCOUNT_INACTIVE");
    return claims;
  }

  /**
   * The account was suspended (social/accounts.ts): from now on the session can do nothing (no chat, no challenge,
   * no queue), it is told why, and the connection is closed. onLeave then tidies up as for any leave.
   */
  private closeSuspended(sid: string): void {
    const u = this.users.get(sid);
    if (u) quickMatch.leave(u.sub);
    this.users.delete(sid);
    this.players.delete(sid);
    const c = this.client(sid);
    c?.send("account-suspended", { reason: "ACCOUNT_INACTIVE" });
    c?.leave(4001);
  }

  // ---------------------------------------------------------------- helpers
  /** muted until (ms) for a signed-in session under a staff chat mute, else null */
  private mutedTill(sid: string, now = Date.now()): number | null {
    const uid = this.users.get(sid)?.sub;
    return uid ? mutedUntil(uid, now) : null;
  }

  private ident(sid: string): Ident {
    return { sid, uid: this.users.get(sid)?.sub };
  }
  /** Neither of the two blocked the other. */
  private sees(a: string, b: string): boolean {
    return !this.blocks.separated(this.ident(a), this.ident(b));
  }
  private client(sid: string): Client | undefined {
    return this.clients.find((c) => c.sessionId === sid);
  }
  /** Send to everyone who can see `from` (optionally excluding the sender, optionally only some). */
  private sendVisible(from: string, type: string, payload: unknown, opts: { self?: boolean; only?: (sid: string) => boolean } = {}): void {
    for (const c of this.clients) {
      if (c.sessionId === from ? !opts.self : !this.sees(from, c.sessionId)) continue;
      if (opts.only && c.sessionId !== from && !opts.only(c.sessionId)) continue;
      c.send(type, payload);
    }
  }
  private publicCard(sid: string) {
    const p = this.players.get(sid);
    return p ? { id: p.id, name: p.name, color: p.color, level: p.level, uid: p.uid } : null;
  }
  private broadcastSeats() {
    this.broadcast("seats", this.seats.snapshot());
    this.broadcast("seat-holds", this.seatHolds());
  }
  /** P2-NET-06: chairs held for players who lost their connection → ms left (table markers show "Held · 0:42") */
  private seatHolds(now = Date.now()): SeatHolds {
    const out: SeatHolds = {};
    for (const h of this.heldHere.values()) if (h.kind === "seat") out[h.place] = Math.max(0, h.until - now);
    return out;
  }

  /**
   * Apply a change to `sid`'s block list and update who sees whom: people who became separated get `left`
   * (both ways), people who became visible again get `joined` + their pose (both ways).
   */
  private reblock(sid: string, mutate: () => void): void {
    const before = new Map<string, boolean>();
    for (const other of this.players.keys()) if (other !== sid) before.set(other, this.sees(sid, other));
    mutate();
    for (const [other, was] of before) {
      const now = this.sees(sid, other);
      if (was === now) continue;
      const me = this.client(sid);
      const them = this.client(other);
      if (!now) {
        me?.send("left", { id: other });
        them?.send("left", { id: sid });
        this.endCallBetween(sid, other, "BLOCKED");
        this.pairs.forget(sid, other);
        this.dms.forget(sid, other);
        const ua = this.users.get(sid)?.sub;
        const ub = this.users.get(other)?.sub;
        if (ua && ub && mmConfig.enabled) matchService.blocked(ua, ub);
        for (const [id, p] of this.proposals)
          if ((p.from === sid && p.to === other) || (p.from === other && p.to === sid)) {
            this.proposals.delete(id);
            this.client(p.from)?.send("proposal-closed", { id, reason: "PLAYER_UNAVAILABLE" });
            this.client(p.to)?.send("proposal-closed", { id, reason: "PLAYER_UNAVAILABLE" });
          }
      } else {
        const a = this.players.get(sid);
        const b = this.players.get(other);
        if (a) them?.send("joined", a);
        if (b) me?.send("joined", b);
        this.interest.reset(sid, other);
        this.interest.reset(other, sid);
      }
    }
  }

  private endCallBetween(a: string, b: string, reason: string) {
    const c = this.calls.callOf(a);
    if (!c || (c.from !== b && c.to !== b)) return;
    this.calls.end(c.id, a);
    this.client(c.from)?.send("call-ended", { id: c.id, reason });
    this.client(c.to)?.send("call-ended", { id: c.id, reason });
  }

  override onCreate(options: { game?: unknown } = {}): void {
    this.hallGame = isHallId(options.game) ? options.game : null;
    this.seats = new SeatRegistry(this.hallGame ?? "plaza");

    // ---- movement: stored here, sent to each viewer in one batched message per tick (social/interest.ts)
    this.clock.setInterval(() => this.onTick(), TICK_MS);
    // ---- staff console live monitor: people here, reported every 15 s and shortly after joins / leaves
    this.clock.setInterval(() => this.reportPresence(), 15_000);

    // ---- Administrative Block (hall "admin"): closed offices, knock queue, office chairs + conversation (office-desk.ts)
    if (this.hallGame === "admin")
      this.desk = new OfficeDesk({
        roomId: this.roomId,
        client: (sid) => this.client(sid),
        player: (sid) => this.players.get(sid),
        uid: (sid) => this.users.get(sid)?.sub,
        broadcast: (type, payload) => this.broadcast(type, payload),
        later: (fn, ms) => void this.clock.setTimeout(fn, ms),
        every: (fn, ms) => void this.clock.setInterval(fn, ms),
        onMessage: (type, fn) => void this.onMessage(type, (client, raw: unknown) => fn(client, raw)),
        seats: this.seats,
        broadcastSeats: () => this.broadcastSeats(),
        rate: this.rate,
      });

    // ---- Tournament Arena (hall "arena"): entry gate, zones, bowl seats, removal on close / bar (rooms/arena-hall.ts)
    if (this.hallGame === "arena") {
      const arena = (this.arena = new ArenaHall({
        roomId: this.roomId,
        players: () => [...this.players.keys()],
        uidOf: (sid) => this.users.get(sid)?.sub,
        send: (sid, type, msg) => this.client(sid)?.send(type, msg),
        broadcast: (type, msg) => this.broadcast(type, msg),
        kick: (sid) => this.client(sid)?.leave(4003),
        later: (fn, ms) => void this.clock.setTimeout(fn, ms),
      }));
      this.onMessage(ArenaMsg.zone, (client, raw: unknown) => void arena.onZone(client.sessionId, raw));
      this.onMessage(ArenaMsg.sit, (client, raw: { seat?: unknown }) => void arena.onSit(client.sessionId, raw));
      this.onMessage(ArenaMsg.stand, (client) => arena.onStand(client.sessionId));
      this.onMessage(ArenaMsg.mic, (client, raw: { on?: unknown }) => arena.onMic(client.sessionId, raw));
      this.clock.setInterval(() => void arena.sync(), arenaConfig.statePollMs);
      this.clock.setInterval(() => arena.report(), arenaConfig.reportMs);
    }

    // ---- Boxing sub-hall (hall "boxing"): 32 rings, claim / join / quick / practice / watch (rooms/boxing-hall.ts)
    if (this.hallGame === "boxing") {
      this.maxClients = BOXING_HALL_CAPACITY;
      const boxing = (this.boxing = new BoxingHall(
        {
          roomId: this.roomId,
          uidOf: (sid) => this.users.get(sid)?.sub,
          nameOf: (sid) => this.players.get(sid)?.name ?? "Player",
          levelOf: (sid) => this.players.get(sid)?.level,
          posOf: (sid) => {
            const p = this.players.get(sid);
            return p && { x: p.x / 100, z: p.z / 100 };
          },
          has: (sid) => this.players.has(sid),
          send: (sid, type, msg) => this.client(sid)?.send(type, msg),
          broadcast: (type, msg) => this.broadcast(type, msg),
          later: (fn, ms) => void this.clock.setTimeout(fn, ms),
        },
        {
          eligibility: (uid, stake) => eligibilityOf(uid, stake, BOXING_GAME_ID),
          start: startBoxing,
          leaveFight: (roomId, uid) => boxingRoomOf(roomId)?.leaveFrom(uid),
          rating: (uid) => api.fightRating(uid),
        },
      ));
      this.onMessage(BoxingHallMsg.claim, (client, raw: unknown) => void boxing.onClaim(client.sessionId, raw));
      this.onMessage(BoxingHallMsg.join, (client, raw: unknown) => void boxing.onJoin(client.sessionId, raw));
      this.onMessage(BoxingHallMsg.leave, (client) => boxing.onLeave(client.sessionId));
      this.onMessage(BoxingHallMsg.quick, (client, raw: unknown) => void boxing.onQuick(client.sessionId, raw));
      this.onMessage(BoxingHallMsg.quickCancel, (client) => boxing.onQuickCancel(client.sessionId));
      this.onMessage(BoxingHallMsg.practice, (client, raw: unknown) => boxing.onPractice(client.sessionId, raw));
      this.onMessage(BoxingHallMsg.watch, (client, raw: unknown) => boxing.onWatch(client.sessionId, raw));
      this.onMessage(BoxingHallMsg.practiceScore, (client, raw: { round?: unknown; score?: unknown }) => boxing.onPracticeScore(client.sessionId, raw));
      this.onMessage(BoxingHallMsg.pong, (client, raw: { n?: unknown }) => boxing.onPong(client.sessionId, raw));
      this.onMessage(BoxingHallMsg.sync, (client) => boxing.onSync(client.sessionId));
      this.clock.setInterval(() => boxing.probe(this.players.keys()), boxingHallConfig.pingEveryMs);
    }

    // ---- seats (hall chairs + plaza bench places): one person per seat, one seat per person
    this.onMessage("sit", (client, raw: { seat?: unknown }) => {
      if (this.desk) return void this.desk.sit(client, raw?.seat); // admin chairs: who is inside / role checks
      const uid = this.users.get(client.sessionId)?.sub;
      // (a chair reserved for this account by the matchmaker is theirs, P2-MM-05)
      const r = this.seats.claim(raw?.seat, client.sessionId, uid);
      if (r === "taken") return client.send("seat-taken", { seat: raw.seat });
      if (r === "ok") {
        this.broadcastSeats();
        if (uid && mmConfig.enabled) void matchService.seated(uid, this.roomId, raw.seat as string);
      }
    });

    // ---- matchmaking v2 (P2-MM-05): find an opponent / challenges / venues, process-wide (matchmaker-v2.ts)
    if (mmConfig.enabled) this.mountMatchmaking();
    this.onMessage("stand", (client) => {
      if (this.seats.release(client.sessionId)) this.broadcastSeats();
    });

    this.onMessage("move", (client, raw: unknown) => {
      const parsed = WorldMoveSchema.safeParse(raw);
      const p = this.players.get(client.sessionId);
      if (!parsed.success || !p) return;
      const m = parsed.data;
      const want = { x: Math.max(-WORLD_EDGE_CM, Math.min(WORLD_EDGE_CM, m.x)), z: Math.max(-WORLD_EDGE_CM, Math.min(WORLD_EDGE_CM, m.z)) };
      const at = this.moveGuard.apply(p.id, p, want);
      p.x = at.x;
      p.z = at.z;
      p.yaw = m.yaw;
      // only known action codes; contact codes (handshake, fist bump, hug) only while consented and paired
      p.anim = isKnownAnim(m.anim) ? this.pairs.allowAnim(p.id, m.anim, Date.now()) : 0;
      this.seqs.set(p.id, (this.seqs.get(p.id) ?? 0) + 1);
      // walking away from a plaza bench frees the place (hall chairs are freed by the client's "stand")
      const seat = this.seats.seatOf(p.id);
      const pose = seat ? plazaSeat(seat) : undefined;
      if (pose && Math.hypot(pose.x - p.x / 100, pose.z - p.z / 100) > SEAT_LEAVE_M && this.seats.release(p.id)) this.broadcastSeats();
    });

    // ---- emotes: visible to everyone who can see you, short cooldown; optional target ("waves at you")
    this.onMessage("emote", (client, raw: unknown) => {
      const parsed = EmoteSendSchema.safeParse(raw);
      if (!parsed.success) return;
      const now = Date.now();
      if (now - (this.lastEmote.get(client.sessionId) ?? 0) < EMOTE_COOLDOWN_MS) return;
      this.lastEmote.set(client.sessionId, now);
      const { emote, to } = parsed.data;
      this.sendVisible(client.sessionId, "emote", { id: client.sessionId, emote });
      if (to && to !== client.sessionId && this.players.has(to) && this.sees(client.sessionId, to))
        this.client(to)?.send("waved", { from: this.publicCard(client.sessionId), emote });
    });

    // ---- two-person contact actions (handshake, fist bump, hug): ask → the other person accepts → both are placed
    this.onMessage("pair-request", (client, raw: unknown) => {
      const parsed = PairRequestSchema.safeParse(raw);
      const me = this.players.get(client.sessionId);
      if (!parsed.success || !me) return;
      const { to, kind } = parsed.data;
      const fail = (reason: string) => client.send("pair-closed", { id: null, to, reason });
      const them = this.players.get(to);
      if (!them || !this.sees(me.id, to)) return fail("UNAVAILABLE");
      // contact needs signed-in people on both sides (guests can still wave, nod, clap …)
      if (!me.verified || !them.verified) return fail("LOGIN_REQUIRED");
      if (this.seats.seatOf(me.id) || this.seats.seatOf(to)) return fail("SEATED");
      if (!this.rate.allow(`${me.id}:pair`, 6, 60_000, Date.now())) return fail("RATE_LIMITED");
      const r = this.pairs.request(me.id, to, kind, Math.hypot(me.x - them.x, me.z - them.z) / 100, Date.now());
      if (typeof r === "string") return fail(r);
      client.send("pair-pending", { id: r.id, to, kind });
      this.client(to)?.send("pair-invite", { id: r.id, kind, from: this.publicCard(me.id) });
    });
    this.onMessage("pair-respond", (client, raw: unknown) => {
      const parsed = PairRespondSchema.safeParse(raw);
      if (!parsed.success) return;
      const pos = (sid: string) => {
        const p = this.players.get(sid);
        return p && { x: p.x / 100, z: p.z / 100 };
      };
      const r = this.pairs.respond(parsed.data.id, client.sessionId, parsed.data.accept, pos, Date.now());
      if (!r) return;
      const { invite } = r;
      if ("result" in r) {
        this.client(invite.from)?.send("pair-closed", { id: invite.id, to: invite.to, reason: r.result });
        if (r.result !== "DECLINED") client.send("pair-closed", { id: invite.id, to: invite.from, reason: r.result });
        return;
      }
      const msg = {
        id: invite.id,
        kind: invite.kind,
        a: { id: invite.from, ...r.place.a },
        b: { id: invite.to, ...r.place.b },
        alignMs: r.alignMs,
        ms: PAIR_MS[invite.kind],
      };
      this.client(invite.from)?.send("pair-start", msg);
      client.send("pair-start", msg);
    });

    // ---- text chat: nearby (≈12 m, speech bubbles) or the whole room; filtered (FR-COM-09)
    this.onMessage("chat", (client, raw: unknown) => {
      const p = this.players.get(client.sessionId);
      const parsed = ChatSendSchema.safeParse(raw);
      if (!p || !parsed.success) return;
      const now = Date.now();
      if (now - (this.lastChat.get(client.sessionId) ?? 0) < CHAT_MIN_INTERVAL_MS) return;
      if (!this.rate.allow(`${client.sessionId}:chat`, 20, 30_000, now)) return client.send("chat-warning", { reason: "rate" });
      // a staff chat mute (P2-CON-02): nothing reaches anyone until it ends
      const muted = this.mutedTill(client.sessionId, now);
      if (muted) return client.send("chat-warning", { reason: "muted", until: muted });
      this.lastChat.set(client.sessionId, now);
      const r = filterChat(parsed.data.text);
      if (r.blocked) return client.send("chat-warning", { reason: r.reason });
      if (!r.text) return;
      const scope = parsed.data.scope;
      const msg = { id: p.id, name: p.name, color: p.color, text: r.text, t: now, masked: !!r.reason, scope };
      const range = NEARBY_CHAT_RANGE * 100;
      // Administrative Block: offices are private rooms (GAP-012), like the office voice scope below
      const desk = this.desk;
      const sameRoom = (sid: string) => !desk || desk.sameRoom(client.sessionId, sid);
      this.sendVisible(client.sessionId, "chat", msg, {
        self: true,
        only:
          scope === "nearby"
            ? (sid) => {
                const o = this.players.get(sid);
                return !!o && Math.hypot(o.x - p.x, o.z - p.z) <= range && sameRoom(sid);
              }
            : desk
              ? sameRoom
              : undefined,
      });
    });

    // ---- 1:1 private messages (signed-in only; first message = chat request)
    this.onMessage("dm", (client, raw: unknown) => {
      const me = this.players.get(client.sessionId);
      const parsed = DmSendSchema.safeParse(raw);
      if (!me || !parsed.success) return;
      const to = parsed.data.to;
      const fail = (reason: string) => client.send("dm-failed", { to, reason });
      if (!this.users.has(client.sessionId)) return fail("LOGIN_REQUIRED");
      const target = this.players.get(to);
      if (!target || to === me.id || !target.verified || !this.sees(me.id, to)) return fail("UNAVAILABLE");
      const now = Date.now();
      if (!this.rate.allow(`${me.id}:dm`, 12, 10_000, now)) return fail("RATE_LIMITED");
      if (this.mutedTill(client.sessionId, now)) return fail("MUTED");
      const r = filterChat(parsed.data.text);
      if (r.blocked) return client.send("chat-warning", { reason: r.reason });
      if (!r.text) return;
      if (!this.dms.isOpen(me.id, to) && !this.rate.allow(`${me.id}:dmreq`, 5, 60_000, now)) return fail("RATE_LIMITED");
      const route = this.dms.route(me.id, to);
      if (route === "wait") return fail("WAITING");
      const msg = { mid: `m${++this.msgSeq}`, from: me.id, name: me.name, color: me.color, to, text: r.text, t: now, masked: !!r.reason, request: route === "request" };
      this.client(to)?.send("dm", msg);
      client.send("dm", msg);
    });
    this.onMessage("dm-accept", (client, raw: unknown) => {
      const parsed = TargetSchema.safeParse(raw);
      if (!parsed.success || !this.sees(client.sessionId, parsed.data.to)) return;
      if (this.dms.accept(client.sessionId, parsed.data.to)) this.client(parsed.data.to)?.send("dm-accepted", { by: client.sessionId });
    });

    // ---- blocks: invisible + silent to each other; no chat, DM, call, voice or proposal (SAFE-04)
    this.onMessage("blocks", (client, raw: unknown) => {
      const parsed = BlockListSchema.safeParse(raw);
      if (parsed.success) this.reblock(client.sessionId, () => this.blocks.set(client.sessionId, parsed.data.keys));
    });
    this.onMessage("block", (client, raw: unknown) => {
      const parsed = TargetSchema.safeParse(raw);
      const target = parsed.success ? this.players.get(parsed.data.to) : undefined;
      if (!target || target.id === client.sessionId) return;
      const key = blockKeyFor(this.ident(target.id));
      this.reblock(client.sessionId, () => this.blocks.add(client.sessionId, key));
      client.send("blocked", { id: target.id, key, name: target.name, uid: target.uid });
    });
    this.onMessage("unblock", (client, raw: unknown) => {
      const parsed = UnblockSchema.safeParse(raw);
      if (parsed.success) this.reblock(client.sessionId, () => this.blocks.remove(client.sessionId, parsed.data.key));
    });

    // ---- proximity voice (SRS FR-COM-01/02): WebRTC signalling relay, signed-in players only, never across a block
    this.onMessage("voice-signal", (client, raw: { to?: unknown; data?: unknown }) => {
      if (!this.users.has(client.sessionId) || typeof raw?.to !== "string") return;
      const target = this.client(raw.to);
      if (!target || !this.users.has(target.sessionId) || !this.sees(client.sessionId, target.sessionId)) return;
      // Administrative Block: office conversations are private (same office only), except a private call
      const call = this.calls.callOf(client.sessionId);
      if (this.desk && !this.desk.sameRoom(client.sessionId, target.sessionId) && !(call && (call.from === target.sessionId || call.to === target.sessionId))) return;
      const data = JSON.stringify(raw.data ?? null);
      if (data.length > 16_000) return; // SDP/ICE only
      if (!this.rate.allow(`${client.sessionId}:sig`, 200, 10_000, Date.now())) return; // flood guard
      target.send("voice-signal", { from: client.sessionId, data: raw.data });
    });
    this.onMessage("voice-state", (client, raw: { on?: unknown; talking?: unknown }) => {
      if (!this.users.has(client.sessionId)) return;
      this.sendVisible(client.sessionId, "voice-state", { id: client.sessionId, on: raw?.on === true, talking: raw?.talking === true });
    });

    // ---- private 1:1 voice call: request → accept → both hear each other anywhere in the room
    this.onMessage("call-request", (client, raw: unknown) => {
      const parsed = TargetSchema.safeParse(raw);
      if (!parsed.success) return;
      const to = parsed.data.to;
      const fail = (reason: string) => client.send("call-failed", { to, reason });
      if (!this.users.has(client.sessionId)) return fail("LOGIN_REQUIRED");
      if (!this.users.has(to) || !this.sees(client.sessionId, to)) return fail("UNAVAILABLE");
      if (!this.rate.allow(`${client.sessionId}:call`, 4, 60_000, Date.now())) return fail("RATE_LIMITED");
      const c = this.calls.request(client.sessionId, to, Date.now());
      if (typeof c === "string") return fail(c);
      this.client(to)?.send("call-incoming", { id: c.id, from: this.publicCard(client.sessionId) });
      client.send("call-ringing", { id: c.id, to: this.publicCard(to) });
    });
    this.onMessage("call-respond", (client, raw: unknown) => {
      const parsed = CallRespondSchema.safeParse(raw);
      if (!parsed.success) return;
      const c = this.calls.respond(parsed.data.id, client.sessionId, parsed.data.accept, Date.now());
      if (!c) return;
      if (!parsed.data.accept) return this.client(c.from)?.send("call-ended", { id: c.id, reason: "DECLINED" });
      this.client(c.from)?.send("call-start", { id: c.id, peer: this.publicCard(c.to) });
      client.send("call-start", { id: c.id, peer: this.publicCard(c.from) });
    });
    this.onMessage("call-end", (client, raw: unknown) => {
      const parsed = CallEndSchema.safeParse(raw ?? {});
      const c = parsed.success && parsed.data.id ? this.calls.end(parsed.data.id, client.sessionId) : this.calls.endFor(client.sessionId);
      if (!c) return;
      this.client(c.from)?.send("call-ended", { id: c.id, reason: "ENDED" });
      this.client(c.to)?.send("call-ended", { id: c.id, reason: "ENDED" });
    });

    // ---- proposals (walk up → challenge → accept → table)
    this.onMessage("propose", async (client, raw: { to?: unknown; game?: unknown; stake?: unknown }) => {
      const me = this.users.get(client.sessionId);
      const target = typeof raw?.to === "string" ? this.client(raw.to) : undefined;
      if (!me) return client.send("proposal-failed", { reason: "LOGIN_REQUIRED" });
      const them = target && this.users.get(target.sessionId);
      if (!target || !them || target.sessionId === client.sessionId || !this.sees(client.sessionId, target.sessionId))
        return client.send("proposal-failed", { reason: "PLAYER_UNAVAILABLE" });
      const boxingHere = !!this.boxing && raw.game === BOXING_GAME_ID;
      if ((!isGame(raw.game) && !boxingHere) || !isStake(raw.stake)) return client.send("proposal-failed", { reason: "INVALID_PROPOSAL" });
      const game = raw.game as GameId | typeof BOXING_GAME_ID;
      // checked when the challenge is made, not only after the other player accepts (GAP-011); the API checks again
      // when the match is created. The challenger hears their own reason, never the other player's (GAP-005).
      const [mine, theirs] = await Promise.all([eligibilityOf(me.sub, raw.stake, game), eligibilityOf(them.sub, raw.stake, game)]);
      if (isRefusal(mine)) return client.send("proposal-failed", { reason: mine.reason, game, ...(mine.limit !== undefined ? { limit: mine.limit } : {}) });
      if (isRefusal(theirs)) return client.send("proposal-failed", { reason: OPPONENT_CANT_PLAY });
      // either of them may have left (or been suspended) meanwhile
      if (!this.users.has(client.sessionId) || !this.users.has(target.sessionId) || !this.client(target.sessionId) || !this.sees(client.sessionId, target.sessionId))
        return client.send("proposal-failed", { reason: "PLAYER_UNAVAILABLE" });
      const open = [...this.proposals.values()].filter((p) => p.from === client.sessionId);
      if (open.length >= 3) return client.send("proposal-failed", { reason: "TOO_MANY_OPEN" });
      const id = `p${++this.seq}`;
      const proposal: Proposal = { id, from: client.sessionId, to: target.sessionId, game, stake: raw.stake, expires: Date.now() + PROPOSAL_TTL };
      this.proposals.set(id, proposal);
      const from = this.players.get(client.sessionId)!;
      // ttlMs lets clients count down on their own clock (device clocks drift from the server's)
      target.send("proposal", { id, from: { id: from.id, name: from.name, level: from.level, color: from.color }, game: proposal.game, stake: proposal.stake, expires: proposal.expires, ttlMs: PROPOSAL_TTL });
      client.send("proposal-sent", { id, to: this.players.get(target.sessionId)?.name, game: proposal.game, stake: proposal.stake, expires: proposal.expires, ttlMs: PROPOSAL_TTL });
      this.clock.setTimeout(() => {
        const p = this.proposals.get(id);
        if (p && this.proposals.delete(id)) {
          // look the sessions up now (not the client objects captured at send time)
          this.client(p.from)?.send("proposal-closed", { id, reason: "EXPIRED" });
          this.client(p.to)?.send("proposal-closed", { id, reason: "EXPIRED" });
        }
      }, PROPOSAL_TTL);
    });

    this.onMessage("proposal-respond", async (client, raw: { id?: unknown; accept?: unknown }) => {
      const p = typeof raw?.id === "string" ? this.proposals.get(raw.id) : undefined;
      if (!p || p.to !== client.sessionId) return;
      this.proposals.delete(p.id);
      const fromClient = this.client(p.from);
      if (!raw.accept) {
        fromClient?.send("proposal-closed", { id: p.id, reason: "DECLINED" });
        return;
      }
      const a = this.users.get(p.from);
      const b = this.users.get(p.to);
      if (!fromClient || !a || !b) return client.send("proposal-closed", { id: p.id, reason: "PLAYER_LEFT" });
      try {
        // boxing: a free ring of this hall + the fight room (the hall sends boxing-assigned / boxing-fight-ready too)
        const m = p.game === BOXING_GAME_ID ? await this.boxing!.assignProposal(p.from, p.to, p.stake) : await startMatch(p.game, p.stake, [a.sub, b.sub]);
        for (const c of [fromClient, client]) c.send("match-ready", { ...m, game: p.game, stake: p.stake });
      } catch (e) {
        // both re-validated by the API at accept time; the precise reason only to the player it is about (GAP-005)
        fromClient.send("proposal-closed", { id: p.id, ...refusalFor(e, a.sub, p.game as GameId) });
        client.send("proposal-closed", { id: p.id, ...refusalFor(e, b.sub, p.game as GameId) });
      }
    });

    // ---- Quick Match ----
    this.onMessage("quickmatch-join", (client, raw: { game?: unknown; stake?: unknown }) => {
      if (!this.users.get(client.sessionId)) return client.send("quickmatch", { status: "error", reason: "LOGIN_REQUIRED" });
      if (!isGame(raw?.game) || !isStake(raw?.stake)) return client.send("quickmatch", { status: "error", reason: "INVALID" });
      void this.joinQuick(client, raw.game, raw.stake);
    });
    this.onMessage("quickmatch-leave", (client) => {
      const me = this.users.get(client.sessionId);
      if (me) quickMatch.leave(me.sub);
      client.send("quickmatch", { status: "idle" });
    });
  }

  /**
   * Quick Match: queue (or pair at once). `resumed` keeps the original waiting time when a held place comes back
   * (P2-NET-06: the ticket was paused while the player was away, so nothing could start without them).
   */
  private async joinQuick(client: Client, game: GameId, stake: number, resumed?: number): Promise<void> {
    {
      const me = this.users.get(client.sessionId);
      if (!me) return;
      // checked before queueing (GAP-011): a player who can't stake this never waits, nor gets paired with someone
      const mine = await eligibilityOf(me.sub, stake, game);
      if (isRefusal(mine)) return client.send("quickmatch", { status: "error", reason: mine.reason, game, ...(mine.limit !== undefined ? { limit: mine.limit } : {}) });
      if (!this.users.has(client.sessionId)) return; // left / suspended meanwhile
      const ticket = { userId: me.sub, since: resumed ?? Date.now(), notify: (e: string, p: unknown) => client.send(e, p) };
      const other = quickMatch.join(game, stake, ticket);
      if (!other) return client.send("quickmatch", { status: "waiting", game, stake, ...(resumed !== undefined ? { waitedMs: Date.now() - resumed } : {}) });
      try {
        const m = await startMatch(game, stake, [other.userId, me.sub]);
        const payload = { ...m, game, stake };
        other.notify("match-ready", payload);
        client.send("match-ready", payload);
      } catch (e) {
        const about = e instanceof ApiError ? e.userId : undefined;
        // the player it is about hears why; the other one goes back to the front of the queue, told nothing private
        if (about === me.sub && PERSONAL_REASONS.has((e as Error).message)) {
          client.send("quickmatch", { status: "error", ...refusalFor(e, me.sub, game) });
          if (!quickMatch.join(game, stake, other)) other.notify("quickmatch", { status: "waiting", game, stake });
        } else if (about === other.userId && PERSONAL_REASONS.has((e as Error).message)) {
          other.notify("quickmatch", { status: "error", ...refusalFor(e, other.userId, game) });
          if (!quickMatch.join(game, stake, ticket)) client.send("quickmatch", { status: "waiting", game, stake });
        } else {
          other.notify("quickmatch", { status: "error", ...refusalFor(e, other.userId, game) });
          client.send("quickmatch", { status: "error", ...refusalFor(e, me.sub, game) });
        }
      }
    }
  }

  // ---------------------------------------------------------------- P2-MM-05: matchmaking v2

  private mountMatchmaking(): void {
    const on = (type: string, max: number, fn: (uid: string, raw: unknown, client: Client) => unknown) =>
      this.onMessage(type, (client, raw: unknown) => {
        const uid = this.users.get(client.sessionId)?.sub;
        if (!uid) return client.send(type === MmMsg.invite ? "invite-closed" : "mm-status", { id: null, status: "error", reason: "LOGIN_REQUIRED" });
        if (!this.rate.allow(`${client.sessionId}:${type}`, max, 10_000, Date.now())) return;
        void fn(uid, raw, client);
      });
    on(MmMsg.find, 6, (uid, raw, c) => matchService.find(uid, raw, this.mmPort(c.sessionId, uid)));
    on(MmMsg.cancel, 10, (uid) => matchService.cancel(uid));
    on(MmMsg.widen, 6, (uid, raw) => matchService.widen(uid, raw));
    on(MmMsg.respond, 10, (uid, raw) => matchService.respond(uid, raw));
    on(MmMsg.invite, 8, (uid, raw) => matchService.invite(uid, raw));
    on(MmMsg.inviteRespond, 10, (uid, raw) => matchService.inviteRespond(uid, raw));
    on(MmMsg.inviteCancel, 10, (uid, raw) => matchService.inviteCancel(uid, raw));
    on(MmMsg.venues, 20, (uid, raw) => matchService.venues(uid, raw));
    on(MmMsg.online, 10, (uid) => matchService.online(uid));
    if (!this.hallGame || (!(TABLE_HALLS as readonly string[]).includes(this.hallGame) && this.hallGame !== "boxing")) return;
    this.mmHall = matchService.addHall(this.hallPort());
  }

  /** what the hub knows about one signed-in session of this room */
  private mmPort(sid: string, uid: string): SessionPort {
    return {
      sid,
      roomId: this.roomId,
      hall: this.hallGame,
      send: (type, msg) => this.client(sid)?.send(type, msg),
      blocks: () => this.blocks.keys(sid),
      person: () => {
        const p = this.players.get(sid);
        return { uid, name: p?.name ?? "Player", ...(p ? { level: p.level, color: p.color } : {}) };
      },
    };
  }

  private sidOf(uid: string): string | undefined {
    for (const [sid, u] of this.users) if (u.sub === uid && this.players.has(sid)) return sid;
    return undefined;
  }

  /** this hall as the matchmaker sees it: table / ring statuses, reservations, the Boxing ring assignment */
  private hallPort(): HallPort {
    const game = this.hallGame as HallPort["game"];
    const port: HallPort = {
      roomId: this.roomId,
      game,
      places: () => (this.boxing ? this.boxing.statuses() : this.tablePlaces()),
      keepAlive: (on) => {
        this.mmKeep = on;
        this.holdsChanged();
      },
    };
    if (this.boxing) {
      const boxing = this.boxing;
      port.assignBoxing = async (a, b, stake) => {
        const sa = this.sidOf(a);
        const sb = this.sidOf(b);
        if (!sa || !sb) throw new Error("PLAYER_LEFT");
        return boxing.assignProposal(sa, sb, stake);
      };
    } else {
      port.reserve = (uids, want) => this.reserveTable(uids, want);
      port.release = (uids) => {
        let changed = false;
        for (const u of uids) changed = this.seats.releaseReserved(u) || changed;
        if (changed) this.broadcastSeats();
      };
    }
    return port;
  }

  private tableIds(): string[] {
    const n = this.hallGame ? HALL_SEATING[this.hallGame].tables : 0;
    return Array.from({ length: n }, (_, i) => `t${i}`);
  }
  private chairsOf(table: string): string[] {
    const n = this.hallGame ? HALL_SEATING[this.hallGame].chairs : 0;
    return Array.from({ length: n }, (_, i) => `${table}s${i}`);
  }
  private tablePlaces(): Record<string, VenueStatus> {
    const out: Record<string, VenueStatus> = {};
    for (const t of this.tableIds()) {
      const holders = this.chairsOf(t).map((s) => this.seats.holderOf(s));
      const taken = holders.filter(Boolean) as string[];
      if (!taken.length) continue;
      out[t] = taken.some((h) => reservedFor(h)) ? "reserved" : taken.every((h) => h.startsWith("~held")) ? "held" : taken.length === holders.length ? "playing" : "waiting";
    }
    return out;
  }

  /**
   * Keep a table for two matched accounts: `want` when it can take them, else the table one of them already sits at
   * (its other chairs free), else the first empty table. A chair a player already sits on stays theirs.
   */
  private reserveTable(uids: string[], want?: string): Reservation | null {
    const sidToUid = (h: string | undefined) => (h ? (this.users.get(h)?.sub ?? reservedFor(h) ?? undefined) : undefined);
    const usable = (t: string) => this.chairsOf(t).every((s) => {
      const h = this.seats.holderOf(s);
      return !h || uids.includes(sidToUid(h) ?? "");
    });
    const mine = (t: string) => this.chairsOf(t).some((s) => uids.includes(sidToUid(this.seats.holderOf(s)) ?? ""));
    const tables = this.tableIds();
    const order = [...(want && tables.includes(want) ? [want] : []), ...tables.filter(mine), ...tables.filter((t) => !this.chairsOf(t).some((s) => this.seats.holderOf(s)))];
    const table = order.find(usable);
    if (!table) return null;
    const seats: Record<string, string> = {};
    const seated: string[] = [];
    const chairs = this.chairsOf(table);
    for (const u of uids) {
      const own = chairs.find((s) => this.users.get(this.seats.holderOf(s) ?? "")?.sub === u);
      if (own) {
        seats[u] = own;
        seated.push(u);
      }
    }
    for (const u of uids) {
      if (seats[u]) continue;
      const free = chairs.find((s) => !this.seats.holderOf(s) && !Object.values(seats).includes(s)) ?? chairs.find((s) => reservedFor(this.seats.holderOf(s)) === u);
      if (!free || !this.seats.reserve(free, u)) {
        for (const x of uids) this.seats.releaseReserved(x);
        return null;
      }
      seats[u] = free;
    }
    this.broadcastSeats();
    return { table, seats, seated };
  }

  private onTick(): void {
    this.tick++;
    const now = Date.now();
    for (const c of this.calls.expire(now, CALL_RING_MS)) {
      this.client(c.from)?.send("call-ended", { id: c.id, reason: "NO_ANSWER" });
      this.client(c.to)?.send("call-ended", { id: c.id, reason: "NO_ANSWER" });
    }
    for (const inv of this.pairs.sweep(now)) {
      this.client(inv.from)?.send("pair-closed", { id: inv.id, to: inv.to, reason: "EXPIRED" });
      this.client(inv.to)?.send("pair-closed", { id: inv.id, to: inv.from, reason: "EXPIRED" });
    }
    if (this.players.size < 2) return;
    const movers: Mover[] = [];
    for (const p of this.players.values()) movers.push({ id: p.id, x: p.x, z: p.z, yaw: p.yaw, anim: p.anim, seq: this.seqs.get(p.id) ?? 0 });
    const byId = new Map(movers.map((m) => [m.id, m]));
    for (const c of this.clients) {
      const viewer = byId.get(c.sessionId);
      if (!viewer) continue;
      // Boxing hall: area of interest (BOXING_AOI_RADIUS) and no world moves from fighters in a running fight
      const boxing = this.boxing;
      const entries = this.interest.collect(viewer, movers, this.tick, (m) => this.sees(c.sessionId, m.id) && (!boxing || boxing.sendsMove(viewer, m)));
      if (entries.length) c.send("moves", entries);
    }
  }

  override async onJoin(
    client: Client,
    options: { name?: unknown; color?: unknown; level?: unknown; look?: unknown; bodyType?: unknown; blocks?: unknown } = {},
    auth?: UserClaims | true,
  ): Promise<void> {
    const claims = auth && auth !== true ? auth : null;
    if (this.arena) {
      // arena entry gate before anyone sees the joiner: closed / barred / full → refused, the client walks back
      const denial = await this.arena.gate(client.sessionId, claims?.sub, this.players.size);
      if (denial) return this.arena.refuse(client.sessionId, denial);
    }
    if (claims) {
      this.users.set(client.sessionId, claims);
      this.tracked.set(
        client.sessionId,
        trackAccount(claims.sub, () => this.closeSuspended(client.sessionId), (type, msg) => this.client(client.sessionId)?.send(type, msg)),
      );
    }
    const look = claims?.look ?? options.look;
    // the joiner's own block list (from the API) applies before anyone becomes visible
    const blocks = BlockListSchema.safeParse({ keys: options.blocks ?? [] });
    if (blocks.success && blocks.data.keys.length) this.blocks.set(client.sessionId, blocks.data.keys);
    const n = this.players.size;
    const player: WorldPlayer = {
      id: client.sessionId,
      name: sanitizeName(claims?.name || options.name),
      color: claims?.color ?? (typeof options.color === "string" && COLOR.test(options.color) ? options.color : "#3DA9FC"),
      level: claims?.lvl ?? Math.max(1, Math.min(100, Number(options.level) || 1)),
      // spread arrivals on a small grid so nobody spawns inside someone else (clients then send their own spawn)
      x: Math.round((n % 5) * 120 - 240),
      z: (this.hallGame ? 650 : 1600) + Math.floor(n / 5) % 4 * 90, // halls: just inside the entrance door
      yaw: 0,
      anim: 0,
      look: typeof look === "string" && LOOK.test(look) ? look : undefined,
      bodyType: ["feminine", "masculine", "neutral"].includes(String(claims?.bt ?? options.bodyType)) ? String(claims?.bt ?? options.bodyType) : undefined,
      verified: !!claims,
      uid: claims?.sub,
    };
    this.players.set(client.sessionId, player);
    this.seqs.set(client.sessionId, 0);
    // P2-NET-06: back inside the hold → the same chair, before anyone gets the seat map
    const back = claims ? this.reclaim(client, claims.sub) : null;
    const visible = [...this.players.values()].filter((p) => p.id === player.id || this.sees(player.id, p.id));
    client.send("snapshot", { you: player.id, players: visible });
    if (back?.kind === "seat") this.broadcastSeats();
    else {
      client.send("seats", this.seats.snapshot());
      client.send("seat-holds", this.seatHolds());
    }
    this.desk?.onJoin(client);
    this.sendVisible(client.sessionId, "joined", player);
    if (this.arena) await this.arena.joined(client.sessionId);
    this.boxing?.joined(client.sessionId, back?.kind === "ring" ? back : undefined);
    if (claims) this.tellPlace(client, claims.sub, back);
    // P2-MM-05: reachable by the matchmaker wherever this account is (its search / challenges / meeting follow it)
    if (claims && mmConfig.enabled) this.mmSessions.set(client.sessionId, matchService.register(claims.sub, this.mmPort(client.sessionId, claims.sub)));
    if (back?.kind === "seat" && back.state === "waiting" && isGame(back.game) && back.stake !== undefined) void this.joinQuick(client, back.game, back.stake, back.since);
    this.presenceSoon();
  }

  // ---------------------------------------------------------------- P2-NET-06: holding your place

  /** may this hall hold a place (a game-table chair or a Boxing ring)? */
  private holdable(): boolean {
    return placeHoldConfig.enabled && (this.hallGame === "boxing" || (HOLD_SEAT_HALLS as readonly string[]).includes(this.hallGame ?? ""));
  }

  /** the player is back: take their hold (this room only) and give the chair back (a ring is the Boxing hall's) */
  private reclaim(client: Client, uid: string): Hold | null {
    const h = placeHolds.take(uid, this.roomId);
    if (!h || this.heldHere.get(uid) !== h) return null;
    log.info({ event: "place.restored", userId: uid, hall: h.hall, place: h.place, awayMs: Date.now() - h.at }, "held place given back")
    this.heldHere.delete(uid);
    if (h.kind === "seat") this.seats.restore(uid, client.sessionId);
    this.holdsChanged();
    return h;
  }

  /** the joining player hears what became of their place: back on it, released while away, or nothing */
  private tellPlace(client: Client, uid: string, back: Hold | null): void {
    let msg: PlaceMsg;
    if (back) msg = { status: "restored", ...info(back) };
    else {
      const r = placeHolds.takeReleased(uid);
      msg = r ? { status: "released", ...r } : { status: "none" };
    }
    client.send("place", msg);
  }

  /** the Boxing hall wants to keep a ring for `uid`: within the abuse limit → the hold, else null (freed at once) */
  private keepRing(uid: string, k: RingKeep): Hold | null {
    if (!placeHolds.allow(uid)) {
      placeHolds.noteReleased(uid, { hall: "boxing", kind: "ring", place: k.place, reason: "LIMIT", heldS: 0 });
      log.info({ event: "place.limit", userId: uid, hall: "boxing", place: k.place }, "hold refused: abuse limit");
      return null;
    }
    return this.holdPlace({ uid, kind: "ring", ...k });
  }

  /** keep a place for `uid` (left without a deliberate leave) for its hold time; the timer releases it */
  private holdPlace(h: Omit<Hold, "at" | "until" | "roomId" | "hall">): Hold | null {
    if (!this.hallGame) return null;
    const now = Date.now();
    const ms = holdMsFor(h.kind, h.state);
    const hold: Hold = { ...h, hall: this.hallGame, roomId: this.roomId, at: now, until: now + ms };
    placeHolds.put(hold);
    log.info({ event: "place.held", userId: h.uid, hall: this.hallGame, place: h.place, state: h.state, ms }, "place held for a dropped player")
    this.heldHere.set(h.uid, hold);
    this.clock.setTimeout(() => this.expireHold(hold), ms);
    this.holdsChanged();
    return hold;
  }

  /** the hold ran out: the place is free again, the returning player will hear why */
  private expireHold(h: Hold): void {
    if (this.heldHere.get(h.uid) !== h) return;
    this.heldHere.delete(h.uid);
    placeHolds.drop(h.uid, h);
    placeHolds.noteReleased(h.uid, { hall: h.hall, kind: h.kind, place: h.place, reason: "EXPIRED", heldS: Math.round((h.until - h.at) / 1000) });
    log.info({ event: "place.released", userId: h.uid, hall: h.hall, place: h.place, reason: "EXPIRED" }, "held place released")
    if (h.kind === "seat" && this.seats.releaseHeld(h.uid)) this.broadcastSeats();
    if (h.kind === "ring") this.boxing?.holdEnded(h.uid);
    this.holdsChanged();
  }

  /** the room stays alive while it keeps a place, and closes when the last hold ends with nobody inside */
  private holdsChanged(): void {
    this.autoDispose = this.heldHere.size === 0 && !this.mmKeep;
  }

  private presenceTimer: { clear(): void } | null = null;
  /** debounced presence report (a burst of joins sends one report) */
  private presenceSoon(): void {
    if (this.presenceTimer) return;
    this.presenceTimer = this.clock.setTimeout(() => {
      this.presenceTimer = null;
      this.reportPresence();
    }, 2000);
  }
  private reportPresence(): void {
    const all = [...this.players.values()];
    void api.reportPresence(this.roomId, this.hallGame ? `hall:${this.hallGame}` : "plaza", all.length, all.filter((p) => p.verified).length);
  }

  override onLeave(client: Client, consented?: boolean): void {
    const sid = client.sessionId;
    this.tracked.get(sid)?.();
    this.tracked.delete(sid);
    // (a hall change is a leave + a join: the matchmaker waits a short grace before it treats the account as gone)
    this.mmSessions.get(sid)?.();
    this.mmSessions.delete(sid);
    const me = this.users.get(sid);
    // P2-NET-06: a chair at a game table is kept for its player when the connection ended without a deliberate leave
    // (the Quick Match ticket is paused, not lost: nothing can start while they are away)
    const ticket = me ? quickMatch.ticketOf(me.sub) : null;
    const seat = this.seats.seatOf(sid);
    let held = false;
    if (me && seat && !consented && this.holdable() && this.hallGame !== "boxing") {
      if (placeHolds.allow(me.sub))
        held = !!this.holdPlace({
          uid: me.sub,
          kind: "seat",
          place: seat,
          state: ticket ? "waiting" : "seated",
          since: ticket?.since ?? Date.now(),
          ...(ticket ? { game: ticket.game, stake: ticket.stake } : {}),
        });
      else {
        placeHolds.noteReleased(me.sub, { hall: this.hallGame!, kind: "seat", place: seat, reason: "LIMIT", heldS: 0 });
        log.info({ event: "place.limit", userId: me.sub, hall: this.hallGame, place: seat }, "hold refused: abuse limit");
      }
      if (held) this.seats.hold(sid, me.sub);
    }
    if (me) quickMatch.leave(me.sub);
    // a challenge to or from the leaver closes for both sides (the other one is told)
    for (const [id, p] of this.proposals)
      if (p.from === sid || p.to === sid) {
        this.proposals.delete(id);
        this.client(p.from === sid ? p.to : p.from)?.send("proposal-closed", { id, reason: "PLAYER_LEFT" });
      }
    const call = this.calls.endFor(sid);
    if (call) this.client(call.from === sid ? call.to : call.from)?.send("call-ended", { id: call.id, reason: "LEFT" });
    this.sendVisible(sid, "left", { id: sid });
    this.players.delete(sid);
    this.seqs.delete(sid);
    this.users.delete(sid);
    this.lastChat.delete(sid);
    this.lastEmote.delete(sid);
    this.rate.forget(`${sid}:`);
    this.blocks.forget(sid);
    this.dms.forget(sid);
    this.interest.forget(sid);
    this.moveGuard.forget(sid);
    for (const inv of this.pairs.forget(sid)) this.client(inv.from === sid ? inv.to : inv.from)?.send("pair-closed", { id: inv.id, to: sid, reason: "LEFT" });
    if (held) this.broadcastSeats();
    else if (this.seats.release(sid)) this.broadcastSeats();
    this.desk?.onLeave(sid);
    this.arena?.left(sid);
    // a Boxing ring (waiting / practice) is kept the same way: the hall asks, the hold decides (abuse limit)
    const uid = me?.sub;
    this.boxing?.left(sid, uid && !consented && this.holdable() ? (k) => this.keepRing(uid, k) : undefined);
    // a reload often brings the new connection in BEFORE the old one's close arrives: the place goes straight to it
    const again = uid && this.heldHere.has(uid) ? this.clients.find((c) => c.sessionId !== sid && this.users.get(c.sessionId)?.sub === uid) : undefined;
    if (again && uid) this.giveBack(again, uid);
    this.presenceSoon();
  }

  /** the account is (already) here on another connection: its held place goes to that one, same state */
  private giveBack(client: Client, uid: string): void {
    const back = this.reclaim(client, uid);
    if (!back) return;
    if (back.kind === "seat") this.broadcastSeats();
    else this.boxing?.joined(client.sessionId, back);
    this.tellPlace(client, uid, back);
    if (back.kind === "seat" && back.state === "waiting" && isGame(back.game) && back.stake !== undefined) void this.joinQuick(client, back.game, back.stake, back.since);
  }

  override onDispose(): void {
    this.mmHall?.();
    for (const off of this.mmSessions.values()) off();
    this.mmSessions.clear();
    for (const h of this.heldHere.values()) placeHolds.drop(h.uid, h);
    this.heldHere.clear();
    void api.reportPresence(this.roomId, this.hallGame ? `hall:${this.hallGame}` : "plaza", 0, 0);
    this.desk?.dispose();
    if (this.arena) this.arena.report();
    this.boxing?.dispose();
  }
}
