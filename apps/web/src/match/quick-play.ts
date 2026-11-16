import type { VenueStatus } from "@gukirana/contracts";
import { HALLS } from "@/rooms/layouts";
import { RINGS } from "@/fight/plan";
import type { GameId } from "@/lib/match-store";

/**
 * Quick Play (P2-MM-05): the places of a game's hall in the order the picker shows them, the "nearest free" default,
 * and the stakes a widened search adds. Pure: the sheet (match/MatchmakingV2) renders it.
 */
export interface Place {
  id: string;
  /** "1" … "16" (tables) / "1" … "32" (rings) */
  n: string;
  x: number;
  z: number;
  /** grid cell for the mini-map */
  col: number;
  row: number;
}

const HALL_OF: Record<GameId, "igisoro" | "ludo" | "pool" | "boxing"> = { igisoro: "igisoro", ludo: "ludo", pool: "pool", boxing: "boxing" };
export const hallOf = (g: GameId) => HALL_OF[g];
export const hallTitle = (g: GameId) => HALLS[HALL_OF[g]].title;

export function placesOf(game: GameId): Place[] {
  const raw = game === "boxing" ? RINGS.map((r) => ({ id: r.id, n: r.id.slice(1), x: r.x, z: r.z })) : HALLS[HALL_OF[game]].tables.map((t) => ({ id: t.id, n: String(Number(t.id.slice(1)) + 1), x: t.x, z: t.z }));
  const xs = [...new Set(raw.map((p) => p.x))].sort((a, b) => a - b);
  const zs = [...new Set(raw.map((p) => p.z))].sort((a, b) => a - b);
  return raw.map((p) => ({ ...p, col: xs.indexOf(p.x), row: zs.indexOf(p.z) }));
}

export const isFree = (st: VenueStatus | undefined) => !st || st === "free";

/**
 * The default place: the free one nearest to `me` (when I am in that hall), else the free one nearest the hall door
 * (the walk in is shortest). null when every place is taken.
 */
export function nearestFree(game: GameId, statuses: Record<string, VenueStatus>, me?: { x: number; z: number } | null): string | null {
  const hall = HALLS[HALL_OF[game]];
  const from = me ?? { x: hall.door.x, z: hall.size.d / 2 };
  let best: string | null = null;
  let bd = Infinity;
  for (const p of placesOf(game)) {
    if (!isFree(statuses[p.id])) continue;
    const d = Math.abs(p.x - from.x) + Math.abs(p.z - from.z);
    if (d < bd) {
      bd = d;
      best = p.id;
    }
  }
  return best;
}

/**
 * Stakes to add when widening a search that found nobody (asked first): the neighbours of the picked stake among the
 * ones I may play, then Friendly — never more than 5 in all.
 */
export function widerStakes(current: number[], playable: number[]): number[] {
  const sorted = [...new Set(playable)].sort((a, b) => a - b);
  const base = current[0] ?? 0;
  const i = sorted.indexOf(base);
  // the next stake up, the next one down, then Friendly (only stakes I may play)
  const near = (i < 0 ? [0] : [sorted[i + 1], sorted[i - 1], 0]).filter((s): s is number => s !== undefined && sorted.includes(s));
  return [...new Set([...current, ...near])].slice(0, 5);
}

export const stakeWords = (stakes: number[], friendly: string) => stakes.map((s) => (s === 0 ? friendly : `${s} Stars`)).join(", ");
