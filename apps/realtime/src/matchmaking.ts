import { matchMaker } from "@colyseus/core";
import { api } from "./api-client.js";

export const GAMES = ["igisoro", "ludo"] as const;
export type GameId = (typeof GAMES)[number];
export const STAKES = [0, 25, 50, 100, 200] as const;

export const isGame = (g: unknown): g is GameId => typeof g === "string" && (GAMES as readonly string[]).includes(g);
export const isStake = (s: unknown): s is number => typeof s === "number" && (STAKES as readonly number[]).includes(s);

const SEATS: Record<GameId, [number, number]> = { igisoro: [0, 1], ludo: [0, 2] };

/** Creates the API match (locks Stars in escrow) and the authoritative room. */
export async function startMatch(game: GameId, stake: number, userIds: [string, string]): Promise<{ roomId: string; matchId: string }> {
  const seats = SEATS[game];
  const created = await api.createMatch({ game, variant: "classic", stake, players: userIds.map((userId, i) => ({ userId, seat: seats[i]! })) });
  const room = await matchMaker.createRoom("match", { matchId: created.matchId, game, variant: "classic", stake, players: created.players });
  return { roomId: room.roomId, matchId: created.matchId };
}

interface Waiting {
  userId: string;
  notify: (event: string, payload: unknown) => void;
  since: number;
}

/** Quick Match queue (in-process for now; moves to Valkey in P1-MM-01). */
class QuickMatchQueue {
  private queues = new Map<string, Waiting[]>();

  join(game: GameId, stake: number, w: Waiting): Waiting | null {
    const key = `${game}:${stake}`;
    const q = (this.queues.get(key) ?? []).filter((x) => x.userId !== w.userId);
    const other = q.shift();
    if (other) {
      this.queues.set(key, q);
      return other;
    }
    q.push(w);
    this.queues.set(key, q);
    return null;
  }

  leave(userId: string): void {
    for (const [k, q] of this.queues) this.queues.set(k, q.filter((x) => x.userId !== userId));
  }
}

export const quickMatch = new QuickMatchQueue();
