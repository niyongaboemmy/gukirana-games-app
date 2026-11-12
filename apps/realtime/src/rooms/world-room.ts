import { Room, type Client } from "@colyseus/core";
import { WorldMoveSchema } from "@gukirana/contracts";
import { filterChat, sanitizeName } from "../chat-filter.js";
import { verifyToken, type UserClaims } from "../auth.js";
import { isGame, isStake, quickMatch, startMatch, type GameId } from "../matchmaking.js";

export interface WorldPlayer {
  id: string;
  name: string;
  color: string;
  level: number;
  x: number; // centimetres
  z: number;
  yaw: number; // 0–65535
  anim: number; // 0 idle, 1 walk, 2 run, 10+ emotes
  look?: string; // encoded avatar look (client renders; validated length/charset)
  bodyType?: string;
  verified: boolean; // logged in (can challenge)
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

/**
 * Plaza presence (SRS §8.4) + in-world proposals (§8.4.2) + Quick Match.
 * Guests can walk and chat; challenges need a logged-in account. All deals go through escrow.
 */
export class WorldRoom extends Room {
  override maxClients = 50;
  private players = new Map<string, WorldPlayer>();
  private users = new Map<string, UserClaims>(); // sessionId → claims
  private lastChat = new Map<string, number>();
  private proposals = new Map<string, Proposal>();
  private seq = 0;

  override async onAuth(_c: Client, options: { token?: unknown }): Promise<UserClaims | true> {
    if (!options?.token) return true; // guest
    const claims = await verifyToken(options.token);
    if (!claims) throw new Error("INVALID_TOKEN");
    return claims;
  }

  override onCreate(): void {
    this.onMessage("move", (client, raw: unknown) => {
      const parsed = WorldMoveSchema.safeParse(raw);
      const p = this.players.get(client.sessionId);
      if (!parsed.success || !p) return;
      const m = parsed.data;
      p.x = Math.max(-6000, Math.min(6000, m.x));
      p.z = Math.max(-6000, Math.min(6000, m.z));
      p.yaw = m.yaw;
      p.anim = m.anim;
      this.broadcast("move", { id: p.id, x: p.x, z: p.z, yaw: p.yaw, anim: p.anim }, { except: client });
    });

    this.onMessage("emote", (client, raw: { emote?: unknown }) => {
      const emote = Number(raw?.emote);
      if (!Number.isInteger(emote) || emote < 10 || emote > 20) return;
      this.broadcast("emote", { id: client.sessionId, emote });
    });

    this.onMessage("chat", (client, raw: { text?: unknown }) => {
      const p = this.players.get(client.sessionId);
      if (!p || typeof raw?.text !== "string") return;
      const now = Date.now();
      if (now - (this.lastChat.get(client.sessionId) ?? 0) < 800) return;
      this.lastChat.set(client.sessionId, now);
      const r = filterChat(raw.text);
      if (r.blocked) return client.send("chat-warning", { reason: r.reason });
      if (!r.text) return;
      this.broadcast("chat", { id: p.id, name: p.name, color: p.color, text: r.text, t: now, masked: !!r.reason });
    });

    // ---- proposals (walk up → challenge → accept → table) ----
    this.onMessage("propose", (client, raw: { to?: unknown; game?: unknown; stake?: unknown }) => {
      const me = this.users.get(client.sessionId);
      const target = typeof raw?.to === "string" ? this.clients.find((c) => c.sessionId === raw.to) : undefined;
      if (!me) return client.send("proposal-failed", { reason: "LOGIN_REQUIRED" });
      if (!target || target.sessionId === client.sessionId || !this.users.get(target.sessionId)) return client.send("proposal-failed", { reason: "PLAYER_UNAVAILABLE" });
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
      const fromClient = this.clients.find((c) => c.sessionId === p.from);
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

  override onJoin(client: Client, options: { name?: unknown; color?: unknown; level?: unknown; look?: unknown; bodyType?: unknown } = {}, auth?: UserClaims | true): void {
    const claims = auth && auth !== true ? auth : null;
    if (claims) this.users.set(client.sessionId, claims);
    const look = claims?.look ?? options.look;
    const player: WorldPlayer = {
      id: client.sessionId,
      name: sanitizeName(claims?.name || options.name),
      color: claims?.color ?? (typeof options.color === "string" && COLOR.test(options.color) ? options.color : "#3DA9FC"),
      level: claims?.lvl ?? Math.max(1, Math.min(100, Number(options.level) || 1)),
      x: Math.round((this.players.size % 5) * 120 - 240),
      z: 1600,
      yaw: 0,
      anim: 0,
      look: typeof look === "string" && LOOK.test(look) ? look : undefined,
      bodyType: ["feminine", "masculine", "neutral"].includes(String(claims?.bt ?? options.bodyType)) ? String(claims?.bt ?? options.bodyType) : undefined,
      verified: !!claims,
    };
    this.players.set(client.sessionId, player);
    client.send("snapshot", { you: player.id, players: [...this.players.values()] });
    this.broadcast("joined", player, { except: client });
  }

  override onLeave(client: Client): void {
    const me = this.users.get(client.sessionId);
    if (me) quickMatch.leave(me.sub);
    for (const [id, p] of this.proposals) if (p.from === client.sessionId || p.to === client.sessionId) this.proposals.delete(id);
    this.players.delete(client.sessionId);
    this.users.delete(client.sessionId);
    this.lastChat.delete(client.sessionId);
    this.broadcast("left", { id: client.sessionId });
  }
}
