import {
  BARRIER,
  BOWL_SEATS,
  CONCOURSE,
  FLOOR_R,
  FLOOR_Y,
  LOWER,
  SECTIONS,
  STAGE,
  STAIR,
  STAIR_RAIL_END,
  STAIR_RAIL_H,
  STAIRS,
  UPPER,
  VIP,
  lowerTreadY,
  upperTreadY,
  type BowlSeat,
} from "./bowl";

/**
 * Sightline audit (P2-HAL-11): from every seat's seated eye to the stage centre and the four stage corners, the line
 * must clear the bowl's own structure (front barrier, balustrades, upper fascia, VIP fronts, tunnel cheek walls) and
 * pass at least `C_MIN` above the eyes of every row in front (the C-value of stadium design guides: 0.06 m minimum,
 * 0.09 m good, 0.12 m excellent). Pure geometry (metres, hall frame), shared with the tests and the QA report.
 */

/** seated eye above the seat's floor (m) and how far it is in front of the seat point (towards the floor) */
export const SEATED_EYE = { h: 1.2, fwd: 0.06 } as const;
export const C_MIN = 0.06;

const D2R = Math.PI / 180;
const norm = (deg: number) => ((deg % 360) + 360) % 360;
const inSpan = (a: number, a0: number, a1: number) => norm(a - a0) <= norm(a1 - a0);

/** an arc wall (or a row of heads): at radius r, between angles, solid up to `top` */
interface ArcObstacle {
  id: string;
  r: number;
  spans: [number, number][];
  top: number;
}

const LOWER_SPANS: [number, number][] = [[190, 170]];
const UPPER_ARCS: [number, number][] = [
  [18, 70],
  [110, 162],
  [198, 250],
  [290, 342],
];
const VIP_ARCS = SECTIONS.filter((s) => s.tier === "vip").map((s) => [s.a0, s.a1] as [number, number]);

/** the bowl's structure between the seats and the stage */
export function structure(): ArcObstacle[] {
  return [
    { id: "front barrier", r: FLOOR_R, spans: LOWER_SPANS, top: lowerTreadY(1) + BARRIER.front },
    { id: "concourse balustrade", r: CONCOURSE.r0 + 0.05, spans: LOWER_SPANS, top: BARRIER.concourse + 0.03 },
    { id: "upper fascia", r: CONCOURSE.r1 + 0.08, spans: UPPER_ARCS, top: UPPER.y1 + BARRIER.upper + 0.03 },
    { id: "VIP front", r: VIP.front + 0.03, spans: VIP_ARCS, top: VIP.floorY + BARRIER.vip + 0.03 },
  ];
}

/** seated eyes of a row, as an obstacle (the C-value is added on top) */
function heads(): (ArcObstacle & { tier: "lower" | "upper" | "vip"; row: number })[] {
  const out: (ArcObstacle & { tier: "lower" | "upper" | "vip"; row: number })[] = [];
  for (let i = 1; i <= LOWER.rows; i++)
    out.push({ id: `lower row ${i} heads`, tier: "lower", row: i, r: LOWER.front + LOWER.depth * (i - 1) + LOWER.depth * 0.62 - SEATED_EYE.fwd, spans: LOWER_SPANS, top: lowerTreadY(i) + SEATED_EYE.h });
  for (let j = 1; j <= UPPER.rows; j++)
    out.push({ id: `upper row ${j} heads`, tier: "upper", row: j, r: UPPER.r0 + UPPER.depth * (j - 1) + UPPER.depth * 0.62 - SEATED_EYE.fwd, spans: UPPER_ARCS, top: upperTreadY(j) + SEATED_EYE.h });
  return out;
}

export function seatEye(s: BowlSeat) {
  const r = Math.hypot(s.x, s.z) || 1;
  const k = (r - SEATED_EYE.fwd) / r;
  return { x: s.x * k, y: s.y + SEATED_EYE.h, z: s.z * k };
}

export const STAGE_TARGETS = (() => {
  const y = FLOOR_Y + STAGE.h;
  return [
    { id: "centre", x: 0, y, z: STAGE.z },
    { id: "corner NW", x: -STAGE.hw, y, z: STAGE.z - STAGE.hd },
    { id: "corner NE", x: STAGE.hw, y, z: STAGE.z - STAGE.hd },
    { id: "corner SW", x: -STAGE.hw, y, z: STAGE.z + STAGE.hd },
    { id: "corner SE", x: STAGE.hw, y, z: STAGE.z + STAGE.hd },
  ];
})();

type V3 = { x: number; y: number; z: number };
/** parameters t ∈ (0, 1) where the segment e → t crosses the circle of radius r (xz) */
function crossings(e: V3, t: V3, r: number): number[] {
  const dx = t.x - e.x;
  const dz = t.z - e.z;
  const a = dx * dx + dz * dz;
  const b = 2 * (e.x * dx + e.z * dz);
  const c = e.x * e.x + e.z * e.z - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0 || a < 1e-12) return [];
  const s = Math.sqrt(disc);
  return [(-b - s) / (2 * a), (-b + s) / (2 * a)].filter((u) => u > 1e-4 && u < 1 - 1e-4);
}

