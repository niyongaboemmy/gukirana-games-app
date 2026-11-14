import { Injectable } from "@nestjs/common";
import type { PresenceTotals } from "@gukirana/contracts";

/** A room report older than this is dropped (realtime reports every 15 s and when people join / leave). */
export const PRESENCE_STALE_MS = 60_000;

/** People online per area, summed over realtime world rooms (POST /internal/presence). In memory, counts only. */
@Injectable()
export class PresenceStore {
  private rooms = new Map<string, { at: number; area: string; count: number; signedIn: number }>();

  report(room: string, area: string, count: number, signedIn: number, now = Date.now()): void {
    if (count <= 0) this.rooms.delete(room);
    else this.rooms.set(room, { at: now, area, count, signedIn: Math.min(signedIn, count) });
  }

  totals(now = Date.now()): PresenceTotals {
    const out: PresenceTotals = { total: 0, signedIn: 0, byArea: {} };
    for (const [room, r] of this.rooms) {
      if (now - r.at > PRESENCE_STALE_MS) {
        this.rooms.delete(room);
        continue;
      }
      out.total += r.count;
      out.signedIn += r.signedIn;
      out.byArea[r.area] = (out.byArea[r.area] ?? 0) + r.count;
    }
    return out;
  }
}
