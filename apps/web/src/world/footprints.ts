import { HALLS, type HallGame } from "@/rooms/layouts";
import { DOOR_RING, EXPANSION_PLOTS, EXPANSION_RING, PORTALS, ringPoint, SERVICE_ANGLE, type PortalDef } from "./layout";

/**
 * Building volumes on the rings, DERIVED from the hall interiors (rooms/layouts.ts HALLS): every hall's exterior is
 * at least as large as its interior, so a bigger room grows its building, its entrance wing and its footprint
 * automatically. Pure data (no three.js), shared by District.ts (geometry), beds.ts (lawn beds stay clear),
 * PlazaGlimpse (impostors seen through a hall door) and the layout tests.
 *
 * Local building frame: door centre at the origin, facade towards the fountain (+z), the volume towards −z,
 * +x towards the next plot clockwise (seen from above).
 */

export interface Rect {
  x0: number;
  x1: number;
  /** front (towards the fountain) */
  z0: number;
  /** back */
  z1: number;
}

/** Exterior wall thickness of the halls (the interior size is the clear room inside these walls). */
export const HALL_WALL = 0.4;
/** Entrance wing in front of every hall (shopfront / porch + vestibule), local x ∈ ±WING_HW. */
export const WING_HW = 7.6;
/** The size every "hall" plot is reserved for (interior, m): future halls up to this size need no layout change. */
export const PLOT_HALL_SIZE = { w: 36, d: 28, h: 5 };
/** Halls sit this far off their door axis, away from the arena (leaves the volcano sight-lines open). */
const AWAY_OFFSET = 2.5;

/**
 * A winged hall: entrance wing on the ring, the full-size hall behind it. The wing grows deeper as the hall gets
 * wider, so the hall's front corners stay clear of the neighbouring plots on the ring.
 * `away`: −1 shifts the hall towards smaller bearings (west halls), +1 towards larger (east halls), 0 centred.
 */
export function wingedPlan(size: { w: number; d: number; h: number }, away: number, minH = 6.8) {
  const W = size.w + 2 * HALL_WALL;
  const D = size.d + 2 * HALL_WALL;
  const wing = Math.min(18, Math.max(8, 8 + (size.w - 24) / 2));
  const cx = away * Math.max(0, Math.min(AWAY_OFFSET, W / 2 - WING_HW - 1));
  return { wing, x0: cx - W / 2, x1: cx + W / 2, z0: -wing, z1: -wing - D, H: Math.max(minH, size.h + 3.6) };
}

const angleOf = (id: string) => PORTALS.find((p) => p.id === id)?.angleDeg ?? 0;
/** A playable hall's building, from its interior size. */
export function wingedHall(game: HallGame) {
  return wingedPlan(HALLS[game].size, Math.sign(angleOf(game)) || 1, game === "pool" ? 8.6 : game === "igisoro" ? 5.0 : game === "admin" ? 8.0 : 6.8);
}

/** Igisoro Court: a thatched porch wing (its door in the lava wall behind the porch) and the thatched hall behind. */
export function igisoroHall() {
  return { ...wingedHall("igisoro"), t: 0.5, ov: 1.4, doorZ: -2.4 };
}

/** Tournament Arena drum (local frame of the arena door): elliptical, `cz` = drum centre, front 6 m behind the door. */
export const ARENA = (() => {
  const rx = 22;
  const rz = 19;
  return { cz: -(rz + 6), rx, rz, wall: 20 };
})();

const hallRects = (h: ReturnType<typeof wingedPlan>, front = 1.6): Rect[] => [
  { x0: -WING_HW, x1: WING_HW, z0: front, z1: -h.wing },
  { x0: h.x0 - 0.2, x1: h.x1 + 0.2, z0: -h.wing, z1: h.z1 - 0.2 },
];
const igi = igisoroHall();
const igiRects: Rect[] = [
  { x0: -WING_HW - igi.ov, x1: WING_HW + igi.ov, z0: 1, z1: -igi.wing },
  { x0: igi.x0 - igi.ov, x1: igi.x1 + igi.ov, z0: -igi.wing + igi.ov, z1: igi.z1 - igi.ov },
];

