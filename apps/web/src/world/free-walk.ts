import { DOOR_RING, ENTRY_Z, PERIMETER_R, PLAZA_RADIUS, ringPoint } from "./layout";
import { inBuilding, PLOTS } from "./footprints";
import { AVENUE_BEDS, LAWN_BEDS } from "./beds";
import { campusTrees, GUARD_POSTS, hash01, inCompound, MOTO_BAYS, nearCampusWalk, PARKING, PARKING_BAYS, STREET_LIGHTS, WALK_TOTEMS, type P } from "./campus";
import { WALK_PROPS } from "./walk-mesh";
import { BODY_RADIUS, circle, GATE_OBSTACLES, rect, resolve, type Obstacle } from "./obstacles";
import { GATE_Z, WARDROBE } from "./gate/Gate";

/**
 * Walk anywhere in the compound (P2-WLD-16): the lawns between the walks are open ground; what stops a person is
 * what is really solid — the buildings (footprints.ts), the plaza's low lava walls, beds and planters, trees, lamp
 * posts, benches, bins, totems, parked cars, the gates' walls and booths — and the compound's boundary wall
 * (campus.ts inCompound). Static obstacles live in a spatial hash grid (8 m cells), so a step costs a handful of
 * checks wherever you are. Tap-to-walk on open ground: a straight line when it is clear, otherwise a route round
 * the obstacles (A* on a 1 m grid over the area between the two points, string-pulled). Pure: no three.js.
 */

export { FREE_WALK_ON } from "./campus";

/** Distance (m) kept from the compound's boundary wall. */
export const WALL_MARGIN = 0.6;

/* ---------------------------------------------------------------- the plaza's lava walls ---------------------------------------------------------------- */

/**
 * The low black lava-rock walls between the buildings round the plaza (3.6 m stones every STEP degrees on
 * PERIMETER_R), kept clear of the doors, the buildings, the entry gate's own walls and the campus walks' mouths.
 * District.ts draws exactly these stones; here they are solid.
 */
export const PERIMETER_STONES: (P & { rotY: number })[] = (() => {
  const out: (P & { rotY: number })[] = [];
  const STEP = (3.6 / PERIMETER_R) * (180 / Math.PI);
  const DOOR_GAP = (7.1 / PERIMETER_R) * (180 / Math.PI);
  const builder = (deg: number) => {
    for (const s of [-1.8, 0, 1.8]) {
      const w = ringPoint(deg + STEP / 2, PERIMETER_R);
      const o = ringPoint(deg + STEP / 2 + 90, s);
      if (inBuilding(w.x + o.x, w.z + o.z, 1)) return true;
    }
    return false;
  };
  const off = (deg: number, a: number) => Math.abs(((deg + STEP / 2 - a + 540) % 360) - 180);
  for (let deg = -180; deg < 180; deg += STEP) {
    const near = PLOTS.some((q) => q.ring === DOOR_RING && off(deg, q.angleDeg) < DOOR_GAP);
    const p = ringPoint(deg + STEP / 2, PERIMETER_R);
    const gate = p.z > ENTRY_Z - 6 && Math.abs(p.x) < 17.5; // the entry gate has its own perimeter walls
    if (near || gate || builder(deg) || nearCampusWalk(p.x, p.z, 2.2)) continue;
    out.push({ x: p.x, z: p.z, rotY: p.rotY });
  }
  return out;
})();

/* ---------------------------------------------------------------- the buildings ---------------------------------------------------------------- */

/** One footprint rectangle of a building in the world (its plot id: a door opening lets you through its own). */
export type BuildingRect = Extract<Obstacle, { kind: "rect" }> & { plot: string };
/**
 * Building footprints as world rectangles. The plaza-ring halls' canopy fronts reach over the plaza's edge: their
 * solid part stops at the plaza edge (local z ≤ DOOR_RING − PLAZA_RADIUS), as the plaza edge stopped you before.
 */
