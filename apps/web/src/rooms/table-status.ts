import { HELD_SEAT, reservedFor } from "@gukirana/contracts";
import type { HallLayout, Seat, Table } from "./layouts";

/**
 * Table status from the server-claimed hall seats (world-room `seats`: seatId → sessionId) and your own quick-match
 * state. Read-only: no protocol of its own.
 * - free:    nobody sits at the table
 * - waiting: one player sits there (waiting for an opponent — sit down to play them)
 * - playing: every chair is taken (a match in progress)
 * - held:    nobody sits there now, but a chair is kept for a player who lost their connection (P2-NET-06)
 */
export type TableStatus = "free" | "waiting" | "playing" | "held";

/** Muted status colours (tone-mapped, never above the bloom threshold): read clearly, never glare. */
export const STATUS_COLOR: Record<TableStatus, string> = {
  free: "#3fae74",
  waiting: "#d39a3a",
  playing: "#5f86d8",
  // warm grey-amber: taken (not free), but nobody to play right now
  held: "#9a8a72",
};

export const tableNo = (id: string) => Number(id.slice(1)) + 1;

export function seatsOf(layout: HallLayout, table: string): Seat[] {
  return layout.seats.filter((s) => s.table === table);
}

export function tableStatuses(layout: HallLayout, seats: Record<string, string>): Record<string, TableStatus> {
  const out: Record<string, TableStatus> = {};
  for (const t of layout.tables) {
    const mine = seatsOf(layout, t.id);
    const taken = mine.filter((s) => seats[s.id]).length;
    const held = mine.filter((s) => seats[s.id] === HELD_SEAT).length;
    out[t.id] = taken === 0 ? "free" : held === taken ? "held" : taken >= mine.length ? "playing" : "waiting";
  }
  return out;
}

/** a chair the server keeps for this account (matched, on the way to the table, P2-MM-05) */
export const reservedForMe = (holder: string | undefined, uid: string | null | undefined) => !!uid && reservedFor(holder) === uid;

/**
 * The free chair of `table` closest to (x, z), or null when all are taken (your own chair counts as free). A chair
 * reserved for you (`uid`, P2-MM-05) is always the one.
 */
export function freeChair(layout: HallLayout, table: string, seats: Record<string, string>, you: string | null, x: number, z: number, uid?: string | null): Seat | null {
  const kept = seatsOf(layout, table).find((s) => reservedForMe(seats[s.id], uid));
  if (kept) return kept;
  let best: Seat | null = null;
  let bd = Infinity;
  for (const s of seatsOf(layout, table)) {
    const holder = seats[s.id];
    if (holder && holder !== you) continue;
    const d = Math.hypot(s.x - x, s.z - z);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

/** Nearest table with the wanted status (by walking distance estimate), or null. */
export function nearestTable(layout: HallLayout, st: Record<string, TableStatus>, want: TableStatus, x: number, z: number): Table | null {
  let best: Table | null = null;
  let bd = Infinity;
  for (const t of layout.tables) {
    if (st[t.id] !== want) continue;
    const d = Math.abs(t.x - x) + Math.abs(t.z - z); // aisles run on a grid: Manhattan reads closer to the walk
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  return best;
}

/** The table whose footprint (plus `margin`) contains (x, z). */
export function tableAt(layout: HallLayout, x: number, z: number, margin = 0.35): Table | null {
  return layout.tables.find((t) => Math.abs(x - t.x) < t.w / 2 + margin && Math.abs(z - t.z) < t.d / 2 + margin) ?? null;
}