export interface Blocked {
  seat: string;
  target: string;
  by: string;
  /** how far the line passes below the obstacle's top (+ the C-value for heads), m */
  short: number;
}

/** The first obstruction of one seat's lines (null = every line is clear). */
export function seatSightline(s: BowlSeat, all = false): Blocked[] {
  const e = seatEye(s);
  const tier = SECTIONS.find((x) => x.id === s.table)!.tier;
  const r0 = Math.hypot(e.x, e.z);
  const obs: (ArcObstacle & { c: number })[] = [
    ...structure().map((o) => ({ ...o, c: 0 })),
    // heads in front: any row nearer the floor than this eye (own tier and the tiers below)
    ...heads()
      .filter((h) => h.r < r0 - 0.2 && !(h.tier === tier && h.row === s.row))
      .map((h) => ({ ...h, c: C_MIN })),
  ];
  const out: Blocked[] = [];
  for (const t of STAGE_TARGETS) {
    for (const o of obs) {
      if (o.r >= r0) continue;
      for (const u of crossings(e, t, o.r)) {
        const x = e.x + (t.x - e.x) * u;
        const z = e.z + (t.z - e.z) * u;
        const y = e.y + (t.y - e.y) * u;
        const a = norm(Math.atan2(x, z) / D2R);
        if (!o.spans.some(([a0, a1]) => inSpan(a, a0, a1))) continue;
        const need = o.top + o.c;
        if (y < need) {
          out.push({ seat: s.id, target: t.id, by: o.id, short: need - y });
          if (!all) return out;
        }
      }
    }
    // planar walls: the stairs' cheek walls + handrails, the players' tunnel cheek walls
    for (const w of PLANES) {
      const hit = planeHit(e, t, w);
      if (hit) {
        out.push({ seat: s.id, target: t.id, by: w.id, short: hit });
        if (!all) return out;
      }
    }
  }
  return out;
}

/**
 * A vertical wall along a line: origin o, unit direction u (along), unit normal n (lateral offset `off` from the
 * line); spans `along` ∈ [s0, s1] with a top height linear between y0 (at s0) and y1 (at s1).
 */
interface Plane {
  id: string;
  ox: number;
  oz: number;
  ux: number;
  uz: number;
  off: number;
  s0: number;
  s1: number;
  y0: number;
  y1: number;
}
const PLANES: Plane[] = (() => {
  const out: Plane[] = [];
  // stair cheeks (both sides) with the handrail 0.9 m over the pitch line (+ the rail tube)
  for (const f of STAIRS) {
    const ux = Math.sin(f.a * D2R);
    const uz = Math.cos(f.a * D2R);
    for (const side of [-1, 1])
      out.push({ id: `stair ${f.a}° handrail`, ox: 0, oz: 0, ux, uz, off: side * (STAIR.hw + STAIR.cheek / 2), s0: STAIR.r0, s1: f.r1 - STAIR_RAIL_END, y0: f.top / f.steps + STAIR_RAIL_H + 0.03, y1: (f.top * (f.r1 - STAIR_RAIL_END - STAIR.r0)) / (f.r1 - STAIR.r0) + f.top / f.steps + STAIR_RAIL_H + 0.03 });
  }
  // players' tunnel cheek walls: from the front barrier's top up to the concourse balustrade's top, along the row ends
  for (const a of [170, 190])
    out.push({ id: `tunnel cheek ${a}°`, ox: 0, oz: 0, ux: Math.sin(a * D2R), uz: Math.cos(a * D2R), off: 0, s0: FLOOR_R, s1: CONCOURSE.r0, y0: lowerTreadY(1) + BARRIER.front, y1: BARRIER.concourse });
  return out;
})();
/** how far below a planar wall's top the line passes where it crosses the wall (0 / null = clear) */
function planeHit(e: V3, t: V3, w: Plane): number | null {
  // lateral coordinate n = (−uz, ux)
  const lat = (x: number, z: number) => -(x - w.ox) * w.uz + (z - w.oz) * w.ux - w.off;
  const le = lat(e.x, e.z);
  const lt = lat(t.x, t.z);
  if (le * lt > 0 || le === lt) return null;
  const u = le / (le - lt);
  const x = e.x + (t.x - e.x) * u;
  const z = e.z + (t.z - e.z) * u;
  const along = (x - w.ox) * w.ux + (z - w.oz) * w.uz;
  if (along < w.s0 || along > w.s1) return null;
  const top = w.y0 + ((w.y1 - w.y0) * (along - w.s0)) / (w.s1 - w.s0);
  const y = e.y + (t.y - e.y) * u;
  return y < top ? top - y : null;
}

/** Every seat whose view of the stage is obstructed (one entry per seat, the first obstruction). */
export function sightlineReport() {
  const failed = BOWL_SEATS.map((s) => seatSightline(s)[0]).filter((b): b is Blocked => !!b);
  const by = new Map<string, number>();
  for (const f of failed) by.set(f.by, (by.get(f.by) ?? 0) + 1);
  return { seats: BOWL_SEATS.length, failed, by: Object.fromEntries(by) };
}