export const BUILDING_RECTS: BuildingRect[] = PLOTS.flatMap((p) => {
  const d = ringPoint(p.angleDeg, p.ring);
  const c = Math.cos(d.rotY);
  const s = Math.sin(d.rotY);
  return p.rects.map((f) => {
    const z0 = p.ring === DOOR_RING ? Math.min(f.z0, DOOR_RING - PLAZA_RADIUS) : f.z0;
    const lx = (f.x0 + f.x1) / 2;
    const lz = (z0 + f.z1) / 2;
    return { kind: "rect" as const, plot: p.id, x: d.x + lx * c + lz * s, z: d.z - lx * s + lz * c, hw: (f.x1 - f.x0) / 2, hd: (z0 - f.z1) / 2, rot: d.rotY, h: 12 };
  });
});

/* ---------------------------------------------------------------- everything else that is solid ---------------------------------------------------------------- */

/** Parked cars (the same bays CampusProps fills: about two in three, never a planter bay). */
export const carInBay = (b: (typeof PARKING_BAYS)[number]) => !b.tree && hash01(b.i, 1) <= 0.66;

export const CAMPUS_SOLIDS: Obstacle[] = [
  ...PERIMETER_STONES.map((p) => rect(p.x, p.z, 1.8, 0.3, p.rotY, 0.8)),
  ...[...LAWN_BEDS, ...AVENUE_BEDS].map((b) => rect(b.x, b.z, b.hw + 0.06, b.hd + 0.06, b.rot, 0.9)),
  ...campusTrees().map((t) => circle(t.x, t.z, 0.35, 6)),
  ...STREET_LIGHTS.map((l) => circle(l.x, l.z, 0.16, 6)),
  ...WALK_PROPS.map((p) => (p.kind === "bench" ? rect(p.x, p.z, 1.08, 0.3, p.rotY, 0.6) : p.kind === "bin" ? circle(p.x, p.z, 0.24, 0.9) : circle(p.x, p.z, 0.12, 4.8))),
  ...WALK_TOTEMS.map((t) => rect(t.x, t.z, 0.55, 0.22, t.rotY, 2.6)),
  ...PARKING_BAYS.filter(carInBay).map((b) => rect(b.x, b.z, 0.95, 2.25, b.rotY, 1.5)),
  ...PARKING_BAYS.filter((b) => b.tree).map((b) => rect(b.x, b.z, PARKING.bay / 2 - 0.1, PARKING.depth / 2 - 0.2, 0, 0.4)),
  ...MOTO_BAYS.filter((b) => hash01(b.i, 11) < 0.7).map((b) => rect(b.x, b.z, 0.4, 1.0, b.rotY, 1.1)),
  ...GUARD_POSTS.map((g) => rect(g.x, g.z, 1.4, 1.3, 0, 2.6)),
  // the arrival gate (pylons, kiosk, guard, booth, forecourt beds) with its walls, turnstile cabinets, wardrobe and
  // hedged planters; the plaza entry gate's walls (its pylons and cabinets are plaza obstacles)
  ...GATE_OBSTACLES,
  ...[-1, 1].map((s) => rect(s * (9.4 + 8.5), GATE_Z, 8.5, 0.3, 0, 2.2)),
  ...[-3.75, -2.25, -0.75, 0.75, 2.25, 3.75].map((x) => rect(x, GATE_Z, 0.14, 0.86, 0, 1.1)),
  rect(WARDROBE.x - 0.4, WARDROBE.z, 1.0, 3.2, 0, 2.4),
  ...[-13, -10.5, 10.5, 13].map((x) => rect(x, GATE_Z + 7, 0.8, 1.6, 0, 1.3)),
  ...[-1, 1].map((s) => rect(s * (9.4 + 3.5), ENTRY_Z, 3.5, 0.3, 0, 2.2)),
];

/* ---------------------------------------------------------------- spatial hash ---------------------------------------------------------------- */

