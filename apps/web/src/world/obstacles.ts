import { BENCHES, ENTRY_Z, EXIT_KIOSK, FOUNTAIN_RADIUS, ringPoint, TOTEMS } from "./layout";
import { arcPoint, GATE_ARCS, PLAZA_ARCS, RING_PLANTERS, type ArcBed } from "./beds";
import { GATE_Z, GUARD_POST, KIOSK } from "./gate/Gate";

/**
 * Solid things the player cannot walk through (outdoor world). Circles for round things (fountain, trunks, lamp
 * posts, planters, bushes, rocks) and oriented rectangles for boxy ones (benches, sign totems, kiosks, booths).
 * `resolve()` pushes a body circle out of every overlapping obstacle along the shortest direction, so movement
 * slides along edges instead of sticking. Vegetation registers its own obstacles where it places plants.
 */
export const BODY_RADIUS = 0.32;

/** `h` = height (m), used by the camera spring arm; default 1 m. */
export type Obstacle =
  | { kind: "circle"; x: number; z: number; r: number; h?: number }
  /** rect: centre, half-width (local x), half-depth (local z), rotation about Y (same convention as Object3D.rotation.y) */
  | { kind: "rect"; x: number; z: number; hw: number; hd: number; rot: number; h?: number };

export const circle = (x: number, z: number, r: number, h = 1): Obstacle => ({ kind: "circle", x, z, r, h });
export const rect = (x: number, z: number, hw: number, hd: number, rot = 0, h = 1): Obstacle => ({ kind: "rect", x, z, hw, hd, rot, h });

/** Lamp posts on the plaza ring (District draws the same 12). */
export const LAMPS = Array.from({ length: 12 }, (_, i) => ringPoint((i / 12) * 360 + 15, 19.5));

/** An arc bed as a chain of overlapping circles along its centre line. */
function arcCircles(b: ArcBed): Obstacle[] {
  const rm = (b.r0 + b.r1) / 2;
  const half = (b.r1 - b.r0) / 2 + 0.05;
  const len = (((b.a1 - b.a0) * Math.PI) / 180) * rm;
  const n = Math.max(2, Math.ceil(len / (half * 1.2)));
  return Array.from({ length: n + 1 }, (_, i) => {
    const p = arcPoint(b, b.a0 + ((b.a1 - b.a0) * i) / n, rm);
    return circle(p.x, p.z, half);
  });
}

/** Static plaza furniture. */
export const PLAZA_OBSTACLES: Obstacle[] = [
  circle(0, 0, FOUNTAIN_RADIUS + 0.2, 0.7),
  circle(0, 0, 1.3, 4.6), // Agaseke sculpture (camera only — the basin already keeps people out)
  ...BENCHES.map((b) => rect(b.x, b.z, 1.08, 0.3, b.rotY, 0.6)),
  ...RING_PLANTERS.map((p) => circle(p.x, p.z, p.r, 1.2)),
  ...PLAZA_ARCS.flatMap(arcCircles),
  ...TOTEMS.map((t) => rect(t.x, t.z, 1.22, 0.36, t.rotY, 3.8)),
  ...LAMPS.map((l) => circle(l.x, l.z, 0.12, 4.8)),
  // plaza entry gate (seen from inside): exit kiosk, guard, pylons, turnstile cabinets
  rect(EXIT_KIOSK.x, EXIT_KIOSK.z, 0.42, 0.32, EXIT_KIOSK.rotY, 1.9),
  circle(4.4, ENTRY_Z - 2.3, 0.35, 1.9),
  ...[-1, 1].map((s) => rect(s * 8.6, ENTRY_Z, 0.8, 1.2, 0, 5.6)),
  ...[-3.75, -2.25, -0.75, 0.75, 2.25, 3.75].map((x) => rect(x, ENTRY_Z, 0.14, 0.86, 0, 1.1)),
];

/** Arrival gate free-roam area (outside the turnstiles): kiosk, guard, booth, pylons, forecourt beds. */
export const GATE_OBSTACLES: Obstacle[] = [
  rect(KIOSK.x, KIOSK.z, 0.42, 0.32, KIOSK.rotY),
  circle(GUARD_POST.x, GATE_Z + GUARD_POST.dz, 0.35),
  rect(6.4, GATE_Z + 1.6, 1.42, 1.32),
  ...[-1, 1].map((s) => rect(s * 8.6, GATE_Z, 0.8, 1.2)),
  ...GATE_ARCS.flatMap(arcCircles),
];

