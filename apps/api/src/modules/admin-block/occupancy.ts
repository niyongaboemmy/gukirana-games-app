import { Injectable } from "@nestjs/common";

/** A room snapshot older than this is dropped (realtime re-sends every 30 s and on every change). */
export const OCCUPANCY_STALE_MS = 90_000;

/**
 * Staff inside each office, as reported by realtime admin-block rooms (POST /internal/admin-block/occupancy).
 * In memory: one snapshot per realtime room, summed; stale snapshots (room gone / realtime restarted) expire.
 */
@Injectable()
export class OccupancyStore {
  private rooms = new Map<string, { at: number; offices: Record<string, number> }>();

  report(room: string, offices: Record<string, number>, now = Date.now()): void {
    if (!Object.keys(offices).length) this.rooms.delete(room);
    else this.rooms.set(room, { at: now, offices });
  }

  totals(now = Date.now()): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [room, s] of this.rooms) {
      if (now - s.at > OCCUPANCY_STALE_MS) {
        this.rooms.delete(room);
        continue;
      }
      for (const [office, n] of Object.entries(s.offices)) out[office] = (out[office] ?? 0) + n;
    }
    return out;
  }
}
