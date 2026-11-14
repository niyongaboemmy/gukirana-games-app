import { Room, type Client } from "@colyseus/core";
import { createFairRng, commitSeed, newSeed, type FairRng } from "@gukirana/fairness";
import type { GameModule } from "@gukirana/game-kit";
import { igisoroModule } from "@gukirana/igisoro";
import { ludoModule } from "@gukirana/ludo";
import { poolModule } from "@gukirana/pool";
import { keyFromSeed, signResult } from "@gukirana/signing";
import { loadEnv } from "@gukirana/config";
import { createLogger } from "@gukirana/observability";
import { verifyToken } from "../auth.js";
import { api } from "../api-client.js";
import { eligibilityOf, trackAccount } from "../social/accounts.js";

const log = createLogger("match-room");
const { privateKey } = keyFromSeed(loadEnv().RESULT_SIGNING_SEED);
const TURN_MS = 30_000;
const JOIN_MS = 60_000;
const RECONNECT_S = 60;
const MAX_STRIKES = 3;
const DRAW_OFFER_COOLDOWN_MS = 30_000;

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
}

/**
 * Server-authoritative match (plan P0-GMK-04, Appendix B.2).
 * Clients only send intents; the module validates and applies them; randomness from the
 * commit-reveal RNG; the final result is Ed25519-signed and settled by the API.
 */
export class MatchRoom extends Room {
  // players only (onAuth), but a player may hold a second tab or re-join after a reload while the old seat waits
  override maxClients = 8;
  private opts!: MatchOptions;
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
  private deadline = 0;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private joinTimer: ReturnType<typeof setTimeout> | null = null;
  private finished = false;
  private drawOffer: { from: string; at: number } | null = null;
  private lastDrawOffer = new Map<string, number>();
  /** sessionId → unregister from the account registry (a suspended player's match is voided) */
  private tracked = new Map<string, () => void>();

