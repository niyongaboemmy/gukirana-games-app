import { Room, type Client } from "@colyseus/core";
import { WorldMoveSchema } from "@gukirana/contracts";
import { filterChat, sanitizeName } from "../chat-filter.js";

export interface WorldPlayer {
  id: string;
  name: string;
  color: string;
  level: number;
  x: number; // centimetres
  z: number;
  yaw: number; // 0–65535
  anim: number; // 0 idle, 1 walk, 2 run, 10+ emotes
}

const COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Plaza / room presence (SRS §8.4, plan P1-WLD-01 skeleton).
 * - snapshot on join, join / leave / move / emote / chat broadcasts
 * - validated input, chat filter, per-client chat rate limit
 * Interest management and instance fill rules come with the full P1-WLD-01.
 */
export class WorldRoom extends Room {
  override maxClients = 50;
  private players = new Map<string, WorldPlayer>();
  private lastChat = new Map<string, number>();

  override onCreate(): void {
    this.onMessage("move", (client, raw: unknown) => {
      const parsed = WorldMoveSchema.safeParse(raw);
      const p = this.players.get(client.sessionId);
      if (!parsed.success || !p) return;
      const m = parsed.data;
      // clamp to the plaza bounds (±40 m)
      p.x = Math.max(-4000, Math.min(4000, m.x));
      p.z = Math.max(-4000, Math.min(4000, m.z));
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
      if (now - (this.lastChat.get(client.sessionId) ?? 0) < 800) return; // rate limit
      this.lastChat.set(client.sessionId, now);
      const r = filterChat(raw.text);
      if (r.blocked) {
        client.send("chat-warning", { reason: r.reason });
        return;
      }
      if (!r.text) return;
      this.broadcast("chat", { id: p.id, name: p.name, color: p.color, text: r.text, t: now, masked: !!r.reason });
    });
  }

  override onJoin(client: Client, options: { name?: unknown; color?: unknown; level?: unknown } = {}): void {
    const player: WorldPlayer = {
      id: client.sessionId,
      name: sanitizeName(options.name),
      color: typeof options.color === "string" && COLOR.test(options.color) ? options.color : "#3DA9FC",
      level: Math.max(1, Math.min(100, Number(options.level) || 1)),
      x: Math.round((this.players.size % 5) * 120 - 240),
      z: 1600,
      yaw: 0,
      anim: 0,
    };
    this.players.set(client.sessionId, player);
    client.send("snapshot", { you: player.id, players: [...this.players.values()] });
    this.broadcast("joined", player, { except: client });
  }

  override onLeave(client: Client): void {
    this.players.delete(client.sessionId);
    this.lastChat.delete(client.sessionId);
    this.broadcast("left", { id: client.sessionId });
  }
}
