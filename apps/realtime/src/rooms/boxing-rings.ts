import { FEATURE_RINGS, RING_IDS, type RingId } from "@gukirana/contracts";

/**
 * Where the 50 rings stand in the Boxing hall (hall coordinates, metres), for the server's reach check (FIGHT-GAMES-PLAN
 * §7.1 `TOO_FAR`). The numbers mirror the web floor plan (apps/web/src/fight/plan.ts `RINGS`: 93 × 30 m hall, ring
 * pitch 6.2 × 6.4 m, R1 / R2 on the feature stage, R3–R50 row by row from the west). If the web plan moves a ring,
 * move it here too; a few metres of slack are in RING_REACH_M.
 */
const HALL_W = 93;
const MARGIN = 1.0;
const PLATFORM = 4.9;
const FEATURE_PLATFORM = 6.7;
const PITCH_X = 6.2;
const ROW_Z = [9.5, 3.1, -3.3, -9.7];
const FEATURE_Z: Record<(typeof FEATURE_RINGS)[number], number> = { R1: 4.4, R2: -6.2 };

export interface RingSpot {
  x: number;
  z: number;
  /** half the platform size */
  half: number;
}

export const RING_SPOTS: Record<RingId, RingSpot> = (() => {
  const out: Record<string, RingSpot> = {};
  for (const id of FEATURE_RINGS) out[id] = { x: 0, z: FEATURE_Z[id], half: FEATURE_PLATFORM / 2 };
  const x0 = -HALL_W / 2 + MARGIN + PLATFORM / 2;
  const west = Array.from({ length: 6 }, (_, c) => x0 + c * PITCH_X);
  const east = Array.from({ length: 6 }, (_, c) => -x0 - (5 - c) * PITCH_X);
  let n = 3;
  for (const z of ROW_Z) for (const x of [...west, ...east]) out[`R${n++}`] = { x, z, half: PLATFORM / 2 };
  if (Object.keys(out).length !== RING_IDS.length) throw new Error("ring spots do not match RING_IDS");
  return out as Record<RingId, RingSpot>;
})();

/** distance (m) from a point to the ring's platform edge (0 = on / inside it) */
export function distanceToRing(id: RingId, x: number, z: number): number {
  const r = RING_SPOTS[id];
  const dx = Math.max(0, Math.abs(x - r.x) - r.half);
  const dz = Math.max(0, Math.abs(z - r.z) - r.half);
  return Math.hypot(dx, dz);
}
