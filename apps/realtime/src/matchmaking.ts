import { matchMaker } from "@colyseus/core";
import { api } from "./api-client.js";
import { reportRoom } from "./rooms/match-room.js";

export const GAMES = ["igisoro", "ludo", "pool"] as const;
export type GameId = (typeof GAMES)[number];
/** the default stakes (the API's per-game settings decide which are allowed: STAKE_NOT_ALLOWED otherwise) */
export const STAKES = [0, 25, 50, 100, 200] as const;

export const isGame = (g: unknown): g is GameId => typeof g === "string" && (GAMES as readonly string[]).includes(g);
/** a well-formed stake (0 = friendly); whether this game allows it is the API's call (game_settings, P1-GAME-06) */
export const isStake = (s: unknown): s is number => typeof s === "number" && Number.isSafeInteger(s) && s >= 0 && s <= 10_000;

const SEATS: Record<GameId, [number, number]> = { igisoro: [0, 1], ludo: [0, 2], pool: [0, 1] };

/** Creates the API match (locks Stars in escrow) and the authoritative room. */
export async function startMatch(game: GameId, stake: number, userIds: [string, string]): Promise<{ roomId: string; matchId: string }> {
  const seats = SEATS[game];
  const created = await api.createMatch({ game, variant: "classic", stake, players: userIds.map((userId, i) => ({ userId, seat: seats[i]! })) });
  // the room runs with the rules the API copied onto the match (running matches keep them when an admin edits)
  const room = await matchMaker.createRoom("match", { matchId: created.matchId, game, variant: "classic", stake, players: created.players, rules: created.rules });
  reportRoom(created.matchId, room.roomId); // P2-NET-05: a reload / another device finds the room through the API
  return { roomId: room.roomId, matchId: created.matchId };
}

interface Waiting {
  userId: string;
  notify: (event: string, payload: unknown) => void;
  since: number;
}

/** Quick Match queue (in-process for now; moves to Valkey in P1-MM-01). */
export class QuickMatchQueue {
  private queues = new Map<string, Waiting[]>();

  join(game: GameId, stake: number, w: Waiting): Waiting | null {
    // one queue per person: switching game or stake replaces the old ticket (never matched twice)
    this.leave(w.userId);
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

  /** People waiting for this game and stake (lobby counters, tests). */
  size(game: GameId, stake: number): number {
    return this.queues.get(`${game}:${stake}`)?.length ?? 0;
  }
}

export const quickMatch = new QuickMatchQueue();
