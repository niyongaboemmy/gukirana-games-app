import { Room, type Client } from "@colyseus/core";
import { createFairRng, commitSeed, newSeed, type FairRng } from "@gukirana/fairness";
import type { GameModule } from "@gukirana/game-kit";
import { igisoroModule } from "@gukirana/igisoro";
import { ludoModule } from "@gukirana/ludo";
import { poolModule } from "@gukirana/pool";
import { keyFromSeed, signResult } from "@gukirana/signing";
import { loadEnv } from "@gukirana/config";
import { createLogger } from "@gukirana/observability";
import type { ForfeitCause, MatchRules, VoidCause } from "@gukirana/contracts";
import { verifyToken } from "../auth.js";
import { api, ApiError } from "../api-client.js";
import { eligibilityOf, trackAccount } from "../social/accounts.js";

const log = createLogger("match-room");
const { privateKey } = keyFromSeed(loadEnv().RESULT_SIGNING_SEED);
const DRAW_OFFER_COOLDOWN_MS = 30_000;

/** used when a room is created without rules (older API); the API normally sends the game's settings snapshot */
export const DEFAULT_RULES: MatchRules = { settingsVersion: 0, turnSeconds: 30, reconnectSeconds: 60, joinSeconds: 60, maxTimeouts: 3, maxMatchMinutes: 90 };
/** P2-NET-05: a player back on their own turn gets at least this much of it (the clock was paused while away) */
export const MIN_TURN_LEFT_MS = 10_000;
/** P2-NET-05 reconnect budget: drops per player per match and all their time away together (older rules: defaults) */
export const reconnectBudgetOf = (r: MatchRules, fight = false): { maxDrops: number; totalMs: number } => ({
  maxDrops: r.maxDisconnects ?? 3,
  totalMs: (r.reconnectBudgetSeconds ?? (fight ? r.reconnectSeconds : 2 * r.reconnectSeconds)) * 1000,
});

/**
 * P2-NET-05 resume: who sits in which live room of this process (userId → room). The web finds the room through the
 * API (`GET /games/active`, the room id reported by `api.attachRoom`); this is the in-process view for tests / ops.
 */
export const liveSeats = new Map<string, { roomId: string; matchId: string; game: string }>();

/** P2-NET-05: report the room running a match to the API (best effort: the web also keeps the room id locally) */
export function reportRoom(matchId: string, roomId: string, ring?: string): void {
  void Promise.resolve()
    .then(() => api.attachRoom?.(matchId, roomId, ring))
    .catch((e: unknown) => log.warn({ err: String(e), matchId }, "could not report the match room (resume falls back to the local reference)"));
}

