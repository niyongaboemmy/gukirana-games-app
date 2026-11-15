import { cornerKit, dimsOf, toHall } from "@/rooms/fight/ring-kit-core";
import { FEATURE_STAGE, RINGS, type RingPlace } from "./plan";
import { kitSpec } from "./climb";

/**
 * Boxing hall fixture colliders (P3-FGT-08), pure data + a point test on a spatial grid (no physics engine):
 *  - ring-side kit on the floor: each fighter corner's parked stool and its bucket / spit bucket / bottle group;
 *  - the spectator rail round the feature stage (it used to be walked through).
 * (The judges' tables stand on the feature stage, which is solid for everyone but the feature fighters.)
 * The hall controller refuses a step into any of them (fight/hooks boxingWalkable) and slides along the edge, like
 * the ring platforms. Discs and segments carry their own radius; `pad` is the walker's body radius.
 */

export interface Disc {
  x: number;
  z: number;
  r: number;
}
export interface Seg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  r: number;
}

/** a ring's corner floor kit in hall coordinates (ring-kit-core cornerKit: stool, buckets, bottles) */
export const cornerKitHall = (r: RingPlace, c: "red" | "blue") => {
  const spec = kitSpec(r);
  return cornerKit(dimsOf(spec), c).map((it) => ({ ...it, ...toHall(spec, it.lx, 0, it.lz) }));
};

/** one disc per piece of every standard ring's corner kit (its footprint + 3 cm) */
export const HALL_DISCS: Disc[] = (() => {
  const out: Disc[] = [];
  for (const r of RINGS) {
    if (r.feature) continue; // the feature rings' corners are on the stage (solid for everyone but the fighters)
    for (const c of ["red", "blue"] as const) for (const it of cornerKitHall(r, c)) out.push({ x: it.x, z: it.z, r: it.r + 0.03 });
  }
  return out;
})();

/** the feature stage's spectator rail (FeatureStage in BoxingHallScene: sides at ±(hw + 0.9), the front at z0 + 0.9) */
export const HALL_SEGS: Seg[] = (() => {
  const s = FEATURE_STAGE;
  const R = s.hw + 0.9;
  const cz = (s.z0 + s.z1) / 2;
  const half = (s.z0 - s.z1 + 1.8) / 2;
  return [
    { ax: -R, az: cz - half, bx: -R, bz: cz + half, r: 0.05 },
    { ax: R, az: cz - half, bx: R, bz: cz + half, r: 0.05 },
    { ax: -R, az: s.z0 + 0.9, bx: R, bz: s.z0 + 0.9, r: 0.05 },
  ];
})();

/* ---------------- spatial grid ---------------- */

const CELL = 2;
const key = (i: number, j: number) => i * 4096 + j;
const grid = new Map<number, { discs: Disc[]; segs: Seg[] }>();
const cellOf = (x: number, z: number) => [Math.floor(x / CELL), Math.floor(z / CELL)] as const;
function insert(x0: number, z0: number, x1: number, z1: number, f: (c: { discs: Disc[]; segs: Seg[] }) => void) {
  const [i0, j0] = cellOf(x0, z0);
  const [i1, j1] = cellOf(x1, z1);
  for (let i = i0; i <= i1; i++)
    for (let j = j0; j <= j1; j++) {
      const k = key(i, j);
      let c = grid.get(k);
      if (!c) grid.set(k, (c = { discs: [], segs: [] }));
      f(c);
    }
}
const MAXPAD = 0.5;
for (const d of HALL_DISCS) insert(d.x - d.r - MAXPAD, d.z - d.r - MAXPAD, d.x + d.r + MAXPAD, d.z + d.r + MAXPAD, (c) => c.discs.push(d));
for (const s of HALL_SEGS) insert(Math.min(s.ax, s.bx) - MAXPAD, Math.min(s.az, s.bz) - MAXPAD, Math.max(s.ax, s.bx) + MAXPAD, Math.max(s.az, s.bz) + MAXPAD, (c) => c.segs.push(s));

const segDist = (s: Seg, x: number, z: number) => {
  const vx = s.bx - s.ax,
    vz = s.bz - s.az;
  const t = Math.max(0, Math.min(1, ((x - s.ax) * vx + (z - s.az) * vz) / (vx * vx + vz * vz || 1)));
  return Math.hypot(x - (s.ax + vx * t), z - (s.az + vz * t));
};

/** is (x, z) inside a fixture (grown by the walker's body radius `pad`, ≤ 0.5 m)? */
export function fixtureBlocks(x: number, z: number, pad = 0.22): boolean {
  const [i, j] = cellOf(x, z);
  const c = grid.get(key(i, j));
  if (c) {
    for (const d of c.discs) if (Math.hypot(x - d.x, z - d.z) < d.r + pad) return true;
    for (const s of c.segs) if (segDist(s, x, z) < s.r + pad) return true;
  }
  return false;
}