/** Footprint templates by building type (local rectangles, incl. roof overhangs). */
export const FOOTPRINTS = {
  pool: hallRects(wingedHall("pool")),
  ludo: hallRects(wingedHall("ludo")),
  admin: hallRects(wingedHall("admin")),
  igisoro: igiRects,
  // the drum as horizontal bands hugging its ellipse (a single bounding box would block the gaps beside it), plus
  // the glazed lobby, canopy and flagpoles in front
  arena: [
    { x0: -12, x1: 12, z0: 3, z1: -6 },
    ...Array.from({ length: 8 }, (_, i): Rect => {
      const R = { x: ARENA.rx + 0.8, z: ARENA.rz + 0.8 };
      const za = ARENA.cz + R.z - (2 * R.z * i) / 8;
      const zb = za - (2 * R.z) / 8;
      const near = Math.min(Math.abs(za - ARENA.cz), Math.abs(zb - ARENA.cz));
      const hw = (za - ARENA.cz) * (zb - ARENA.cz) < 0 ? R.x : R.x * Math.sqrt(Math.max(0, 1 - (near / R.z) ** 2));
      return { x0: -hw, x1: hw, z0: za, z1: zb };
    }),
  ],
  soon: [{ x0: -5.2, x1: 5.2, z0: 0.5, z1: -10 }],
  service: [{ x0: -5.2, x1: 5.2, z0: 0.6, z1: -7 }],
} satisfies Record<string, Rect[]>;

/** A reserved hall plot (construction site behind hoarding): the full plot a ~36 × 28 m hall will take. */
export const sitePlan = (away: number) => wingedPlan(PLOT_HALL_SIZE, away);

export interface Plot {
  id: string;
  angleDeg: number;
  /** door ring radius of this plot */
  ring: number;
  /** building type */
  type: PortalDef["kind"] | "service" | "site";
  /** for sites: which way the future hall sits off its axis */
  away: number;
  rects: Rect[];
}

/** Every plot in the compound (inner ring doors, the service pavilion, the expansion plots) with its footprint. */
export const PLOTS: Plot[] = [
  ...PORTALS.map((p): Plot => {
    const site = p.kind === "soon" && p.plot === "hall";
    const away = Math.sign(p.angleDeg) || 1;
    return { id: p.id, angleDeg: p.angleDeg, ring: DOOR_RING, type: site ? "site" : p.kind, away, rects: site ? hallRects(sitePlan(away), 0.5) : FOOTPRINTS[p.kind] };
  }),
  { id: "service", angleDeg: SERVICE_ANGLE, ring: DOOR_RING, type: "service", away: 0, rects: FOOTPRINTS.service },
  ...EXPANSION_PLOTS.map((e): Plot => ({ id: e.id, angleDeg: e.angleDeg, ring: EXPANSION_RING, type: "site", away: 0, rects: hallRects(sitePlan(0), 0.5) })),
];

/** World point → a plot's local frame (door at the origin, +z towards the fountain). */
export function toLocal(angleDeg: number, x: number, z: number, ring = DOOR_RING) {
  const d = ringPoint(angleDeg, ring);
  const c = Math.cos(d.rotY);
  const s = Math.sin(d.rotY);
  const dx = x - d.x;
  const dz = z - d.z;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

/** Is the world point within `margin` of any building footprint? */
export function inBuilding(x: number, z: number, margin = 0): boolean {
  return PLOTS.some((p) => {
    const l = toLocal(p.angleDeg, x, z, p.ring);
    return p.rects.some((f) => l.x > f.x0 - margin && l.x < f.x1 + margin && l.z < f.z0 + margin && l.z > f.z1 - margin);
  });
}

/** The Ludo Lounge's giant die on its roof-terrace mast (local frame of the Ludo door; drawn in Plaza.tsx). */
const ludo = wingedHall("ludo");
export const LUDO_DIE = { x: 4, z: ludo.z0 - 4, y: ludo.H + 0.5 + 4.4 };