/** knobs tests shorten */
export const matchConfig = {
  /** settlement attempts before the match is voided instead (server error → refund) */
  settleTries: 3,
  retryMs: 400,
  /** the result screen's room stays open this long before the room closes */
  lingerMs: 20_000,
  heartbeatMs: 20_000,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MODULES: Record<string, GameModule<any, any, any>> = { igisoro: igisoroModule, ludo: ludoModule, pool: poolModule };

export interface MatchPlayerInfo {
  userId: string;
  seat: number;
  name: string;
  color: string;
  rating: number;
}

export interface MatchOptions {
  matchId: string;
  game: "igisoro" | "ludo" | "pool";
  variant: string;
  stake: number;
  players: MatchPlayerInfo[];
  /** the game's rules when the match was created (the API's snapshot; running matches keep them) */
  rules?: Partial<MatchRules>;
}

type Reason = "normal" | "forfeit" | "timeout" | "void";

/** every match this process is running (the heartbeat tells the API, so it never sweeps a live match) */
const live = new Map<string, { endedElsewhere(): void }>();
/** other live rooms (boxing fights, P3-FGT-01) take part in the same heartbeat */
export const trackLiveMatch = (matchId: string, room: { endedElsewhere(): void }): void => void live.set(matchId, room);
export const untrackLiveMatch = (matchId: string): void => void live.delete(matchId);

/** one heartbeat: report the live matches; end any the API no longer holds as active (swept, voided elsewhere) */
export async function heartbeatOnce(): Promise<void> {
  const ids = [...live.keys()];
  if (!ids.length) return;
  const r = await api.heartbeat(ids);
  for (const id of r.inactive ?? []) live.get(id)?.endedElsewhere();
}

/** index.ts: report live matches every ~20 s (the API voids + refunds matches nobody reports, docs/GAME-EXIT-RULES.md) */
export function startMatchHeartbeat(): () => void {
  const t = setInterval(() => void heartbeatOnce().catch(() => undefined), matchConfig.heartbeatMs);
  t.unref?.();
  return () => clearInterval(t);
}

/**
 * Server-authoritative match (plan P0-GMK-04, Appendix B.2). Clients only send intents; the module validates and
 * applies them; randomness from the commit-reveal RNG; the final result is Ed25519-signed and settled by the API.
 * How a match ends — every exit path — follows docs/GAME-EXIT-RULES.md (the single source of truth):
 *
 *  - before the first move of the match, anyone leaving / timing out / not coming back → void, full refund;
 *  - after it: Leave (resign) → forfeit; a disconnect gets `reconnectSeconds` (turn clock keeps running) → forfeit;
 *    `maxTimeouts` timeouts in a row → forfeit; nobody left connected to win → void;
 *  - a player who never opens the match within `joinSeconds` → void; past `maxMatchMinutes` → void;
 *  - suspension mid-match → void; settlement failing after retries → void (refund); room closed early → void.
 */
export class MatchRoom extends Room {
  // players only (onAuth), but a player may hold a second tab or re-join after a reload while the old seat waits
  override maxClients = 8;
  private opts!: MatchOptions;
  private rules: MatchRules = DEFAULT_RULES;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mod!: GameModule<any, any, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private state_: any = null;
  private seed = newSeed();
  private commit = commitSeed(this.seed);
  private clientSeeds = new Map<string, string>();
  private rng: FairRng | null = null;
  private sessions = new Map<string, string>(); // sessionId → userId
  private strikes = new Map<string, number>();
  /** moves players made themselves (timeouts' automatic moves don't count): 0 = the match hasn't really begun */
  private moves = 0;
  private deadline = 0;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private joinTimer: ReturnType<typeof setTimeout> | null = null;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private finished = false;
  private drawOffer: { from: string; at: number } | null = null;
  private lastDrawOffer = new Map<string, number>();
  /** sessionId → unregister from the account registry (a suspended player's match is voided) */
  private tracked = new Map<string, () => void>();
  /** P2-NET-05: per player — connection losses so far, time away used (ms), the current absence (start + its end) */
  private drops = new Map<string, number>();
  private awayUsed = new Map<string, number>();
  private away = new Map<string, { since: number; until: number; wait?: ReturnType<Room["allowReconnection"]> }>();
  /** the turn clock is stopped while the player on turn is away: the time their turn still had */
  private pausedLeft: number | null = null;

  override onCreate(options: MatchOptions): void {
    this.opts = options;
    this.rules = { ...DEFAULT_RULES, ...(options.rules ?? {}) };
    this.mod = MODULES[options.game]!;
    this.autoDispose = true;
    this.setPrivate(true);
    live.set(options.matchId, this);
    for (const p of options.players) liveSeats.set(p.userId, { roomId: this.roomId, matchId: options.matchId, game: options.game });
    // opponent never joins → void + refund
    this.joinTimer = setTimeout(() => void this.finish("void", {}, "NO_SHOW"), this.rules.joinSeconds * 1000);
    // longest a match may run: past it, void + refund (the API's sweep would refund it a little later anyway)
    this.maxTimer = setTimeout(() => void this.finish("void", {}, "MATCH_TOO_LONG"), this.rules.maxMatchMinutes * 60_000);

    this.onMessage("intent", (client, raw: unknown) => {
      const userId = this.sessions.get(client.sessionId);
      if (!userId || !this.state_ || this.finished) return;
      const parsed = this.mod.intentSchema.safeParse(raw);
      if (!parsed.success) return client.send("rejected", { reason: "BAD_INTENT" });
      const v = this.mod.validate(this.state_, userId, parsed.data);
      if (!v.ok) return client.send("rejected", { reason: v.reason });
      this.state_ = this.mod.apply(this.state_, userId, parsed.data, this.rng!);
      this.moves++;
      this.strikes.set(userId, 0);
      this.drawOffer = null; // a move answers (declines) a pending draw offer
      this.afterChange();
    });

    // draw by agreement (2-player games): stakes are split by the API (equal ranks)
    this.onMessage("draw-offer", (client) => {
      const userId = this.sessions.get(client.sessionId);
      if (!userId || !this.state_ || this.finished || this.opts.players.length !== 2) return;
      const last = this.lastDrawOffer.get(userId) ?? 0;
      if (Date.now() - last < DRAW_OFFER_COOLDOWN_MS) return client.send("rejected", { reason: "DRAW_OFFER_COOLDOWN" });
      this.lastDrawOffer.set(userId, Date.now());
      this.drawOffer = { from: userId, at: Date.now() };
      this.broadcast("draw-offer", { from: userId });
    });
    this.onMessage("draw-reply", (client, raw: { accept?: unknown }) => {
      const userId = this.sessions.get(client.sessionId);
      const offer = this.drawOffer;
      if (!userId || !offer || offer.from === userId || this.finished) return;
      this.drawOffer = null;
      if (raw?.accept === true) {
        void this.finish("normal", Object.fromEntries(this.opts.players.map((p) => [p.userId, 1])));
      } else this.broadcast("draw-declined", { by: userId });
    });

    // re-attach after a client re-mount/reconnect: resend setup + current state
    this.onMessage("sync", (client) => {
      const userId = this.sessions.get(client.sessionId);
      if (!userId) return;
      client.send("init", this.initFor(userId));
      if (this.state_) this.sendState(client);
    });

    // "Leave" in the game menu (also a consented leave): forfeit, or void before the first move
    this.onMessage("resign", (client) => {
      const userId = this.sessions.get(client.sessionId);
      if (userId && !this.finished) void this.leaveVoluntarily(userId);
    });

    // P2-NET-05: the opponent dropped and I don't want to wait — friendly matches only: void, no penalty for anyone
    this.onMessage("leave-waiting", (client) => {
      const userId = this.sessions.get(client.sessionId);
      if (!userId || this.finished) return;
      if (this.opts.stake > 0) return client.send("rejected", { reason: "STAKED_MUST_WAIT" });
      if (![...this.away.keys()].some((u) => u !== userId)) return client.send("rejected", { reason: "OPPONENT_CONNECTED" });
      log.info({ event: "match.left-waiting", matchId: this.opts.matchId, userId }, "left a friendly match while the opponent was away");
      void this.finish("void", {}, "LEFT_WHILE_WAITING");
    });

    this.onMessage("emote", (client, raw: { emote?: unknown }) => {
      const userId = this.sessions.get(client.sessionId);
      const e = String(raw?.emote ?? "");
      if (userId && /^(gg|nice|wow|oops|thanks)$/.test(e)) this.broadcast("emote", { userId, emote: e });
    });
  }

  private initFor(userId: string) {
    return {
      you: userId,
      game: this.opts.game,
      stake: this.opts.stake,
      players: this.opts.players,
      commit: this.commit,
      matchId: this.opts.matchId,
      rules: this.rules,
      started: this.moves > 0,
      /** P2-NET-05: players away right now (ms left to come back) and my own reconnect budget */
      away: this.awayList().filter((x) => x.userId !== userId),
      budget: this.budgetFor(userId),
    };
  }

  private awayList(): { userId: string; ms: number }[] {
    return [...this.away].map(([userId, a]) => ({ userId, ms: Math.max(0, a.until - Date.now()) }));
  }

  private budgetFor(userId: string): { dropsLeft: number; msLeft: number } {
    const b = reconnectBudgetOf(this.rules);
    return { dropsLeft: Math.max(0, b.maxDrops - (this.drops.get(userId) ?? 0)), msLeft: Math.max(0, b.totalMs - (this.awayUsed.get(userId) ?? 0)) };
  }

  override async onAuth(_client: Client, options: { token?: unknown }): Promise<{ userId: string }> {
    const claims = await verifyToken(options?.token);
    if (!claims || !this.opts.players.some((p) => p.userId === claims.sub)) throw new Error("NOT_A_PLAYER");
    if ((await eligibilityOf(claims.sub, 0)).reason === "ACCOUNT_INACTIVE") throw new Error("ACCOUNT_INACTIVE");
    return { userId: claims.sub };
  }

  /**
   * A player in this match was suspended (social/accounts.ts): the match is voided (every stake goes back through
   * the API's void, a ledger refund) and the suspended player's connection is closed.
   */
  private suspended(userId: string): void {
    if (!this.finished) {
      this.broadcast("player-removed", { userId, reason: "PLAYER_UNAVAILABLE" });
      void this.finish("void", {}, "PLAYER_SUSPENDED");
    }
    for (const c of this.clients) if (this.sessions.get(c.sessionId) === userId) c.leave(4001);
  }

  /** the API no longer holds this match as active (the sweep voided it): end here too, without another call */
  endedElsewhere(): void {
    if (this.finished) return;
    this.finished = true;
    this.clearTimers();
    live.delete(this.opts.matchId);
    this.unseat();
    this.broadcast("result", { ranks: Object.fromEntries(this.opts.players.map((p) => [p.userId, 1])), reason: "void", cause: "STALE_ESCROW", seedReveal: this.seed, commit: this.commit, settlement: { status: "void" } });
    this.clock.setTimeout(() => this.disconnect(), matchConfig.lingerMs);
  }

  override onJoin(client: Client, options: { clientSeed?: unknown }, auth: { userId: string }): void {
    this.sessions.set(client.sessionId, auth.userId);
    this.tracked.set(client.sessionId, trackAccount(auth.userId, () => this.suspended(auth.userId)));
    const cs = typeof options?.clientSeed === "string" && /^[0-9a-f]{8,64}$/i.test(options.clientSeed) ? options.clientSeed : auth.userId;
    if (!this.clientSeeds.has(auth.userId)) this.clientSeeds.set(auth.userId, cs);
    client.send("init", this.initFor(auth.userId));
    const joined = new Set(this.sessions.values());
    if (!this.state_ && !this.finished && this.opts.players.every((p) => joined.has(p.userId))) this.start();
    else if (this.state_) {
      // a fresh join mid-game (page reload, new tab, a new device): the seat is theirs again
      if (this.away.has(auth.userId)) this.back(auth.userId, "rejoin");
      else this.broadcast("presence", { userId: auth.userId, connected: true });
      this.sendState(client);
      if (this.drawOffer && this.drawOffer.from !== auth.userId) client.send("draw-offer", { from: this.drawOffer.from });
    }
  }

  private connected(userId: string): boolean {
    return [...this.sessions.values()].includes(userId);
  }

  override async onLeave(client: Client, consented: boolean): Promise<void> {
    const userId = this.sessions.get(client.sessionId);
    this.sessions.delete(client.sessionId);
    this.tracked.get(client.sessionId)?.();
    this.tracked.delete(client.sessionId);
    if (!userId || this.finished) return;
    // same player still connected from another session/tab → not a disconnect
    if (this.connected(userId)) return;
    this.broadcast("presence", { userId, connected: false });
    if (consented) return void this.leaveVoluntarily(userId);
    // not started yet (the other player hasn't opened the match): they may come back; the join timer voids otherwise
    if (!this.state_) return;
    // P2-NET-05: each drop is counted against the player's reconnect budget (drops and time away per match)
    const drop = (this.drops.get(userId) ?? 0) + 1;
    this.drops.set(userId, drop);
    const b = reconnectBudgetOf(this.rules);
    const left = b.totalMs - (this.awayUsed.get(userId) ?? 0);
    const windowMs = Math.min(this.rules.reconnectSeconds * 1000, left);
    if (drop > b.maxDrops || windowMs <= 0) {
      log.info({ event: "match.budget-exhausted", matchId: this.opts.matchId, userId, drop, leftMs: Math.max(0, left) }, "reconnect budget used up");
      this.broadcast("presence", { userId, connected: false, ms: 0, budgetOut: true });
      return void this.forfeitOrVoid(userId, "DISCONNECT");
    }
    const now = Date.now();
    this.away.set(userId, { since: now, until: now + windowMs });
    log.info({ event: "match.disconnect", matchId: this.opts.matchId, userId, drop, windowMs }, "player disconnected; seat kept");
    // the opponent's wait (a countdown); the absent player's turn clock stops (turn games, docs/GAME-EXIT-RULES.md row 5)
    this.broadcast("presence", { userId, connected: false, ms: windowMs, drop, maxDrops: b.maxDrops });
    this.pauseClockIfAway();
    try {
      const wait = this.allowReconnection(client, windowMs / 1000); // FR-GS-03
      const a = this.away.get(userId);
      if (a) a.wait = wait;
      const re = await wait;
      this.sessions.set(re.sessionId, userId);
      this.back(userId, "token");
      this.sendState(re);
    } catch {
      // they came back through a fresh join (reload) instead of the reconnection token → no forfeit
      if (!this.finished && !this.connected(userId)) {
        log.info({ event: "match.no-return", matchId: this.opts.matchId, userId }, "player did not come back in time");
        await this.forfeitOrVoid(userId, "DISCONNECT");
      }
    }
  }

  /** P2-NET-05: a player is back (reconnection token or a fresh join): charge their budget, restart a stopped clock */
  private back(userId: string, via: "token" | "rejoin"): void {
    const a = this.away.get(userId);
    if (!a) return;
    this.away.delete(userId);
    this.awayUsed.set(userId, (this.awayUsed.get(userId) ?? 0) + (Date.now() - a.since));
    // a reload: the token wait is no longer needed (rejecting it frees the old seat; connected() stops a forfeit)
    if (via === "rejoin") a.wait?.reject();
    log.info({ event: "match.reconnect", matchId: this.opts.matchId, userId, via, awayMs: Date.now() - a.since }, "player back");
    this.broadcast("presence", { userId, connected: true, budget: this.budgetFor(userId) });
    if (this.finished || !this.state_) return;
    if (this.pausedLeft !== null && !this.turnAway()) {
      const ms = Math.max(MIN_TURN_LEFT_MS, this.pausedLeft);
      this.pausedLeft = null;
      this.armTurnTimer(Math.min(ms, this.rules.turnSeconds * 1000));
      for (const c of this.clients) this.sendState(c);
    }
  }

  /** the player on turn (first of a simultaneous turn) */
  private turnUser(): string | null {
    const turn = this.state_ ? this.mod.currentTurn(this.state_) : null;
    return (Array.isArray(turn) ? turn[0] : turn) ?? null;
  }
  private turnAway(): boolean {
    const u = this.turnUser();
    return !!u && this.away.has(u);
  }
  /** stop the turn clock while the player on turn is away (they get the rest of their turn back) */
  private pauseClockIfAway(): void {
    if (this.finished || !this.state_ || !this.turnAway() || this.pausedLeft !== null) return;
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
    this.pausedLeft = this.deadline ? Math.max(0, this.deadline - Date.now()) : this.rules.turnSeconds * 1000;
    this.deadline = 0;
    for (const c of this.clients) this.sendState(c);
  }

  override onDispose(): void {
    for (const off of this.tracked.values()) off();
    this.tracked.clear();
    this.clearTimers();
    live.delete(this.opts.matchId);
    this.unseat();
    // closed before a result (shutdown, crash recovery): void + refund (idempotent on the API side)
    if (!this.finished) void api.voidMatch(this.opts.matchId, "ROOM_CLOSED").catch(() => undefined);
  }

  private start(): void {
    if (this.joinTimer) clearTimeout(this.joinTimer);
    const seeds = this.opts.players.map((p) => this.clientSeeds.get(p.userId) ?? p.userId);
    this.rng = createFairRng(this.seed, seeds, this.opts.matchId);
    const refs = this.opts.players.map((p) => ({ id: p.userId, seat: p.seat, rating: p.rating }));
    this.state_ = this.mod.init({}, refs, this.rng);
    // not locked: a player reloading the page must be able to join again by id (onAuth admits only the players)
    this.afterChange();
  }

  private afterChange(): void {
    if (this.mod.isTerminal(this.state_)) {
      // everyone sees the deciding move (the winning shot, the last token home) before the result
      this.deadline = 0;
      for (const c of this.clients) this.sendState(c);
      const r = this.mod.result(this.state_);
      void this.finish(r.reason, r.ranks);
      return;
    }
    this.armTurnTimer();
    for (const c of this.clients) this.sendState(c);
  }

  private sendState(client: Client): void {
    const userId = this.sessions.get(client.sessionId) ?? "spectator";
    client.send("state", {
      state: this.mod.viewFor(this.state_, userId),
      turn: this.mod.currentTurn(this.state_),
      deadline: this.deadline,
      hash: this.mod.hash(this.state_),
      started: this.moves > 0,
      // P2-NET-05: the turn clock is stopped (the player on turn is away); turnLeftMs = what their turn still has
      ...(this.pausedLeft !== null ? { paused: true, turnLeftMs: this.pausedLeft } : {}),
    });
  }

  private armTurnTimer(ms0?: number): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.pausedLeft = null;
    // P2-NET-05: a new turn for a player who is away waits for them (their wait / budget decides the match)
    if (this.turnAway()) {
      this.turnTimer = null;
      this.deadline = 0;
      this.pausedLeft = this.rules.turnSeconds * 1000;
      return;
    }
    const ms = ms0 ?? this.rules.turnSeconds * 1000;
    this.deadline = Date.now() + ms;
    this.turnTimer = setTimeout(() => {
      const turn = this.mod.currentTurn(this.state_);
      const userId = Array.isArray(turn) ? turn[0] : turn;
      if (!userId || this.finished) return;
      const strikes = (this.strikes.get(userId) ?? 0) + 1;
      this.strikes.set(userId, strikes);
      this.broadcast("timeout", { userId, strikes, max: this.rules.maxTimeouts });
      if (strikes >= this.rules.maxTimeouts) return void this.forfeitOrVoid(userId, "TIMEOUTS");
      this.state_ = this.mod.onTimeout(this.state_, userId);
      this.afterChange();
    }, ms);
  }

  /** "Leave" / consented close: before the first move nobody is hurt (void); after it, the leaver forfeits */
  private async leaveVoluntarily(userId: string): Promise<void> {
    if (!this.state_ || this.moves === 0) return this.finish("void", {}, "LEFT_BEFORE_START");
    await this.forfeit(userId, "RESIGN");
  }

  /**
   * A forfeit the player didn't choose (reconnect window over, timeouts). Before the first move → void; nobody else
   * still connected to win (both gone) → void; otherwise the opponent wins.
   */
  private async forfeitOrVoid(loser: string, cause: Exclude<ForfeitCause, "RESIGN">): Promise<void> {
    if (this.moves === 0) return this.finish("void", {}, cause === "TIMEOUTS" ? "NO_FIRST_MOVE" : "LEFT_BEFORE_START");
    if (!this.opts.players.some((p) => p.userId !== loser && this.connected(p.userId))) return this.finish("void", {}, "BOTH_DISCONNECTED");
    await this.forfeit(loser, cause);
  }

  private async forfeit(loser: string, cause: ForfeitCause): Promise<void> {
    const ranks: Record<string, number> = {};
    for (const p of this.opts.players) ranks[p.userId] = p.userId === loser ? 2 : 1;
    await this.finish("forfeit", ranks, cause, loser);
  }

  /** a settlement call with retries; null when every attempt failed */
  private async settleWithRetry<T>(call: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
    let error: unknown = null;
    for (let i = 0; i < matchConfig.settleTries; i++) {
      try {
        return { ok: true, value: await call() };
      } catch (e) {
        error = e;
        // a refusal (bad signature, not active) won't change on retry
        if (e instanceof ApiError && !/^API_5\d\d$/.test(e.message)) break;
        if (i < matchConfig.settleTries - 1) await new Promise((r) => setTimeout(r, matchConfig.retryMs * (i + 1)));
      }
    }
    return { ok: false, error };
  }

  private unseat(): void {
    for (const p of this.opts.players) if (liveSeats.get(p.userId)?.roomId === this.roomId) liveSeats.delete(p.userId);
  }

  private async finish(reason: Reason, ranks: Record<string, number>, cause?: VoidCause | ForfeitCause, loser?: string): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    this.clearTimers();
    live.delete(this.opts.matchId);
    this.unseat();
    for (const a of this.away.values()) a.wait?.reject();
    this.away.clear();
    // moderation trail (P2-NET-05): every end with its cause (the API adds an audit row for forfeits)
    log.info({ event: `match.${reason}`, matchId: this.opts.matchId, game: this.opts.game, cause: cause ?? null, loser: loser ?? null, stake: this.opts.stake }, "match ended");
    const equal = Object.fromEntries(this.opts.players.map((p) => [p.userId, 1]));
    const signed = signResult(
      {
        matchId: this.opts.matchId,
        game: this.opts.game,
        ranks: reason === "void" ? equal : ranks,
        reason,
        stateHash: this.state_ ? this.mod.hash(this.state_) : "none",
        seedCommit: this.commit,
        seedReveal: this.seed,
        finishedAt: new Date().toISOString(),
      },
      privateKey,
    );
    let settlement: unknown = null;
    let outReason: Reason = reason;
    let outCause = cause;
    let pending = false;
    if (reason === "void") {
      const v = await this.settleWithRetry(() => api.voidMatch(this.opts.matchId, cause as VoidCause | undefined));
      if (v.ok) settlement = v.value;
      else pending = true; // the API's sweep refunds it (no heartbeat any more)
    } else {
      const s = await this.settleWithRetry(() => api.submitResult(signed));
      if (s.ok) settlement = s.value;
      else {
        log.error({ err: String(s.error), matchId: this.opts.matchId }, "settlement failed; voiding instead");
        // server error → void + full refund (never a stuck escrow); MATCH_NOT_ACTIVE = it was voided already
        outReason = "void";
        outCause = "SERVER_ERROR";
        const v = await this.settleWithRetry(() => api.voidMatch(this.opts.matchId, "SERVER_ERROR"));
        if (v.ok) settlement = v.value;
        else pending = true;
      }
    }
    this.broadcast("result", {
      ranks: outReason === "void" ? equal : signed.ranks,
      reason: outReason,
      ...(outCause ? { cause: outCause } : {}),
      ...(loser && outReason === "forfeit" ? { loser } : {}),
      seedReveal: this.seed,
      commit: this.commit,
      settlement,
      ...(pending ? { pending: true } : {}),
    });
    this.clock.setTimeout(() => this.disconnect(), matchConfig.lingerMs);
  }

  private clearTimers(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.joinTimer) clearTimeout(this.joinTimer);
    if (this.maxTimer) clearTimeout(this.maxTimer);
  }
}