const CELL = 8;
const grid = new Map<number, Obstacle[]>();
const key = (i: number, j: number) => (i + 1000) * 4096 + (j + 1000);
function insert(o: Obstacle, pad: number) {
  const ext = o.kind === "circle" ? o.r : Math.hypot(o.hw, o.hd);
  const i0 = Math.floor((o.x - ext - pad) / CELL);
  const i1 = Math.floor((o.x + ext + pad) / CELL);
  const j0 = Math.floor((o.z - ext - pad) / CELL);
  const j1 = Math.floor((o.z + ext + pad) / CELL);
  for (let i = i0; i <= i1; i++)
    for (let j = j0; j <= j1; j++) {
      const k = key(i, j);
      const l = grid.get(k);
      if (l) l.push(o);
      else grid.set(k, [o]);
    }
}
const PAD = 1.2; // ≥ any body radius + route margin used below
for (const o of CAMPUS_SOLIDS) insert(o, PAD);
for (const o of BUILDING_RECTS) insert(o, PAD);
const EMPTY: Obstacle[] = [];
/** Static solids (incl. building rectangles) whose padded bounds cover the point. */
export const solidsNear = (x: number, z: number): Obstacle[] => grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? EMPTY;

/**
 * Push a body (mutated) out of every static solid near it; `openPlot`: a building whose open door you are passing
 * through (its own footprint lets you in). Returns true when something was hit.
 */
export function resolveSolids(p: P, openPlot: string | null = null, radius = BODY_RADIUS): boolean {
  const near = solidsNear(p.x, p.z);
  if (!near.length) return false;
  const list = openPlot ? near.filter((o) => (o as BuildingRect).plot !== openPlot) : near;
  return resolve(p, list, radius);
}

/** Keep a body inside the compound: a step across the boundary wall slides along it (or is undone). */
export function keepInCompound(p: P, prev: P): void {
  if (inCompound(p.x, p.z, WALL_MARGIN)) return;
  if (inCompound(p.x, prev.z, WALL_MARGIN)) p.z = prev.z;
  else if (inCompound(prev.x, p.z, WALL_MARGIN)) p.x = prev.x;
  else {
    p.x = prev.x;
    p.z = prev.z;
  }
}

/** Is a point blocked for a body (`margin` m round it): outside the compound, in a building or a solid, or in one
 *  of the extra obstacles (the plaza furniture)? */
export function freeBlocked(x: number, z: number, margin = BODY_RADIUS + 0.1, extra: Obstacle[] = EMPTY): boolean {
  if (!inCompound(x, z, WALL_MARGIN + 0.1)) return true;
  const q = { x, z };
  const near = solidsNear(x, z);
  if (near.length && resolve(q, near, margin)) return true;
  // the plaza furniture only matters on and just around the plaza
  if (extra.length && Math.hypot(x, z) < PLAZA_RADIUS + 12) {
    q.x = x;
    q.z = z;
    if (resolve(q, extra, margin)) return true;
  }
  return false;
}

/** Nearest free spot to a tapped point (out of buildings and solids, inside the compound). */
export function freeSpot(p: P, extra: Obstacle[] = EMPTY): P {
  const q = { x: p.x, z: p.z };
  for (let k = 0; k < 3; k++) {
    resolveSolids(q, null, BODY_RADIUS + 0.12);
    if (extra.length) resolve(q, extra, BODY_RADIUS + 0.12);
  }
  // overlapping footprints (a hall's wing and body) can push a point from one into the other: search outwards
  if (freeBlocked(q.x, q.z, BODY_RADIUS + 0.05, extra) && inCompound(q.x, q.z, WALL_MARGIN + 0.2)) {
    search: for (let rad = 0.5; rad < 40; rad += 0.5)
      for (let k = 0; k < 24; k++) {
        const x = p.x + Math.cos((k / 24) * Math.PI * 2) * rad;
        const z = p.z + Math.sin((k / 24) * Math.PI * 2) * rad;
        if (!freeBlocked(x, z, BODY_RADIUS + 0.12, extra)) {
          q.x = x;
          q.z = z;
          break search;
        }
      }
  }
  if (!inCompound(q.x, q.z, WALL_MARGIN + 0.2)) {
    // pull back towards the campus centre until inside
    for (let k = 0; k < 400 && !inCompound(q.x, q.z, WALL_MARGIN + 0.2); k++) {
      const d = Math.hypot(q.x, q.z) || 1;
      q.x -= (q.x / d) * 0.5;
      q.z -= (q.z / d) * 0.5;
    }
  }
  return q;
}

function clearLine(a: P, b: P, extra: Obstacle[], margin: number): boolean {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.ceil(d / 0.3));
  for (let k = 1; k < n; k++) {
    const t = k / n;
    if (freeBlocked(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, margin, extra)) return false;
  }
  return true;
}

