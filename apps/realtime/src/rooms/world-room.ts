import { Room, type Client } from "@colyseus/core";
import { WorldMoveSchema } from "@gukirana/contracts";

/**
 * World presence room (SRS §8.4, plan P1-WLD-01). Skeleton: relays validated movement.
 * Interest management, instance caps and fill-to-70% come with P1-WLD-01.
 */
export class WorldRoom extends Room {
  override maxClients = 50;

  override onCreate(): void {
    this.onMessage("move", (client, raw: unknown) => {
      const parsed = WorldMoveSchema.safeParse(raw);
      if (!parsed.success) return; // never trust the client
      this.broadcast("move", { id: client.sessionId, ...parsed.data }, { except: client });
    });
  }

  override onJoin(client: Client): void {
    this.broadcast("joined", { id: client.sessionId }, { except: client });
  }

  override onLeave(client: Client): void {
    this.broadcast("left", { id: client.sessionId });
  }
}
