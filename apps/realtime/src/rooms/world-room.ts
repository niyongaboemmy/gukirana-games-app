import { Room, type Client } from "@colyseus/core";
import {
  BlockListSchema,
  CALL_RING_MS,
  CallEndSchema,
  CallRespondSchema,
  CHAT_MIN_INTERVAL_MS,
  ChatSendSchema,
  DmSendSchema,
  EMOTE_COOLDOWN_MS,
  EmoteSendSchema,
  isHallId,
  NEARBY_CHAT_RANGE,
  plazaSeat,
  TargetSchema,
  UnblockSchema,
  WorldMoveSchema,
  type HallId,
} from "@gukirana/contracts";
import { filterChat, sanitizeName } from "../chat-filter.js";
import { verifyToken, type UserClaims } from "../auth.js";
import { isGame, isStake, quickMatch, startMatch, type GameId } from "../matchmaking.js";
import { SeatRegistry } from "../social/seats.js";
import { BlockGraph, blockKeyFor, type Ident } from "../social/blocks.js";
import { DmRouter } from "../social/dm.js";
import { CallRegistry } from "../social/calls.js";
import { InterestManager, TICK_MS, type Mover } from "../social/interest.js";
import { RateLimiter } from "../social/rate.js";

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
  game: GameId;
  stake: number;
  expires: number;
}

