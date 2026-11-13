import { PLANTERS, PORTALS, SERVICE_ANGLE } from "./layout";
import { GATE_Z } from "./gate/Gate";

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
export const RING_PLANTERS: RingPlanter[] = PLANTERS.map((p) => ({ x: p.x, z: p.z, r: p.r + BED_EXTRA, h: 0.45 }));

/** Arc beds along the plaza edge, leaving every door / the help desk / the gate approach clear. */
const DOOR_CLEAR = 9;
export const PLAZA_ARCS: ArcBed[] = (() => {
  const keep = [...PORTALS.map((p) => p.angleDeg), SERVICE_ANGLE].sort((a, b) => a - b);
  const arcs: ArcBed[] = [];
  for (let i = 0; i < keep.length - 1; i++) arcs.push({ cx: 0, cz: 0, r0: 26.9, r1: 27.95, a0: keep[i]! + DOOR_CLEAR, a1: keep[i + 1]! - DOOR_CLEAR, h: 0.42 });
  // south-east / south-west: up to the gate approach (180° ± 30°)
  arcs.push({ cx: 0, cz: 0, r0: 26.9, r1: 27.95, a0: SERVICE_ANGLE + DOOR_CLEAR, a1: 150, h: 0.42 });
  arcs.push({ cx: 0, cz: 0, r0: 26.9, r1: 27.95, a0: -150, a1: -112 - DOOR_CLEAR, h: 0.42 });
  return arcs;
})();

/** Linear beds along the avenue from the plaza gate to the ring road, hedged on the walkway side. */
export const AVENUE_BEDS: RectBed[] = (() => {
  const out: RectBed[] = [];
  for (let z = 37; z < 72; z += 7.5) for (const s of [-1, 1]) out.push({ x: s * 6.9, z: z + 3.1, hw: 2.0, hd: 3.1, rot: 0, h: 0.38, hedge: true });
  return out;
})();

/** Lawn beds between the buildings (tangential), some with bougainvillea trellises behind. */
export const LAWN_BEDS: RectBed[] = (() => {
  const out: RectBed[] = [];
  const mids = [-131, -94, -57, -19, 19, 57, 94, 131];
  mids.forEach((deg, i) => {
    for (const [rad, len] of [
      [41, 4.6],
      [54, 6.0],
    ] as const) {
      const a = (deg * Math.PI) / 180;
      out.push({ x: Math.sin(a) * rad, z: -Math.cos(a) * rad, hw: len, hd: 1.1, rot: -a, h: 0.4, hedge: rad > 50, trellis: rad < 50 && i % 2 === 0 });
    }
  });
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