/** Obstacles registered at runtime by whoever places them (vegetation, flower beds), keyed by owner. */
const dynamic = new Map<string, Obstacle[]>();
let merged: Obstacle[] = PLAZA_OBSTACLES;
export function setObstacles(owner: string, list: Obstacle[]) {
  if (list.length) dynamic.set(owner, list);
  else dynamic.delete(owner);
  merged = [...PLAZA_OBSTACLES, ...[...dynamic.values()].flat()];
}
export const plazaObstacles = () => merged;

/** Push point p (mutated) out of all obstacles, keeping a body of `radius`. Two passes handle corners. */
export function resolve(p: { x: number; z: number }, list: Obstacle[], radius = BODY_RADIUS): boolean {
  let hit = false;
  for (let pass = 0; pass < 2; pass++) {
    for (const o of list) {
      if (o.kind === "circle") {
        const dx = p.x - o.x;
        const dz = p.z - o.z;
        const R = o.r + radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= R * R) continue;
        const d = Math.sqrt(d2);
        if (d < 1e-5) {
          p.x = o.x + R;
        } else {
          p.x = o.x + (dx / d) * R;
          p.z = o.z + (dz / d) * R;
        }
        hit = true;
      } else {
        const c = Math.cos(o.rot);
        const s = Math.sin(o.rot);
        const dx = p.x - o.x;
        const dz = p.z - o.z;
        // world → local (inverse of rotation.y)
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        if (Math.abs(lx) >= o.hw + radius || Math.abs(lz) >= o.hd + radius) continue;
        const qx = Math.max(-o.hw, Math.min(o.hw, lx));
        const qz = Math.max(-o.hd, Math.min(o.hd, lz));
        let nx = lx - qx;
        let nz = lz - qz;
        const d = Math.hypot(nx, nz);
        let ox: number;
        let oz: number;
        if (d > 1e-5) {
          if (d >= radius) continue;
          ox = qx + (nx / d) * radius;
          oz = qz + (nz / d) * radius;
        } else {
          // centre inside the box: leave through the nearest face
          const px = o.hw - Math.abs(lx);
          const pz = o.hd - Math.abs(lz);
          if (px < pz) {
            nx = Math.sign(lx) || 1;
            ox = nx * (o.hw + radius);
            oz = lz;
          } else {
            nz = Math.sign(lz) || 1;
            ox = lx;
            oz = nz * (o.hd + radius);
          }
        }
        // local → world
        p.x = o.x + ox * c + oz * s;
        p.z = o.z - ox * s + oz * c;
        hit = true;
      }
    }
  }
  return hit;
}

/** Nearest free point for a click-to-walk target (a little extra margin so the walk can arrive). */
export function freePoint(p: { x: number; z: number }, list: Obstacle[]): { x: number; z: number } {
  const q = { x: p.x, z: p.z };
  resolve(q, list, BODY_RADIUS + 0.08);
  return q;
}

/** Is point (x, y, z) inside something the camera must not enter? */
function cameraBlocked(x: number, y: number, z: number, list: Obstacle[]): boolean {
  // the buildings stand on the ring beyond the plaza edge (except the open sky over the avenue / gate)
  const r = Math.hypot(x, z);
  if (r > 29.2 && y < 11 && !(Math.abs(x) < 10 && z > 25)) return true;
  // entry gate canopy slab + the screen standing on it
  if (Math.abs(x) < 9.8 && Math.abs(z - ENTRY_Z) < 4.5 && y > 4.9 && y < 6.1) return true;
  if (Math.abs(x) < 6 && Math.abs(z - ENTRY_Z - 3.4) < 0.45 && y > 5.6 && y < 8.4) return true;
  for (const o of list) {
    if (y > (o.h ?? 1) + 0.25) continue;
    if (o.kind === "circle") {
      if (Math.hypot(x - o.x, z - o.z) < o.r + 0.3) return true;
    } else {
      const c = Math.cos(o.rot);
      const s = Math.sin(o.rot);
      const dx = x - o.x;
      const dz = z - o.z;
      if (Math.abs(dx * c - dz * s) < o.hw + 0.3 && Math.abs(dx * s + dz * c) < o.hd + 0.3) return true;
    }
  }
  return false;
}

/** Longest free camera arm (≤ want) from the head of a player at (px, pz) along the orbit direction. */
export function cameraArm(px: number, pz: number, yaw: number, pitch: number, want: number): number {
  const list = merged;
  const ex = Math.sin(yaw) * Math.cos(pitch);
  const ez = Math.cos(yaw) * Math.cos(pitch);
  const ey = Math.sin(pitch);
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    const t = (i / steps) * want;
    if (cameraBlocked(px + ex * t, 1.6 + ey * t, pz + ez * t, list)) return Math.max(1.4, t - want / steps - 0.25);
  }
  return want;
}

