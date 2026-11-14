import { Injectable } from "@nestjs/common";

/** A realtime room snapshot older than this is dropped (realtime re-sends every 10 s and on change). */
export const PRESENCE_STALE_MS = 30_000;

export interface RoomPresence {
  concourse: number;
  seats: number;
  /** signed-in user ids inside (attendance; never shown publicly) */
  inside: string[];
}

/** People inside the arena, as reported by realtime arena rooms (POST /internal/arena/occupancy). In memory. */
@Injectable()
export class ArenaPresence {
  private rooms = new Map<string, RoomPresence & { at: number }>();

  report(room: string, p: RoomPresence, now = Date.now()): void {
    if (!p.concourse && !p.seats && !p.inside.length) this.rooms.delete(room);
    else this.rooms.set(room, { ...p, at: now });
  }

  private live(now: number) {
    for (const [k, v] of this.rooms) if (now - v.at > PRESENCE_STALE_MS) this.rooms.delete(k);
    return [...this.rooms.values()];
  }

  totals(now = Date.now()): { concourse: number; seats: number } {
    return this.live(now).reduce((a, r) => ({ concourse: a.concourse + r.concourse, seats: a.seats + r.seats }), {
      concourse: 0,
      seats: 0,
    });
  }

  inside(now = Date.now()): Set<string> {
    return new Set(this.live(now).flatMap((r) => r.inside));
  }
}
