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

  override onCreate(options: MatchOptions): void {
    this.opts = options;
    this.rules = { ...DEFAULT_RULES, ...(options.rules ?? {}) };
    this.mod = MODULES[options.game]!;
    this.autoDispose = true;
    this.setPrivate(true);
    live.set(options.matchId, this);
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
    };
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
      // a fresh join mid-game (page reload, new tab): the seat is theirs again
      this.broadcast("presence", { userId: auth.userId, connected: true });
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
    try {
      const re = await this.allowReconnection(client, this.rules.reconnectSeconds); // FR-GS-03; the turn clock keeps running
      this.sessions.set(re.sessionId, userId);
      this.broadcast("presence", { userId, connected: true });
      this.sendState(re);
    } catch {
      // they came back through a fresh join (reload) instead of the reconnection token → no forfeit
      if (!this.finished && !this.connected(userId)) await this.forfeitOrVoid(userId, "DISCONNECT");
    }
  }

  override onDispose(): void {
    for (const off of this.tracked.values()) off();
    this.tracked.clear();
    this.clearTimers();
    live.delete(this.opts.matchId);
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
    client.send("state", { state: this.mod.viewFor(this.state_, userId), turn: this.mod.currentTurn(this.state_), deadline: this.deadline, hash: this.mod.hash(this.state_), started: this.moves > 0 });
  }

  private armTurnTimer(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    const ms = this.rules.turnSeconds * 1000;
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

  private async finish(reason: Reason, ranks: Record<string, number>, cause?: VoidCause | ForfeitCause, loser?: string): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    this.clearTimers();
    live.delete(this.opts.matchId);
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
