import { PLAZA_BENCH_CLUSTERS, PLAZA_BENCH_COURT, PLAZA_BENCHES } from "@gukirana/contracts";
import type { PortalId } from "@/lib/world-store";
import type { IconKind } from "./textures";

/**
 * Gukirana Arena District layout in metres (DESIGN-SPEC §6.1–6.2, docs/WORLD-ARENA-DESIGN.md §5).
 * Circular entry plaza (Agaseke fountain at the centre); every game building faces the fountain and its door is
 * the interaction point. North (−z) is the Tournament Arena with the Virunga volcano chain behind it.
 *
 * Campus scale (P1-WLD-03): a 37 m plaza (≈ 4,300 m² walkable, 1.75× the first 28 m courtyard) with nine plots
 * on the door ring. Everything below derives from PLAZA_RADIUS so the ring, gates, beds and landscape move together.
 */
export const PLAZA_RADIUS = 37; // walkable radius of the entry plaza
export const DOOR_RING = PLAZA_RADIUS + 1.5; // building fronts / doors sit on this ring
/** Paved disc (beyond the walkable edge: under the building fronts) and the low lava-rock perimeter walls. */
export const PAVING_R = PLAZA_RADIUS + 4.5;
export const PERIMETER_R = PLAZA_RADIUS + 6;
/**
 * Expansion district (P1-WLD-03): an outer promenade ring beyond the inner halls (it meets the main avenue from the
 * entry gate), with EXPANSION_PLOTS reserved for future halls on its outside (doors facing the centre).
 */
export const OUTER_PROMENADE = { r0: 100, r1: 105 } as const;
export const EXPANSION_RING = 108;
/** Ring road around the whole compound and the flat lawn edge beyond it, where the farmland begins. */
export const RING_ROAD = { r0: 158, r1: 165 } as const;
export const COMPOUND_R = 172;
/** Plaza entry gate (same structure as the arrival gate) on the avenue axis; players arrive just inside it. */
export const ENTRY_Z = PLAZA_RADIUS + 3.5;
export const SPAWN = { x: 0, z: PLAZA_RADIUS - 3 };
/** Exit / sign-out kiosk inside the entry gate, facing the plaza. */
export const EXIT_KIOSK = { x: -5.0, z: ENTRY_Z - 3.4, rotY: Math.PI - 0.5 };
export const EXIT_RADIUS = 2.5;
/** Arena doors start sliding open within this distance of the door's entry point (m). */
export const DOOR_OPEN_RADIUS = 4.6;
/** Fountain basin (the fountain court around it: FOUNTAIN_COURT). */
export const FOUNTAIN_RADIUS = 4.8;
export const FOUNTAIN_COURT = 10.5;
export const INTERACT_RADIUS = 3.0;
export const DOOR = { w: 3.0, h: 4.0 }; // §6.1 door size

export interface PortalDef {
  id: PortalId;
  label: string;
  sub: string;
  color: string;
  href: string | null;
  angleDeg: number;
  kind: IconKind;
  /** plot size on the ring: "hall" plots fit a ~36 × 28 m hall interior (winged building); "small" a pavilion */
  plot?: "hall" | "small";
}

export const PORTALS: PortalDef[] = [
  { id: "soon-sw", label: "Coming Soon", sub: "Cards", color: "#8A94A6", href: null, angleDeg: -144, kind: "soon" },
  { id: "soon-left", label: "Coming Soon", sub: "Draughts", color: "#8A94A6", href: null, angleDeg: -122, kind: "soon" },
  { id: "igisoro", label: "Igisoro Court", sub: "Strategy", color: "#27AE60", href: "/room/igisoro", angleDeg: -88, kind: "igisoro", plot: "hall" },
  { id: "pool", label: "Pool Hall", sub: "8-Ball", color: "#2F80ED", href: "/room/pool", angleDeg: -44, kind: "pool", plot: "hall" },
  { id: "arena", label: "Tournament Arena", sub: "Tournaments", color: "#9B51E0", href: null, angleDeg: 0, kind: "arena" },
  { id: "ludo", label: "Ludo Lounge", sub: "Dice & tactics", color: "#FF8A1F", href: "/room/ludo", angleDeg: 44, kind: "ludo", plot: "hall" },
  { id: "soon-right", label: "Coming Soon", sub: "Chess", color: "#8A94A6", href: null, angleDeg: 88, kind: "soon", plot: "hall" },
  { id: "soon-se", label: "Coming Soon", sub: "Esports", color: "#8A94A6", href: null, angleDeg: 144, kind: "soon" },
];