  override onCreate(options: MatchOptions): void {
    this.opts = options;
    this.mod = MODULES[options.game]!;
    this.autoDispose = true;
    this.setPrivate(true);
    this.joinTimer = setTimeout(() => void this.finish("void", {}), JOIN_MS);

    this.onMessage("intent", (client, raw: unknown) => {
      const userId = this.sessions.get(client.sessionId);
      if (!userId || !this.state_ || this.finished) return;
      const parsed = this.mod.intentSchema.safeParse(raw);
      if (!parsed.success) return client.send("rejected", { reason: "BAD_INTENT" });
      const v = this.mod.validate(this.state_, userId, parsed.data);
      if (!v.ok) return client.send("rejected", { reason: v.reason });
      this.state_ = this.mod.apply(this.state_, userId, parsed.data, this.rng!);
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
      client.send("init", { you: userId, game: this.opts.game, stake: this.opts.stake, players: this.opts.players, commit: this.commit, matchId: this.opts.matchId });
      if (this.state_) this.sendState(client);
    });

    this.onMessage("resign", (client) => {
      const userId = this.sessions.get(client.sessionId);
      if (userId && !this.finished) void this.forfeit(userId);
    });

    this.onMessage("emote", (client, raw: { emote?: unknown }) => {
      const userId = this.sessions.get(client.sessionId);
      const e = String(raw?.emote ?? "");
      if (userId && /^(gg|nice|wow|oops|thanks)$/.test(e)) this.broadcast("emote", { userId, emote: e });
    });
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
      void this.finish("void", {});
    }
    for (const c of this.clients) if (this.sessions.get(c.sessionId) === userId) c.leave(4001);
  }

  override onJoin(client: Client, options: { clientSeed?: unknown }, auth: { userId: string }): void {
    this.sessions.set(client.sessionId, auth.userId);
    this.tracked.set(client.sessionId, trackAccount(auth.userId, () => this.suspended(auth.userId)));
    const cs = typeof options?.clientSeed === "string" && /^[0-9a-f]{8,64}$/i.test(options.clientSeed) ? options.clientSeed : auth.userId;
    if (!this.clientSeeds.has(auth.userId)) this.clientSeeds.set(auth.userId, cs);
    client.send("init", { you: auth.userId, game: this.opts.game, stake: this.opts.stake, players: this.opts.players, commit: this.commit, matchId: this.opts.matchId });
    const joined = new Set(this.sessions.values());
    if (!this.state_ && this.opts.players.every((p) => joined.has(p.userId))) this.start();
    else if (this.state_) {
      // a fresh join mid-game (page reload, new tab): the seat is theirs again
      this.broadcast("presence", { userId: auth.userId, connected: true });
      this.sendState(client);
      if (this.drawOffer && this.drawOffer.from !== auth.userId) client.send("draw-offer", { from: this.drawOffer.from });
    }
  }

  override async onLeave(client: Client, consented: boolean): Promise<void> {
    const userId = this.sessions.get(client.sessionId);
    this.sessions.delete(client.sessionId);
    this.tracked.get(client.sessionId)?.();
    this.tracked.delete(client.sessionId);
    if (!userId || this.finished) return;
    // same player still connected from another session/tab → not a disconnect
    if ([...this.sessions.values()].includes(userId)) return;
    this.broadcast("presence", { userId, connected: false });
    if (consented) return void this.forfeit(userId);
    try {
      const re = await this.allowReconnection(client, RECONNECT_S); // FR-GS-03
      this.sessions.set(re.sessionId, userId);
      this.broadcast("presence", { userId, connected: true });
      this.sendState(re);
    } catch {
      // they came back through a fresh join (reload) instead of the reconnection token → no forfeit
      if (!this.finished && ![...this.sessions.values()].includes(userId)) await this.forfeit(userId);
    }
  }

  override onDispose(): void {
    for (const off of this.tracked.values()) off();
    this.tracked.clear();
    this.clearTimers();
    if (!this.finished) void api.voidMatch(this.opts.matchId).catch(() => undefined);
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
    client.send("state", { state: this.mod.viewFor(this.state_, userId), turn: this.mod.currentTurn(this.state_), deadline: this.deadline, hash: this.mod.hash(this.state_) });
  }

  private armTurnTimer(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.deadline = Date.now() + TURN_MS;
    this.turnTimer = setTimeout(() => {
      const turn = this.mod.currentTurn(this.state_);
      const userId = Array.isArray(turn) ? turn[0] : turn;
      if (!userId || this.finished) return;
      const strikes = (this.strikes.get(userId) ?? 0) + 1;
      this.strikes.set(userId, strikes);
      if (strikes >= MAX_STRIKES) return void this.forfeit(userId);
      this.state_ = this.mod.onTimeout(this.state_, userId);
      this.broadcast("timeout", { userId, strikes });
      this.afterChange();
    }, TURN_MS);
  }

  private async forfeit(loser: string): Promise<void> {
    const ranks: Record<string, number> = {};
    for (const p of this.opts.players) ranks[p.userId] = p.userId === loser ? 2 : 1;
    await this.finish("forfeit", ranks);
  }

  private async finish(reason: "normal" | "forfeit" | "timeout" | "void", ranks: Record<string, number>): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    this.clearTimers();
    const signed = signResult(
      {
        matchId: this.opts.matchId,
        game: this.opts.game,
        ranks: reason === "void" ? Object.fromEntries(this.opts.players.map((p) => [p.userId, 1])) : ranks,
        reason,
        stateHash: this.state_ ? this.mod.hash(this.state_) : "none",
        seedCommit: this.commit,
        seedReveal: this.seed,
        finishedAt: new Date().toISOString(),
      },
      privateKey,
    );
    let settlement: unknown = null;
    try {
      settlement = reason === "void" ? await api.voidMatch(this.opts.matchId) : await api.submitResult(signed);
    } catch (e) {
      log.error({ err: String(e), matchId: this.opts.matchId }, "settlement failed");
    }
    this.broadcast("result", { ranks: signed.ranks, reason, seedReveal: this.seed, commit: this.commit, settlement });
    this.clock.setTimeout(() => this.disconnect(), 20_000);
  }

  private clearTimers(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.joinTimer) clearTimeout(this.joinTimer);
  }
}
