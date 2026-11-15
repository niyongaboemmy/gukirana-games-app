import { cornerKit, dimsOf, stepsReach, stepZ, STEP_HALF_W, toHall } from "@/rooms/fight/ring-kit-core";
import { kitSpec } from "./climb";
import { GYM_COLLIDERS, TRAINING_USE } from "./gym-plan";
import { BLOCK_COLS_X, BOXING_COLLIDERS, BOXING_SIZE, FEATURE_STAGE, RINGS, ROW_Z, type RingPlace } from "./plan";

/**
 * Walking clearance of the Boxing hall's aisles (P3-FGT-11), pure. Every ring, the feature stage and the wall-side
 * fixtures are reduced to axis-aligned obstacle boxes (hall coordinates) from the outermost thing that stands on the
 * floor: the barrier rail, the corner steps with their hand rails, the corner kit (stool, buckets, bottles), the
 * stage's spectator rail, the benches, lockers and the training wall's users. An aisle runs between two groups of
 * obstacles; across it, at every station 5 cm apart along it:
 *  - `clear`: the free width there (the narrowest station: what two people passing actually get, weaving round a set
 *    of steps if they must);
 *  - `band`: the straight lane free along the whole aisle (nobody has to weave).
 */

export interface Box {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}
export type AisleKind = "column" | "row" | "main" | "cross" | "back" | "end";
export interface Aisle {
  id: string;
  kind: AisleKind;
  clear: number;
  band: number;
}

const box = (x0: number, x1: number, z0: number, z1: number): Box => ({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1) });
const rect = (r: { x: number; z: number; w: number; d: number }): Box => box(r.x - r.w / 2, r.x + r.w / 2, r.z - r.d / 2, r.z + r.d / 2);
/** a ring-frame rectangle → its hall box (the rings stand turned by multiples of a quarter) */
function localBox(r: RingPlace, lx0: number, lx1: number, lz0: number, lz1: number): Box {
  const spec = kitSpec(r);
  const a = toHall(spec, lx0, 0, lz0);
  const b = toHall(spec, lx1, 0, lz1);
  return box(a.x, b.x, a.z, b.z);
}

/** a standard ring's floor obstacles: rail square (tube radius incl.), both corner steps, its corner kit */
export function ringObstacles(r: RingPlace): Box[] {
  const K = dimsOf(kitSpec(r));
  const R = K.rail + 0.025;
  const out = [localBox(r, -R, R, -R, R)];
  for (const c of ["red", "blue"] as const) {
    const s = c === "red" ? -1 : 1;
    out.push(localBox(r, s * K.half, s * (K.half + stepsReach(K)), s * (stepZ(K) - STEP_HALF_W), s * (stepZ(K) + STEP_HALF_W)));
    for (const it of cornerKit(K, c)) out.push(localBox(r, it.lx - it.r, it.lx + it.r, it.lz - it.r, it.lz + it.r));
  }
  return out;
}

/** the feature zone: the raised stage with its spectator rail (sides at ±(hw + 0.9), front at z0 + 0.9) and the
 *  announcer's stand / timekeeper's table in front of it (gym-plan VENUE, in GYM_COLLIDERS) */
export const FEATURE_OBSTACLES: Box[] = [box(-(FEATURE_STAGE.hw + 0.95), FEATURE_STAGE.hw + 0.95, FEATURE_STAGE.z1, FEATURE_STAGE.z0 + 0.95)];
const { w, d } = BOXING_SIZE;
const WALL = 1;
const SOUTH: Box[] = [box(-w / 2, w / 2, d / 2, d / 2 + WALL), box(TRAINING_USE.x0, TRAINING_USE.x1, TRAINING_USE.z0, TRAINING_USE.z1)];
const NORTH: Box[] = [box(-w / 2, w / 2, -d / 2 - WALL, -d / 2)];
const WEST_WALL = [box(-w / 2 - WALL, -w / 2, -d / 2, d / 2)];
const EAST_WALL = [box(w / 2, w / 2 + WALL, -d / 2, d / 2)];
/** fixtures along the walls: benches and lockers (BOXING_COLLIDERS), the training wall and the venue props */
for (const c of [...BOXING_COLLIDERS, ...GYM_COLLIDERS]) {
  const b = rect(c);
  if (c.z > FEATURE_STAGE.z0 && c.z < FEATURE_STAGE.z0 + 2.5 && Math.abs(c.x) < FEATURE_STAGE.hw + 1) FEATURE_OBSTACLES.push(b);
  else (c.z > 0 ? SOUTH : NORTH).push(b);
}