/** Service pavilion (wallet kiosk + help desk) closes the ring on the east side. */
export const SERVICE_ANGLE = 122;

/**
 * Reserved hall plots in the expansion district, on the outside of the outer promenade (bearings; the north sector
 * stays open for the volcano view). Each fits a ~36 × 28 m hall interior plus its entrance wing.
 */
export const EXPANSION_PLOTS: { id: string; n: number; angleDeg: number }[] = [-155, -125, -95, -65, -35, 35, 65, 95, 125, 155].map((angleDeg, i) => ({
  id: `plot-${String(i + 1).padStart(2, "0")}`,
  n: i + 1,
  angleDeg,
}));

/** Every plot on the door ring (doors + the service pavilion), sorted by bearing. */
export const RING_ANGLES: number[] = [...PORTALS.map((p) => p.angleDeg), SERVICE_ANGLE].sort((a, b) => a - b);
/** The entry axis (south) is kept clear up to this bearing either side of 180°: the gate approach. */
export const GATE_CLEAR_DEG = 161;
/** Bearings halfway between neighbouring plots (and between the last plots and the gate approach): seating
 *  clusters, ring planters and lamp posts stand here, off the promenades that run from the fountain to every door. */
export const MID_ANGLES: number[] = (() => {
  const out: number[] = [];
  for (let i = 0; i < RING_ANGLES.length - 1; i++) out.push((RING_ANGLES[i]! + RING_ANGLES[i + 1]!) / 2);
  const last = RING_ANGLES[RING_ANGLES.length - 1]!;
  // the wedge between the last plots and the entry axis: the cluster leans towards the gate (clear of the promenade)
  const south = (last + 180) / 2 - 3;
  out.push(south, -south);
  return out.sort((a, b) => a - b);
})();

export function ringPoint(angleDeg: number, r: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: r * Math.sin(a), z: -r * Math.cos(a), rotY: -a };
}

/** Door transform. The building's local +z faces the fountain; `entry` is where the "Enter" prompt triggers. */
export function portalTransform(p: PortalDef) {
  const d = ringPoint(p.angleDeg, DOOR_RING);
  const e = ringPoint(p.angleDeg, DOOR_RING - 2.4);
  return { x: d.x, z: d.z, rotY: d.rotY, entryX: e.x, entryZ: e.z };
}

/** Round obstacles inside the plaza (fountain, planters, totems). Player movement is pushed out of these. */
export interface Collider {
  x: number;
  z: number;
  r: number;
}

/** Planter islands on the plaza ring, between the building doors (raised flower planters: world/beds.ts). */
export const PLANTERS: { x: number; z: number; r: number }[] = MID_ANGLES.map((deg, i) => {
  const p = ringPoint(deg, PLAZA_RADIUS - 6);
  return { x: p.x, z: p.z, r: i % 2 ? 1.7 : 2.0 };
});

/** Digital totems: welcome board (west of spawn) and wallet kiosk (east of spawn), facing the arrivals. */
export const TOTEMS = [
  { id: "welcome", x: -6.5, z: SPAWN.z - 2.8, rotY: 0.55 },
  { id: "wallet", x: 6.5, z: SPAWN.z - 2.8, rotY: -0.55 },
] as const;