/** min-heap of cell indices by score */
class Heap {
  private a: number[] = [];
  constructor(private f: Float32Array) {}
  get size() {
    return this.a.length;
  }
  push(v: number) {
    const a = this.a;
    a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.f[a[p]!]! <= this.f[a[i]!]!) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): number {
    const a = this.a;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.f[a[l]!]! < this.f[a[m]!]!) m = l;
        if (r < a.length && this.f[a[r]!]! < this.f[a[m]!]!) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Waypoints from `from` to `to` over open ground (ends at `to`, or at the nearest reachable free spot): straight
 * when the line is clear, else A* on a 1 m grid over the box round both points (+ 40 m), string-pulled.
 */
export function planFreeRoute(from: P, to: P, extra: Obstacle[] = EMPTY): P[] {
  const margin = BODY_RADIUS + 0.1;
  if (clearLine(from, to, extra, margin)) return [{ x: to.x, z: to.z }];
  const C = 1;
  const M = 40;
  const x0 = Math.min(from.x, to.x) - M;
  const z0 = Math.min(from.z, to.z) - M;
  const nx = Math.min(400, Math.ceil((Math.max(from.x, to.x) + M - x0) / C));
  const nz = Math.min(400, Math.ceil((Math.max(from.z, to.z) + M - z0) / C));
  const N = nx * nz;
  const blocked = new Uint8Array(N); // 0 unknown, 1 free, 2 blocked (evaluated lazily)
  const isBlocked = (c: number) => {
    if (!blocked[c]) blocked[c] = freeBlocked(x0 + ((c % nx) + 0.5) * C, z0 + (Math.floor(c / nx) + 0.5) * C, margin, extra) ? 2 : 1;
    return blocked[c] === 2;
  };
  const cellOf = (p: P) => Math.max(0, Math.min(nz - 1, Math.floor((p.z - z0) / C))) * nx + Math.max(0, Math.min(nx - 1, Math.floor((p.x - x0) / C)));
  const start = cellOf(from);
  const goal = cellOf(to);
  const g = new Float32Array(N).fill(Infinity);
  const f = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const gx = goal % nx;
  const gz = Math.floor(goal / nx);
  const h = (c: number) => Math.hypot((c % nx) - gx, Math.floor(c / nx) - gz);
  const heap = new Heap(f);
  g[start] = 0;
  f[start] = h(start);
  heap.push(start);
  // the closest cell to the goal reached so far (a goal walled in: walk as close as possible)
  let best = start;
  let iter = 0;
  while (heap.size && iter++ < 120000) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (h(cur) < h(best)) best = cur;
    if (cur === goal) break;
    const ci = cur % nx;
    const cj = Math.floor(cur / nx);
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
        const nb = j * nx + i;
        if (closed[nb]) continue;
        if (nb !== goal && isBlocked(nb)) continue;
        if (di && dj && (isBlocked(cj * nx + i) || isBlocked(j * nx + ci))) continue;
        const t = g[cur]! + (di && dj ? Math.SQRT2 : 1);
        if (t < g[nb]!) {
          g[nb] = t;
          came[nb] = cur;
          f[nb] = t + h(nb);
          heap.push(nb);
        }
      }
  }
  const end = came[goal]! >= 0 ? goal : best;
  if (end === start) return [{ x: to.x, z: to.z }];
  const cells: P[] = [];
  for (let c = end; c !== start && c >= 0; c = came[c]!) cells.push({ x: x0 + ((c % nx) + 0.5) * C, z: z0 + (Math.floor(c / nx) + 0.5) * C });
  cells.reverse();
  if (end === goal) cells.push({ x: to.x, z: to.z });
  // string pulling (forward: extend each straight leg while the line stays clear)
  const out: P[] = [];
  let anchor = from;
  let k = 0;
  while (k < cells.length) {
    let far = k;
    while (far + 1 < cells.length && clearLine(anchor, cells[far + 1]!, extra, margin)) far++;
    out.push(cells[far]!);
    anchor = cells[far]!;
    k = far + 1;
  }
  return out;
}
