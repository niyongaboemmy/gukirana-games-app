import { FEATURE_RINGS, RING_IDS, type RingId } from "@gukirana/contracts";

/**
 * Where the rings stand in the Boxing hall (hall coordinates, metres), for the server's reach check (FIGHT-GAMES-PLAN
 * §7.1 `TOO_FAR`). The numbers mirror the web floor plan (apps/web/src/fight/plan.ts `RINGS`; its plan.test checks
 * that both agree ring by ring). P3-FGT-11: a 96.4 × 32.4 m hall with aisles two people wide — two blocks of
 * 5 columns × 3 rows on a 7.8 × 9.0 m pitch (inner columns at |x| = 11.9, rows A–C at z 8.3 / −0.7 / −9.7), R1 / R2
 * on the feature stage at z 4.6 / −5.4, R3–R32 row by row from the west. If the web plan moves a ring, move it here
 * too; a few metres of slack are in RING_REACH_M.
 */
const PLATFORM = 4.9;
const FEATURE_PLATFORM = 6.9;
const PITCH_X = 7.8;
const INNER_X = 11.9;
const BLOCK_COLS = 5;
const ROW_Z = [8.3, -0.7, -9.7];
const FEATURE_Z: Record<(typeof FEATURE_RINGS)[number], number> = { R1: 4.6, R2: -5.4 };

export interface RingSpot {
  x: number;
  z: number;
  /** half the platform size */
  half: number;
}

export const RING_SPOTS: Record<RingId, RingSpot> = (() => {
  const out: Record<string, RingSpot> = {};
  for (const id of FEATURE_RINGS) out[id] = { x: 0, z: FEATURE_Z[id], half: FEATURE_PLATFORM / 2 };
  const west = Array.from({ length: BLOCK_COLS }, (_, c) => -INNER_X - (BLOCK_COLS - 1 - c) * PITCH_X);
  const east = Array.from({ length: BLOCK_COLS }, (_, c) => INNER_X + c * PITCH_X);
  let n = 3;
  for (const z of ROW_Z) for (const x of [...west, ...east]) out[`R${n++}`] = { x, z, half: PLATFORM / 2 };
  if (Object.keys(out).length !== RING_IDS.length) throw new Error("ring spots do not match RING_IDS");
  return out as Record<RingId, RingSpot>;
})();

/** distance (m) from a point to the ring's platform edge (0 = on / inside it) */
export function distanceToRing(id: RingId, x: number, z: number): number {
  const r = RING_SPOTS[id]!;
  const dx = Math.max(0, Math.abs(x - r.x) - r.half);
  const dz = Math.max(0, Math.abs(z - r.z) - r.half);
  return Math.hypot(dx, dz);
}