/**
 * The free width between obstacle groups `low` (towards −axis) and `high` (+axis), across `axis`, sampled every 5 cm
 * along the other axis from `from` to `to`; stations where either side has nothing are open floor (skipped).
 */
export function clearance(low: Box[], high: Box[], axis: "x" | "z", from: number, to: number, step = 0.05): { clear: number; band: number } {
  let clear = Infinity;
  let lowMax = -Infinity;
  let highMin = Infinity;
  for (let s = from; s <= to + 1e-9; s += step) {
    let lo = -Infinity;
    let hi = Infinity;
    for (const b of low) if (axis === "x" ? b.z0 < s && s < b.z1 : b.x0 < s && s < b.x1) lo = Math.max(lo, axis === "x" ? b.x1 : b.z1);
    for (const b of high) if (axis === "x" ? b.z0 < s && s < b.z1 : b.x0 < s && s < b.x1) hi = Math.min(hi, axis === "x" ? b.x0 : b.z0);
    if (lo === -Infinity || hi === Infinity) continue;
    clear = Math.min(clear, hi - lo);
    lowMax = Math.max(lowMax, lo);
    highMin = Math.min(highMin, hi);
  }
  return { clear, band: highMin - lowMax };
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const standard = RINGS.filter((r) => !r.feature);
const at = (pred: (r: RingPlace) => boolean) => standard.filter(pred).flatMap(ringObstacles);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** every aisle of the hall with its clear width and straight band (m, rounded to cm) */
export function hallAisles(): Aisle[] {
  const out: Aisle[] = [];
  const push = (id: string, kind: AisleKind, c: { clear: number; band: number }) => out.push({ id, kind, clear: r2(c.clear), band: r2(c.band) });
  for (const [side, cols] of Object.entries(BLOCK_COLS_X)) {
    const x0 = Math.min(...cols) - 4;
    const x1 = Math.max(...cols) + 4;
    // between neighbouring columns (all rows)
    for (let i = 0; i + 1 < cols.length; i++) push(`${side} col ${i + 1}|${i + 2}`, "column", clearance(at((r) => near(r.x, cols[i]!)), at((r) => near(r.x, cols[i + 1]!)), "x", -d / 2, d / 2));
    // between neighbouring rows (ROW_Z runs front → back: +z → −z)
    for (let k = 0; k + 1 < ROW_Z.length; k++)
      push(`${side} row ${k + 1}|${k + 2}`, "row", clearance(at((r) => near(r.z, ROW_Z[k + 1]!) && cols.some((c) => near(c, r.x))), at((r) => near(r.z, ROW_Z[k]!) && cols.some((c) => near(c, r.x))), "z", x0, x1));
  }
  // main aisles: the inner columns ↔ the feature zone
  const wIn = Math.max(...BLOCK_COLS_X.west);
  const eIn = Math.min(...BLOCK_COLS_X.east);
  push("west main", "main", clearance(at((r) => near(r.x, wIn)), FEATURE_OBSTACLES, "x", -d / 2, d / 2));
  push("east main", "main", clearance(FEATURE_OBSTACLES, at((r) => near(r.x, eIn)), "x", -d / 2, d / 2));
  // the front cross aisle (row A and the stage front ↔ the south wall fixtures) and the back aisle
  push("front cross", "cross", clearance([...at((r) => near(r.z, ROW_Z[0]!)), ...FEATURE_OBSTACLES], SOUTH, "z", -w / 2, w / 2));
  push("back", "back", clearance(NORTH, [...at((r) => near(r.z, ROW_Z[ROW_Z.length - 1]!)), ...FEATURE_OBSTACLES], "z", -w / 2, w / 2));
  // end strips: the end walls ↔ the outer columns
  push("west end", "end", clearance(WEST_WALL, at((r) => near(r.x, Math.min(...BLOCK_COLS_X.west))), "x", -d / 2, d / 2));
  push("east end", "end", clearance(at((r) => near(r.x, Math.max(...BLOCK_COLS_X.east))), EAST_WALL, "x", -d / 2, d / 2));
  return out;
}
