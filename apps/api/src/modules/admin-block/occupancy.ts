import { Injectable } from "@nestjs/common";

/** A room snapshot older than this is dropped (realtime re-sends every 30 s and on every change). */
export const OCCUPANCY_STALE_MS = 90_000;

/**
 * Staff inside each office (and, since P2-ADM-04, the visitors let in), as reported by realtime admin-block rooms
 * (POST /internal/admin-block/occupancy). In memory: one snapshot per realtime room, summed; stale snapshots (room
 * gone / realtime restarted) expire. Counts only: no session, user or name ever reaches this store.
 */
@Injectable()
export class OccupancyStore {
  private rooms = new Map<string, { at: number; offices: Record<string, number>; visitors: Record<string, number> }>();

  report(room: string, offices: Record<string, number>, now = Date.now(), visitors: Record<string, number> = {}): void {
    if (!Object.keys(offices).length) this.rooms.delete(room);
    else this.rooms.set(room, { at: now, offices, visitors });
  }

  private sum(pick: "offices" | "visitors", now: number): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [room, s] of this.rooms) {
      if (now - s.at > OCCUPANCY_STALE_MS) {
        this.rooms.delete(room);
        continue;
      }
      for (const [office, n] of Object.entries(s[pick])) out[office] = (out[office] ?? 0) + n;
    }
    return out;
  }

  /** staff per office */
  totals(now = Date.now()): Record<string, number> {
    return this.sum("offices", now);
  }
  /** visitors (let in) per office */
  visitors(now = Date.now()): Record<string, number> {
    return this.sum("visitors", now);
  }
}