const COLOR = /^#[0-9a-f]{6}$/i;
const LOOK = /^[\w.:;,|#=-]{0,300}$/;
const PROPOSAL_TTL = 60_000;
/** A plaza bench place is freed when its holder walks this far away from it (m). */
const SEAT_LEAVE_M = 1.6;

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
  private lastChat = new Map<string, number>();
  private lastEmote = new Map<string, number>();
  private tick = 0;
  private msgSeq = 0;

  override async onAuth(_c: Client, options: { token?: unknown }): Promise<UserClaims | true> {
    if (!options?.token) return true; // guest
    const claims = await verifyToken(options.token);
    if (!claims) throw new Error("INVALID_TOKEN");
    return claims;
  }

  // ---------------------------------------------------------------- helpers
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
        this.dms.forget(sid, other);
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

    // ---- seats (hall chairs + plaza bench places): one person per seat, one seat per person
    this.onMessage("sit", (client, raw: { seat?: unknown }) => {
      const r = this.seats.claim(raw?.seat, client.sessionId);
      if (r === "taken") return client.send("seat-taken", { seat: raw.seat });
      if (r === "ok") this.broadcastSeats();
    });
    this.onMessage("stand", (client) => {
      if (this.seats.release(client.sessionId)) this.broadcastSeats();
    });

    this.onMessage("move", (client, raw: unknown) => {
      const parsed = WorldMoveSchema.safeParse(raw);
      const p = this.players.get(client.sessionId);
      if (!parsed.success || !p) return;
      const m = parsed.data;
      p.x = Math.max(-6000, Math.min(6000, m.x));
      p.z = Math.max(-6000, Math.min(6000, m.z));
      p.yaw = m.yaw;
      p.anim = m.anim;
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

    // ---- text chat: nearby (≈12 m, speech bubbles) or the whole room; filtered (FR-COM-09)
    this.onMessage("chat", (client, raw: unknown) => {
      const p = this.players.get(client.sessionId);
      const parsed = ChatSendSchema.safeParse(raw);
      if (!p || !parsed.success) return;
      const now = Date.now();
      if (now - (this.lastChat.get(client.sessionId) ?? 0) < CHAT_MIN_INTERVAL_MS) return;
      if (!this.rate.allow(`${client.sessionId}:chat`, 20, 30_000, now)) return client.send("chat-warning", { reason: "rate" });
      this.lastChat.set(client.sessionId, now);
      const r = filterChat(parsed.data.text);
      if (r.blocked) return client.send("chat-warning", { reason: r.reason });
      if (!r.text) return;
      const scope = parsed.data.scope;
      const msg = { id: p.id, name: p.name, color: p.color, text: r.text, t: now, masked: !!r.reason, scope };
      const range = NEARBY_CHAT_RANGE * 100;
      this.sendVisible(client.sessionId, "chat", msg, {
        self: true,
        only:
          scope === "nearby"
            ? (sid) => {
                const o = this.players.get(sid);
                return !!o && Math.hypot(o.x - p.x, o.z - p.z) <= range;
              }
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
    this.onMessage("propose", (client, raw: { to?: unknown; game?: unknown; stake?: unknown }) => {
      const me = this.users.get(client.sessionId);
      const target = typeof raw?.to === "string" ? this.client(raw.to) : undefined;
      if (!me) return client.send("proposal-failed", { reason: "LOGIN_REQUIRED" });
      if (!target || target.sessionId === client.sessionId || !this.users.get(target.sessionId) || !this.sees(client.sessionId, target.sessionId))
        return client.send("proposal-failed", { reason: "PLAYER_UNAVAILABLE" });
      if (!isGame(raw.game) || !isStake(raw.stake)) return client.send("proposal-failed", { reason: "INVALID_PROPOSAL" });
      const open = [...this.proposals.values()].filter((p) => p.from === client.sessionId);
      if (open.length >= 3) return client.send("proposal-failed", { reason: "TOO_MANY_OPEN" });
      const id = `p${++this.seq}`;
      const proposal: Proposal = { id, from: client.sessionId, to: target.sessionId, game: raw.game, stake: raw.stake, expires: Date.now() + PROPOSAL_TTL };
      this.proposals.set(id, proposal);
      const from = this.players.get(client.sessionId)!;
      target.send("proposal", { id, from: { id: from.id, name: from.name, level: from.level, color: from.color }, game: proposal.game, stake: proposal.stake, expires: proposal.expires });
      client.send("proposal-sent", { id, to: this.players.get(target.sessionId)?.name, game: proposal.game, stake: proposal.stake, expires: proposal.expires });
      this.clock.setTimeout(() => {
        if (this.proposals.delete(id)) {
          client.send("proposal-closed", { id, reason: "EXPIRED" });
          target.send("proposal-closed", { id, reason: "EXPIRED" });
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
        const m = await startMatch(p.game, p.stake, [a.sub, b.sub]);
        for (const c of [fromClient, client]) c.send("match-ready", { ...m, game: p.game, stake: p.stake });
      } catch (e) {
        for (const c of [fromClient, client]) c.send("proposal-closed", { id: p.id, reason: String((e as Error).message) });
      }
    });

    // ---- Quick Match ----
    this.onMessage("quickmatch-join", async (client, raw: { game?: unknown; stake?: unknown }) => {
      const me = this.users.get(client.sessionId);
      if (!me) return client.send("quickmatch", { status: "error", reason: "LOGIN_REQUIRED" });
      if (!isGame(raw?.game) || !isStake(raw?.stake)) return client.send("quickmatch", { status: "error", reason: "INVALID" });
      const game = raw.game;
      const stake = raw.stake;
      const other = quickMatch.join(game, stake, { userId: me.sub, since: Date.now(), notify: (e, p) => client.send(e, p) });
      if (!other) return client.send("quickmatch", { status: "waiting", game, stake });
      try {
        const m = await startMatch(game, stake, [other.userId, me.sub]);
        const payload = { ...m, game, stake };
        other.notify("match-ready", payload);
        client.send("match-ready", payload);
      } catch (e) {
        const reason = String((e as Error).message);
        other.notify("quickmatch", { status: "error", reason });
        client.send("quickmatch", { status: "error", reason });
      }
    });
    this.onMessage("quickmatch-leave", (client) => {
      const me = this.users.get(client.sessionId);
      if (me) quickMatch.leave(me.sub);
      client.send("quickmatch", { status: "idle" });
    });
  }

  private onTick(): void {
    this.tick++;
    const now = Date.now();
    for (const c of this.calls.expire(now, CALL_RING_MS)) {
      this.client(c.from)?.send("call-ended", { id: c.id, reason: "NO_ANSWER" });
      this.client(c.to)?.send("call-ended", { id: c.id, reason: "NO_ANSWER" });
    }
    if (this.players.size < 2) return;
    const movers: Mover[] = [];
    for (const p of this.players.values()) movers.push({ id: p.id, x: p.x, z: p.z, yaw: p.yaw, anim: p.anim, seq: this.seqs.get(p.id) ?? 0 });
    const byId = new Map(movers.map((m) => [m.id, m]));
    for (const c of this.clients) {
      const viewer = byId.get(c.sessionId);
      if (!viewer) continue;
      const entries = this.interest.collect(viewer, movers, this.tick, (m) => this.sees(c.sessionId, m.id));
      if (entries.length) c.send("moves", entries);
    }
  }

  override onJoin(
    client: Client,
    options: { name?: unknown; color?: unknown; level?: unknown; look?: unknown; bodyType?: unknown; blocks?: unknown } = {},
    auth?: UserClaims | true,
  ): void {
    const claims = auth && auth !== true ? auth : null;
    if (claims) this.users.set(client.sessionId, claims);
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
    const visible = [...this.players.values()].filter((p) => p.id === player.id || this.sees(player.id, p.id));
    client.send("snapshot", { you: player.id, players: visible });
    client.send("seats", this.seats.snapshot());
    this.sendVisible(client.sessionId, "joined", player);
  }

  override onLeave(client: Client): void {
    const sid = client.sessionId;
    const me = this.users.get(sid);
    if (me) quickMatch.leave(me.sub);
    for (const [id, p] of this.proposals) if (p.from === sid || p.to === sid) this.proposals.delete(id);
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
    if (this.seats.release(sid)) this.broadcastSeats();
  }
}