/** Wayfinding signs at the fountain court: each lists the four nearest plots with their walking distance. */
export const WAYFINDING = [-156, -133, 133, 156].map((deg) => {
  const p = ringPoint(deg, FOUNTAIN_COURT + 6);
  return { x: p.x, z: p.z, rotY: p.rotY, deg };
});
export interface WayRow {
  name: string;
  /** LED material key of the colour bar (District.ts) */
  led: string;
  /** walking distance to the door (m, rounded to 5) */
  m: number;
  deg: number;
}
export function wayfindingRows(w: { x: number; z: number; deg: number }): WayRow[] {
  const help = ringPoint(SERVICE_ANGLE, DOOR_RING - 2.4);
  const plots = [
    ...PORTALS.map((p) => {
      const t = portalTransform(p);
      return { deg: p.angleDeg, led: p.kind === "soon" ? "led-soon" : `led-${p.kind}`, name: p.href || p.kind === "arena" ? p.label : `${p.sub} (soon)`, x: t.entryX, z: t.entryZ };
    }),
    { deg: SERVICE_ANGLE, led: "led-sky", name: "Help desk, Cafe", x: help.x, z: help.z },
  ];
  return plots
    .map((p) => ({ name: p.name, led: p.led, deg: p.deg, gap: Math.abs(((p.deg - w.deg + 540) % 360) - 180), m: Math.round(Math.hypot(p.x - w.x, p.z - w.z) / 5) * 5 }))
    .sort((a, b) => a.gap - b.gap)
    .slice(0, 4)
    .sort((a, b) => a.deg - b.deg)
    .map(({ name, led, m, deg }) => ({ name, led, m, deg }));
}

/**
 * Timber benches on lava-stone plinths, all facing the fountain. Seat ids are claimed through the realtime server,
 * so the benches come from @gukirana/contracts (PLAZA_BENCHES): b0–b5 on the fountain court, then a pair either side
 * of the lamp in every seating cluster on MID_ANGLES (social/motion.test.ts checks the two agree).
 */
export const BENCH_COURT_RADIUS = PLAZA_BENCH_COURT.radius;
export const BENCH_CLUSTER_RADIUS = PLAZA_BENCH_CLUSTERS.radius;
export const BENCH_PLACES = PLAZA_BENCHES;
export const BENCHES = BENCH_PLACES.map((b) => ringPoint(b.deg, b.r));

/** Flower beds lining the entry promenade (spawn → fountain court), each side of the 7 m walk. */
export const PROMENADE_BEDS = [-1, 1].map((s) => ({ x: s * 4.0, z: (FOUNTAIN_COURT + 3 + SPAWN.z - 10) / 2, hw: 0.95, hd: (SPAWN.z - 10 - FOUNTAIN_COURT - 3) / 2 }));

export const COLLIDERS: Collider[] = [
  ...BENCHES.map((b) => ({ x: b.x, z: b.z, r: 1.05 })),
  { x: 0, z: 0, r: FOUNTAIN_RADIUS + 0.5 },
  ...PLANTERS.map((p) => ({ x: p.x, z: p.z, r: p.r + 0.35 })),
  ...TOTEMS.map((t) => ({ x: t.x, z: t.z, r: 1.1 })),
];

/** Door line of each building in its door frame (local z; negative = set back into the facade). */
export function doorInset(kind: PortalDef["kind"]): number {
  return kind === "arena" ? -1.15 : kind === "igisoro" ? -2.15 : kind === "pool" ? -0.55 : kind === "ludo" ? -0.4 : -0.45;
}

/** Depth of the entrance lobby behind a hall door (world/Vestibule): deep enough that the follow camera passes the
 *  door line behind you before you reach its far end (the hall takes over as the camera crosses). */
export const VESTIBULE_DEPTH = 4.2;

/** A point in a portal's door frame: lateral offset from the door centre (lx), depth towards the fountain (lz). */
export function doorLocal(p: PortalDef, x: number, z: number) {
  const t = portalTransform(p);
  const c = Math.cos(t.rotY);
  const s = Math.sin(t.rotY);
  const dx = x - t.x;
  const dz = z - t.z;
  return { lx: dx * c - dz * s, lz: dx * s + dz * c };
}
/** Inverse of `doorLocal`. */
export function doorWorld(p: PortalDef, lx: number, lz: number) {
  const t = portalTransform(p);
  const c = Math.cos(t.rotY);
  const s = Math.sin(t.rotY);
  return { x: t.x + lx * c + lz * s, z: t.z - lx * s + lz * c };
}