/* ---------------- click-to-walk route planning (A* on a 0.5 m grid, then string-pulled) ---------------- */
const CELL = 0.5;
const HALF = 28.5;
const N = Math.ceil((HALF * 2) / CELL);
let gridFor: Obstacle[] | null = null;
let grid: Uint8Array | null = null;

function blockedAt(x: number, z: number, list: Obstacle[], margin: number): boolean {
  if (Math.hypot(x, z) > 27.9) return true;
  const q = { x, z };
  return resolve(q, list, margin);
}

function buildGrid(list: Obstacle[]): Uint8Array {
  const g = new Uint8Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) g[j * N + i] = blockedAt(-HALF + (i + 0.5) * CELL, -HALF + (j + 0.5) * CELL, list, BODY_RADIUS + 0.12) ? 1 : 0;
  return g;
}

function clearLine(a: { x: number; z: number }, b: { x: number; z: number }, list: Obstacle[]): boolean {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.ceil(d / 0.25));
  for (let k = 1; k < n; k++) {
    const t = k / n;
    if (blockedAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, list, BODY_RADIUS + 0.05)) return false;
  }
  return true;
}

/** Waypoints from `from` to `to` around plaza obstacles (empty if the straight line is already free). */
export function planRoute(from: { x: number; z: number }, to: { x: number; z: number }, list: Obstacle[] = merged): { x: number; z: number }[] {
  if (clearLine(from, to, list)) return [to];
  if (gridFor !== list || !grid) {
    grid = buildGrid(list);
    gridFor = list;
  }
  const g = grid;
  const idx = (p: { x: number; z: number }) => {
    const i = Math.max(0, Math.min(N - 1, Math.floor((p.x + HALF) / CELL)));
    const j = Math.max(0, Math.min(N - 1, Math.floor((p.z + HALF) / CELL)));
    return j * N + i;
  };
  const start = idx(from);
  let goal = idx(to);
  if (g[goal]) {
    // nearest free cell to the goal
    let best = -1;
    let bd = Infinity;
    const gi = goal % N;
    const gj = Math.floor(goal / N);
    for (let dj = -6; dj <= 6; dj++)
      for (let di = -6; di <= 6; di++) {
        const i = gi + di;
        const j = gj + dj;
        if (i < 0 || j < 0 || i >= N || j >= N || g[j * N + i]) continue;
        const d = di * di + dj * dj;
        if (d < bd) {
          bd = d;
          best = j * N + i;
        }
      }
    if (best < 0) return [to];
    goal = best;
  }
  const gScore = new Float32Array(N * N).fill(Infinity);
  const came = new Int32Array(N * N).fill(-1);
  const open: number[] = [start];
  const inOpen = new Uint8Array(N * N);
  const fScore = new Float32Array(N * N).fill(Infinity);
  gScore[start] = 0;
  const gx = goal % N;
  const gz = Math.floor(goal / N);
  const h = (c: number) => Math.hypot((c % N) - gx, Math.floor(c / N) - gz);
  fScore[start] = h(start);
  inOpen[start] = 1;
  let iter = 0;
  while (open.length && iter++ < 20000) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (fScore[open[k]!]! < fScore[open[bi]!]!) bi = k;
    const cur = open[bi]!;
    open.splice(bi, 1);
    inOpen[cur] = 0;
    if (cur === goal) break;
    const ci = cur % N;
    const cj = Math.floor(cur / N);
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= N || j >= N) continue;
        const nb = j * N + i;
        if (g[nb] && nb !== goal) continue;
        if (di && dj && (g[cj * N + i] || g[j * N + ci])) continue; // no corner cutting
        const t = gScore[cur]! + (di && dj ? Math.SQRT2 : 1);
        if (t < gScore[nb]!) {
          gScore[nb] = t;
          came[nb] = cur;
          fScore[nb] = t + h(nb);
          if (!inOpen[nb]) {
            open.push(nb);
            inOpen[nb] = 1;
          }
        }
      }
  }
  if ((came[goal] ?? -1) < 0) return [to];
  const cells: { x: number; z: number }[] = [];
  for (let c = goal; c !== start && c >= 0; c = came[c]!) cells.push({ x: -HALF + ((c % N) + 0.5) * CELL, z: -HALF + (Math.floor(c / N) + 0.5) * CELL });
  cells.reverse();
  cells.push(to);
  // string pulling: keep only the waypoints needed for clear straight segments
  const out: { x: number; z: number }[] = [];
  let anchor = from;
  let k = 0;
  while (k < cells.length) {
    let far = k;
    for (let m = cells.length - 1; m > k; m--)
      if (clearLine(anchor, cells[m]!, list)) {
        far = m;
        break;
      }
    out.push(cells[far]!);
    anchor = cells[far]!;
    k = far + 1;
  }
  return out;
}
