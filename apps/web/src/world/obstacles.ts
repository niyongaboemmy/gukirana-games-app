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

export type Obstacle =
  | { kind: "circle"; x: number; z: number; r: number }
  /** rect: centre, half-width (local x), half-depth (local z), rotation about Y (same convention as Object3D.rotation.y) */
  | { kind: "rect"; x: number; z: number; hw: number; hd: number; rot: number };

export const circle = (x: number, z: number, r: number): Obstacle => ({ kind: "circle", x, z, r });
export const rect = (x: number, z: number, hw: number, hd: number, rot = 0): Obstacle => ({ kind: "rect", x, z, hw, hd, rot });

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
  circle(0, 0, FOUNTAIN_RADIUS + 0.2),
  ...BENCHES.map((b) => rect(b.x, b.z, 1.08, 0.3, b.rotY)),
  ...RING_PLANTERS.map((p) => circle(p.x, p.z, p.r)),
  ...PLAZA_ARCS.flatMap(arcCircles),
  ...TOTEMS.map((t) => rect(t.x, t.z, 1.22, 0.36, t.rotY)),
  ...LAMPS.map((l) => circle(l.x, l.z, 0.12)),
  // plaza entry gate (seen from inside): exit kiosk, guard, pylons, turnstile cabinets
  rect(EXIT_KIOSK.x, EXIT_KIOSK.z, 0.42, 0.32, EXIT_KIOSK.rotY),
  circle(4.4, ENTRY_Z - 2.3, 0.35),
  ...[-1, 1].map((s) => rect(s * 8.6, ENTRY_Z, 0.8, 1.2)),
  ...[-3.75, -2.25, -0.75, 0.75, 2.25, 3.75].map((x) => rect(x, ENTRY_Z, 0.14, 0.86)),
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
