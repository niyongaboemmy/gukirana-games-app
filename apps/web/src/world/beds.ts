import { DOOR_RING, ENTRY_Z, EXPANSION_PLOTS, FOUNTAIN_COURT, GATE_CLEAR_DEG, MID_ANGLES, OUTER_PROMENADE, PERIMETER_R, PLANTERS, PLAZA_RADIUS, PROMENADE_BEDS, RING_ANGLES, ringPoint } from "./layout";
import { GATE_Z } from "./gate/Gate";
import { inBuilding } from "./footprints";

/**
 * Landscape design of the compound (no trees inside the compound — "modern, international" brief):
 * raised planters on the plaza ring, corten-edged arc beds along the plaza edge between the doors, long linear beds
 * with clipped hedges along the avenue, lawn beds with bougainvillea trellises around the buildings, and arc beds on
 * the arrival-gate forecourt. Pure data (no React) so collisions and rendering share one source of truth.
 */

export interface ArcBed {
  cx: number;
  cz: number;
  r0: number;
  r1: number;
  /** angles in degrees, ringPoint convention (0 = north / −z, clockwise seen from above) */
  a0: number;
  a1: number;
  h: number;
}
export interface RectBed {
  x: number;
  z: number;
  hw: number;
  hd: number;
  rot: number;
  h: number;
  hedge?: boolean;
  trellis?: boolean;
}
export interface RingPlanter {
  x: number;
  z: number;
  r: number;
  h: number;
}

/** Raised round planters replacing the trees on the plaza ring (outer radius incl. the flower ring). */
export const BED_EXTRA = 0.95;
/** Fountain-court planters: smaller raised drums between the inner benches, off the promenades. */
export const COURT_PLANTERS: RingPlanter[] = [-66, -22, 22, 66].map((deg) => {
  const p = ringPoint(deg, FOUNTAIN_COURT + 7);
  return { x: p.x, z: p.z, r: 1.35 + BED_EXTRA * 0.6, h: 0.42 };
});

/** Every raised round planter in the plaza: the ring planters between the doors and the fountain-court planters. */
export const RING_PLANTERS: RingPlanter[] = [...PLANTERS.map((p) => ({ x: p.x, z: p.z, r: p.r + BED_EXTRA, h: 0.45 })), ...COURT_PLANTERS];

/** Arc beds along the plaza edge, leaving every door / the help desk / the gate approach clear (≈ 4.4 m each side). */
const DOOR_CLEAR = (4.4 / PLAZA_RADIUS) * (180 / Math.PI);
const EDGE = { r0: PLAZA_RADIUS - 1.1, r1: PLAZA_RADIUS - 0.05 };
export const PLAZA_ARCS: ArcBed[] = (() => {
  const keep = RING_ANGLES;
  const arcs: ArcBed[] = [];
  for (let i = 0; i < keep.length - 1; i++) arcs.push({ cx: 0, cz: 0, ...EDGE, a0: keep[i]! + DOOR_CLEAR, a1: keep[i + 1]! - DOOR_CLEAR, h: 0.42 });
  // south-east / south-west: up to the gate approach
  const last = keep[keep.length - 1]!;
  arcs.push({ cx: 0, cz: 0, ...EDGE, a0: last + DOOR_CLEAR, a1: GATE_CLEAR_DEG, h: 0.42 });
  arcs.push({ cx: 0, cz: 0, ...EDGE, a0: -GATE_CLEAR_DEG, a1: keep[0]! - DOOR_CLEAR, h: 0.42 });
  return arcs;
})();

/** Linear beds along the avenue from the plaza gate to the ring road, hedged on the walkway side. */
export const AVENUE_BEDS: RectBed[] = (() => {
  const out: RectBed[] = [];
  // the short avenue between the plaza's entry gate and the arrival gate: one hedged bed on the west side (the
  // arrival gate's wardrobe stands on the east side), then the forecourt beyond the arrival gate
  const z0 = ENTRY_Z + 4.9;
  const z1 = GATE_Z - 4.6;
  out.push({ x: -6.9, z: (z0 + z1) / 2, hw: 2.0, hd: (z1 - z0) / 2, rot: 0, h: 0.38, hedge: true });
  return out;
})();

/** Promenade beds inside the plaza (spawn → fountain court), low lavender / salvia with a clipped edge. */
export const PLAZA_BEDS: RectBed[] = PROMENADE_BEDS.map((b) => ({ ...b, rot: 0, h: 0.4 }));

/**
 * Lawn beds between the buildings (tangential, on the bearings between plots), some with bougainvillea trellises
 * behind; any that would touch a building (the halls grow with their interiors) or the ring road are left out.
 */
export const LAWN_BEDS: RectBed[] = (() => {
  const out: RectBed[] = [];
  const mids = MID_ANGLES.filter((m) => Math.abs(m) < GATE_CLEAR_DEG - 10);
  mids.forEach((deg, i) => {
    for (const [rad, len] of [
      [PERIMETER_R + 3.5, 4.6],
      [DOOR_RING + 17, 6.0],
      [DOOR_RING + 30, 7.0],
      [DOOR_RING + 43, 7.5],
      [DOOR_RING + 55, 8.0],
    ] as const) {
      if (rad + 2 > OUTER_PROMENADE.r0) continue;
      const a = (deg * Math.PI) / 180;
      const b: RectBed = { x: Math.sin(a) * rad, z: -Math.cos(a) * rad, hw: len, hd: 1.1, rot: -a, h: 0.4, hedge: rad > DOOR_RING + 10, trellis: rad < DOOR_RING + 10 && i % 2 === 0 };
      // corners + edge midpoints of the bed, in the world
      const c = Math.cos(b.rot);
      const s = Math.sin(b.rot);
      const pts = [-1, 0, 1].flatMap((u) => [-1, 1].map((v) => ({ x: b.x + u * b.hw * c + v * b.hd * s, z: b.z - u * b.hw * s + v * b.hd * c })));
      if (pts.some((p) => inBuilding(p.x, p.z, 1.5))) continue;
      out.push(b);
    }
  });
  // along the outer promenade, between the expansion plots (hedged on the walk side)
  for (let i = 0; i < EXPANSION_PLOTS.length - 1; i++) {
    const deg = (EXPANSION_PLOTS[i]!.angleDeg + EXPANSION_PLOTS[i + 1]!.angleDeg) / 2;
    if (Math.abs(EXPANSION_PLOTS[i + 1]!.angleDeg - EXPANSION_PLOTS[i]!.angleDeg) > 45) continue; // the open north sector
    const a = (deg * Math.PI) / 180;
    const rad = OUTER_PROMENADE.r1 + 2.4;
    const b: RectBed = { x: Math.sin(a) * rad, z: -Math.cos(a) * rad, hw: 6.5, hd: 1.1, rot: -a, h: 0.4, hedge: true };
    if (!inBuilding(b.x, b.z, 2)) out.push(b);
  }
  return out;
})();

/** Arrival-gate forecourt arc beds (south half, leaving the approach walk clear). */
export const GATE_ARCS: ArcBed[] = [
  { cx: 0, cz: GATE_Z, r0: 15.6, r1: 17.0, a0: 108, a1: 166, h: 0.42 },
  { cx: 0, cz: GATE_Z, r0: 15.6, r1: 17.0, a0: -166, a1: -108, h: 0.42 },
];

export const arcPoint = (b: Pick<ArcBed, "cx" | "cz">, deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: b.cx + Math.sin(a) * r, z: b.cz - Math.cos(a) * r };
};
