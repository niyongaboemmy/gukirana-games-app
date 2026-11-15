import { ADMIN_BLOCK_ON } from "@/admin-block/flags";
import { FIGHT_ON } from "@/fight/flags";
import { inBuilding } from "./footprints";
import {
  ADMIN_ANGLE,
  COMPOUND_R,
  ENTRY_Z,
  FIGHT_ANGLE,
  EXPANSION_PLOTS,
  EXPANSION_RING,
  OUTER_PROMENADE,
  PLAZA_RADIUS,
  PORTALS,
  portalTransform,
  RING_ROAD,
  ringPoint,
} from "./layout";

/**
 * Campus master plan (P2-WLD-12, docs/CAMPUS-MASTER-PLAN.md): the arrival gate sits on the campus's south boundary,
 * on a public road; nothing is built south of it and the districts grow east, west and north. Pure data (no three.js,
 * no React) shared by the road / frontage geometry (Frontage.tsx, CampusRoads.tsx), the walk routing (Player.tsx,
 * obstacles.ts), the lawn beds and the tests (campus.test.ts).
 *
 * Coordinates as everywhere in the world: metres, north = −z, bearings clockwise from north (ringPoint).
 * The heart (plaza, inner halls, fountain, entry gate, arrival gate and the 16.5 m avenue between them) is unchanged.
 */

export type P = { x: number; z: number };

/* ---------------------------------------------------------------- frontage ---------------------------------------------------------------- */

/** The arrival gate's line (gate/Gate.tsx GATE_Z, repeated here so this module stays free of React / three.js). */
export const GATE_LINE_Z = ENTRY_Z + 16.5;
/** The campus boundary: the boundary wall runs east–west along this line, just behind the arrival gate forecourt. */
export const FRONTAGE_Z = 80;

/**
 * The compound: everything north of the boundary line inside the north arc, where the farmland begins. The arc is
 * COMPOUND_R (172 m) round the sides and grows to `growR` behind the plaza over growth band B (bearings ±100°), so
 * band B's reserved plots are inside the wall.
 */
export const COMPOUND = {
  southZ: FRONTAGE_Z,
  r: COMPOUND_R,
  growR: 245,
  /** bearings over which the arc steps out from r to growR */
  growDeg: [100, 115] as const,
} as const;
const smooth01 = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Radius (m) of the compound's north arc at a bearing (deg). */
export const compoundR = (deg: number) => COMPOUND.growR + (COMPOUND.r - COMPOUND.growR) * smooth01(COMPOUND.growDeg[0], COMPOUND.growDeg[1], Math.abs(deg));
const bearingOf = (x: number, z: number) => (Math.atan2(x, -z) * 180) / Math.PI;
export const inCompound = (x: number, z: number, margin = 0) => z <= COMPOUND.southZ - margin && Math.hypot(x, z) <= compoundR(bearingOf(x, z)) - margin;
/** x where the boundary wall's straight south line meets the arc */
export const COMPOUND_SOUTH_X = Math.sqrt(COMPOUND.r * COMPOUND.r - FRONTAGE_Z * FRONTAGE_Z);

/**
 * "Musanze Road": the public road along the frontage, straight east–west across the campus, running off into the
 * farmland both ways (east of the campus it bends south-east round Lake Ruhondo: `roadMid`). Two 3.5 m lanes
 * (right-hand traffic: westbound on the north lane) between 1.5 m footpaths with kerbs. z values are along the
 * straight; beyond the bend they are offsets from the centre line.
 */
export const PUBLIC_ROAD = (() => {
  const z0 = 86;
  const z1 = 96;
  const foot = 1.5;
  return { z0, z1, foot, lane: 3.5, c0: z0 + foot, c1: z1 - foot, mid: (z0 + z1) / 2, x0: -720, x1: 450 };
})();
/** The bend east of the campus: parabolic from x0, then straight at `slope` (dz / dx), clear of the lake shore. */
const BEND = { x0: 150, k: 0.015, slope: 2 } as const;
const BEND_T = BEND.slope / (2 * BEND.k);
const bend = (x: number) => {
  const t = x - BEND.x0;
  return t <= 0 ? 0 : t < BEND_T ? BEND.k * t * t : BEND.k * BEND_T * BEND_T + BEND.slope * (t - BEND_T);
};
const bendSlope = (x: number) => {
  const t = x - BEND.x0;
  return t <= 0 ? 0 : t < BEND_T ? 2 * BEND.k * t : BEND.slope;
};
/** The road's centre line z at x. */
export const roadMid = (x: number) => PUBLIC_ROAD.mid + bend(x);
/** A point `o` m off the road's centre line at x (o > 0 towards +z, perpendicular to the road). */
export function roadPoint(x: number, o: number): P & { rotY: number } {
  const s = bendSlope(x);
  const n = Math.hypot(1, s);
  return { x: x - (s / n) * o, z: roadMid(x) + o / n, rotY: Math.atan2(-s / n, 1 / n) };
}
/** Perpendicular distance (m, approx.) from the road's centre line. */
export const roadDist = (x: number, z: number) => Math.abs(z - roadMid(x)) / Math.hypot(1, bendSlope(x));
/** The road's height along x (flat across the campus, it follows the farmland beyond: Landscape.tsx flattens a
 *  corridor to this profile). */
export const roadY = (x: number) => {
  const t = Math.max(0, Math.abs(x) - 200);
  return t <= 0 ? 0 : Math.min(9, t * t * 0.00004);
};

/**
 * How far (m) a point lies outside the campus lawn (≤ 0 inside): the compound plus its frontage up to the public
 * road's far kerb. The single boundary the landscape keys off (terrain flattening, lawn ↔ farmland, trees,
 * countryside roads and villages). South of the road the value grows 3× faster, so the fields run right up to the
 * far footpath instead of fading in over 30 m.
 */
export function campusOutside(x: number, z: number, southRate = 3): number {
  return Math.max((z - PUBLIC_ROAD.z1) * southRate, Math.hypot(x, z) - compoundR(bearingOf(x, z)));
}

/**
 * Gate forecourt: the boundary wall opens across the forecourt; a one-way (westbound) drop-off lane in front of the
 * pedestrian forecourt joins the public road at both ends; two link roads lead from it into the campus loop road
 * through barrier arms, each with a guard post; a zebra crossing joins the bus stop across the road to the gate.
 */
export const FORECOURT = {
  /** boundary wall opening (x half-width) */
  openingHw: 31,
  /** drop-off lane (kerb to kerb), its two taper ends meet the carriageway */
  layby: { z0: 80.6, z1: 85.0, x0: -40, x1: 40, taper: 9 },
  /** kerbed island between the drop-off lane and the road's north footpath */
  island: { z0: 85.0, z1: PUBLIC_ROAD.z0 },
  /** pedestrian paving from the arrival gate's forecourt disc to the drop-off kerb */
  walk: { hw: 4.2, z0: 74.5, z1: 80.6 },
  /** link roads into the campus (lane centre x, half-width) */
  links: [-27, 27] as const,
  linkHw: 3,
  barrierZ: 76.4,
  /** zebra crossing (x centre, half-width) */
  crossing: { x: 0, hw: 2.5 },
} as const;
/** guard posts beside the barrier arms (booth centre) */
export const GUARD_POSTS = FORECOURT.links.map((x) => ({ x: x + Math.sign(x) * 5.4, z: FORECOURT.barrierZ + 0.4 }));
/** the service gate in the boundary wall (east): a short link from the loop road to the public road */
export const SERVICE_GATE = { x: 104, hw: 3.2 } as const;
/** bus and moto-taxi stop: the shelter across the road from the gate, the moto-taxi stand on the drop-off lane */
export const BUS_STOP = { x: 15, z: PUBLIC_ROAD.z1 + 1.4, w: 7, d: 2.2 } as const;
export const MOTO_STAND = { x0: -38.5, x1: -31, z: 83.6 } as const;

/** Boundary wall runs (straight south line, gaps at the gate and the service gate; then the north arc). */
export const WALL_RUNS: { x0: number; x1: number }[] = [
  { x0: -COMPOUND_SOUTH_X, x1: -FORECOURT.openingHw },
  { x0: FORECOURT.openingHw, x1: SERVICE_GATE.x - SERVICE_GATE.hw },
  { x0: SERVICE_GATE.x + SERVICE_GATE.hw, x1: COMPOUND_SOUTH_X },
];
export const WALL_H = 2.2;

/* ---------------------------------------------------------------- campus loop road ---------------------------------------------------------------- */

/** The campus loop: a 6 m service and shuttle road with 2 m footpaths (replaces the old ring road). */
export const LOOP = { hw: 3, foot: 2, r: (RING_ROAD.r0 + RING_ROAD.r1) / 2, southZ: 70, fillet: 25, linkFillet: 6 } as const;

/**
 * The loop's centre line, west link → south straight → around the north arc → south straight → east link (dense
 * polyline, ≤ 3 m between points). It leaves the forecourt through the barrier arms on both link roads.
 */
export const CAMPUS_LOOP: P[] = (() => {
  const out: P[] = [];
  const R = LOOP.r;
  const rho = LOOP.fillet;
  const zc = LOOP.southZ - rho;
  const xc = Math.sqrt((R - rho) ** 2 - zc * zc);
  const k = R / (R - rho);
  const tangent = { x: xc * k, z: zc * k };
  const bearT = (Math.atan2(tangent.x, -tangent.z) * 180) / Math.PI; // where the fillet meets the arc
  const phiT = (Math.atan2(tangent.z - zc, tangent.x - xc) * 180) / Math.PI;
  const lx = FORECOURT.links[1];
  const lr = LOOP.linkFillet;
  const arc = (cx: number, cz: number, r: number, a0: number, a1: number) => {
    const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * Math.PI * r) / 180 / 2.5));
    for (let i = 0; i <= n; i++) {
      const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
      out.push({ x: cx + r * Math.cos(a), z: cz + r * Math.sin(a) });
    }
  };
  const line = (a: P, b: P) => {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 3));
    for (let i = 1; i < n; i++) out.push({ x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n });
  };
  out.push({ x: -lx, z: FORECOURT.layby.z0 });
  line(out[0]!, { x: -lx, z: LOOP.southZ + lr });
  // west link corner (heading north, turning west)
  arc(-lx - lr, LOOP.southZ + lr, lr, 0, -90);
  line(out[out.length - 1]!, { x: -xc, z: LOOP.southZ });
  // south-west fillet onto the arc
  arc(-xc, zc, rho, 90, 180 - phiT);
  // the arc, bearing −bearT → +bearT through north
  const n = Math.ceil((2 * bearT * Math.PI * R) / 180 / 3);
  for (let i = 1; i < n; i++) {
    const b = -bearT + (2 * bearT * i) / n;
    const q = ringPoint(b, R);
    out.push({ x: q.x, z: q.z });
  }
  arc(xc, zc, rho, phiT, 90);
  line(out[out.length - 1]!, { x: lx + lr, z: LOOP.southZ });
  arc(lx + lr, LOOP.southZ + lr, lr, -90, -180);
  line(out[out.length - 1]!, { x: lx, z: FORECOURT.layby.z0 });
  out.push({ x: lx, z: FORECOURT.layby.z0 });
  // drop duplicates (joints of the pieces)
  return out.filter((p, i) => i === 0 || Math.hypot(p.x - out[i - 1]!.x, p.z - out[i - 1]!.z) > 0.05);
})();
/** bearing (deg) up to which the loop follows its arc either side of north */
export const LOOP_ARC_DEG = (() => {
  const R = LOOP.r;
  const rho = LOOP.fillet;
  const zc = LOOP.southZ - rho;
  const xc = Math.sqrt((R - rho) ** 2 - zc * zc);
  return (Math.atan2(xc, -zc) * 180) / Math.PI;
})();

/* ---------------------------------------------------------------- parking ---------------------------------------------------------------- */

/**
 * Car parks inside the wall, east and west of the forecourt, on both sides of the loop's south straights: marked
 * 2.5 × 5 m bays (every sixth bay a planter with a shade tree), a motorbike and bicycle row by the forecourt.
 */
export const PARKING = { x0: 38, x1: 80.5, bay: 2.5, depth: 5, rows: [{ z0: LOOP.southZ - LOOP.hw - 5, z1: LOOP.southZ - LOOP.hw }, { z0: LOOP.southZ + LOOP.hw, z1: LOOP.southZ + LOOP.hw + 5 }] } as const;
export interface Bay {
  x: number;
  z: number;
  /** facing (rotation about y) of a car parked nose-in */
  rotY: number;
  tree: boolean;
  /** stable index (deterministic vehicle choice) */
  i: number;
}
export const PARKING_BAYS: Bay[] = (() => {
  const out: Bay[] = [];
  let i = 0;
  for (const side of [-1, 1])
    PARKING.rows.forEach((row, ri) => {
      const n = Math.floor((PARKING.x1 - PARKING.x0) / PARKING.bay);
      for (let k = 0; k < n; k++) {
        const x = side * (PARKING.x0 + PARKING.bay * (k + 0.5));
        out.push({ x, z: (row.z0 + row.z1) / 2, rotY: ri === 0 ? Math.PI : 0, tree: k % 6 === 3, i: i++ });
      }
    });
  return out;
})();
/** motorbike / bicycle bays (1.1 × 2.2 m) by the forecourt, north of the loop straights */
export const MOTO_BAYS: Bay[] = (() => {
  const out: Bay[] = [];
  let i = 0;
  for (const side of [-1, 1])
    for (let x = 31.4; x < 37.2; x += 1.1) out.push({ x: side * x, z: LOOP.southZ - LOOP.hw - 1.2, rotY: Math.PI, tree: false, i: i++ });
  return out;
})();

/* ---------------------------------------------------------------- districts and plots ---------------------------------------------------------------- */

export interface District {
  id: "east" | "west" | "northEast" | "northWest" | "view";
  /** bearing range (deg) */
  from: number;
  to: number;
}
export const DISTRICTS: District[] = [
  { id: "west", from: -115, to: -60 },
  { id: "northWest", from: -60, to: -30 },
  { id: "view", from: -25, to: 25 },
  // (P2-WLD-14: the north-east district takes the Administrative Block at 62°; the east district is the Fight Games
  // building, its pavilion on the plaza and the Boxing hall's body behind it)
  { id: "northEast", from: 30, to: 70 },
  { id: "east", from: 70, to: 115 },
];
export const districtOf = (deg: number) => DISTRICTS.find((d) => deg >= d.from && deg <= d.to)?.id ?? null;
/** The volcano view corridor behind the arena stays low: no hall plots here. */
export const VIEW_CORRIDOR_DEG = 25;
/** The Administrative Block's site in the north-east district (P2-WLD-14: off the +88° plaza plot). */
export const ADMIN_SITE_DEG = ADMIN_ANGLE;
/**
 * The Fight Games building (P2-WLD-14): its door on the plaza's door ring at FIGHT_ANGLE, the Boxing hall's long body
 * running straight back from the pavilion through the east district (fight/plan.ts FIGHT_BUILDING).
 */
export const FIGHT_SITE_DEG = FIGHT_ANGLE;
/** Growth band B (north): reserved hall plots, defined but not built. */
export const GROWTH_BAND = { r0: 175, r1: 235, deg: 100 } as const;
export const GROWTH_RING = 185;
export const GROWTH_PLOTS: { id: string; angleDeg: number; ring: number }[] = [-91, -72, -53, -34, 34, 53, 72, 91].map((angleDeg, i) => ({
  id: `growth-${String(i + 1).padStart(2, "0")}`,
  angleDeg,
  ring: GROWTH_RING,
}));

/* ---------------------------------------------------------------- walks ---------------------------------------------------------------- */

/** Walks are walkable ground (click-to-walk, camera follow) while a hall stands beyond the plaza (the Administrative
 *  Block, P2-WLD-14), with the Fight hall on, or with the campus walks flag. */
export const CAMPUS_WALKS_ON = ADMIN_BLOCK_ON || FIGHT_ON || process.env.NEXT_PUBLIC_FF_CAMPUS_WALKS === "1";
/** promenade centre line radius */
export const PROMENADE_R = (OUTER_PROMENADE.r0 + OUTER_PROMENADE.r1) / 2;
/** The outer promenade is kept only north of the gate line (west end, bearing −PROMENADE_DEG). */
export const PROMENADE_DEG = 115;
/**
 * …and in the east it ends at the Boxing hall's long body (P2-WLD-14), which runs out from its plaza pavilion at 88°
 * across the promenade's old course: the promenade spans bearings −PROMENADE_DEG … +PROMENADE_EAST_DEG.
 */
export const PROMENADE_EAST_DEG = 76;
/** Is a bearing (deg) on the promenade's arc? */
export const onPromenadeArc = (deg: number) => deg >= -PROMENADE_DEG && deg <= PROMENADE_EAST_DEG;
const EXIT_R = PLAZA_RADIUS - 1.5;

/**
 * District walks from the plaza edge (plan §3.3), threaded between the inner halls: the bearings of the plan
 * (±66°, ±105°) moved to the real gaps between the hall footprints (checked in campus.test.ts: ≥ 0.4 m from every
 * wall). Each: plaza exit → bends past the hall corners → the outer promenade. P2-WLD-14: the Fight Games door is on
 * the plaza now, so its walk, gateway arch and bollards (P2-WLD-13) are gone; the north-east walk leaves the plaza
 * at 58° between the Ludo Lounge and the Fight Games pavilion, passes between the Ludo hall's corner and the Boxing
 * hall's north wall, then turns north past the Ludo hall's back onto the promenade at 57°, between the north-east plot
 * and the Administrative Block. The east walk
 * went with the promenade's east end: the Boxing hall's body fills the east district.
 * (: the walk starts at the plaza edge; a fork starts on another walk's corner instead.)
 */
export type WalkId = "west" | "northWest" | "northEast";
export const DISTRICT_WALKS: { id: WalkId; pts: P[]; hw: number; exit: boolean }[] = (
  [
    { id: "west", pts: [ringPoint(-110, EXIT_R), ringPoint(-115, 62), ringPoint(-115, PROMENADE_R)], hw: 1.5, exit: true },
    { id: "northWest", pts: [ringPoint(-64, EXIT_R), ringPoint(-64, 44), ringPoint(-72, 72), ringPoint(-52, PROMENADE_R)], hw: 1.5, exit: true },
    { id: "northEast", pts: [ringPoint(58, EXIT_R), ringPoint(67.5, 52), ringPoint(70, 75), ringPoint(57, PROMENADE_R)], hw: 1.5, exit: true },
  ] as const
).map((w) => ({ id: w.id, hw: w.hw, exit: w.exit as boolean, pts: w.pts.map((q) => ({ x: q.x, z: q.z })) }));

export interface WalkLeg {
  a: number;
  b: number;
  hw: number;
}
export interface WalkGraph {
  nodes: P[];
  legs: WalkLeg[];
  /** plaza exit node of each district walk */
  exits: number[];
  /** node in front of each door the walks lead to (plot / portal id → node) */
  doors: Record<string, number>;
}

/** A door the walks lead to: the expansion plots' site gates and the outer-ring portals (the Fight hall). */
export const WALK_DOORS: { id: string; angleDeg: number }[] = [
  ...EXPANSION_PLOTS.map((e) => ({ id: e.id, angleDeg: e.angleDeg })),
  ...PORTALS.filter((p) => p.ring === EXPANSION_RING).map((p) => ({ id: p.id, angleDeg: p.angleDeg })),
];

/**
 * CAMPUS_WALKS: the walk network as a small graph (the generalised Fight walk). Legs are straight segments with a
 * half-width; walkable ground is the union of the legs. District walks + the outer promenade arc (polyline) + a
 * spur from the promenade to every door.
 */
export const CAMPUS_WALKS: WalkGraph = (() => {
  const nodes: P[] = [];
  const legs: WalkLeg[] = [];
  const node = (p: P) => {
    const i = nodes.findIndex((q) => Math.hypot(q.x - p.x, q.z - p.z) < 0.05);
    if (i >= 0) return i;
    nodes.push({ x: p.x, z: p.z });
    return nodes.length - 1;
  };
  const exits: number[] = [];
  const bearing = (p: P) => (Math.atan2(p.x, -p.z) * 180) / Math.PI;
  const promBears = new Set<number>();
  for (let b = -PROMENADE_DEG; b <= PROMENADE_EAST_DEG + 1e-6; b += 2.5) promBears.add(Math.round(b * 100) / 100);
  promBears.add(PROMENADE_EAST_DEG);
  for (const w of DISTRICT_WALKS) {
    const ids = w.pts.map(node);
    if (w.exit) exits.push(ids[0]!);
    for (let i = 0; i < ids.length - 1; i++) legs.push({ a: ids[i]!, b: ids[i + 1]!, hw: w.hw });
    promBears.add(Math.round(bearing(w.pts[w.pts.length - 1]!) * 100) / 100);
  }
  const doors: Record<string, number> = {};
  const onArc = WALK_DOORS.filter((d) => onPromenadeArc(d.angleDeg));
  for (const d of onArc) promBears.add(d.angleDeg);
  const bears = [...promBears].sort((a, b) => a - b);
  const prom = bears.map((b) => {
    const q = ringPoint(b, PROMENADE_R);
    return node({ x: q.x, z: q.z });
  });
  const promHw = (OUTER_PROMENADE.r1 - OUTER_PROMENADE.r0) / 2;
  for (let i = 0; i < prom.length - 1; i++) legs.push({ a: prom[i]!, b: prom[i + 1]!, hw: promHw });
  for (const d of onArc) {
    const q = ringPoint(d.angleDeg, EXPANSION_RING - 0.6);
    const at = prom[bears.indexOf(d.angleDeg)]!;
    const door = node({ x: q.x, z: q.z });
    legs.push({ a: at, b: door, hw: 2.3 });
    doors[d.id] = door;
  }
  return { nodes, legs, exits, doors };
})();

function segPoint(a: P, b: P, x: number, z: number) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
  return { x: a.x + dx * t, z: a.z + dz * t };
}

/** How far (m) a point is inside the walk network (> 0 inside), the nearest centre-line point and its leg. */
export function walkDepth(x: number, z: number): { depth: number; at: P & { hw: number }; leg: number } {
  const { nodes, legs } = CAMPUS_WALKS;
  let best = -Infinity;
  let at = { x, z, hw: 0 };
  let leg = -1;
  for (let i = 0; i < legs.length; i++) {
    const l = legs[i]!;
    const a = nodes[l.a]!;
    const b = nodes[l.b]!;
    // cheap reject: bounding box of the leg grown by its half-width + 8 m
    const m = l.hw + 8;
    if (x < Math.min(a.x, b.x) - m || x > Math.max(a.x, b.x) + m || z < Math.min(a.z, b.z) - m || z > Math.max(a.z, b.z) + m) continue;
    const q = segPoint(a, b, x, z);
    const d = l.hw - Math.hypot(x - q.x, z - q.z);
    if (d > best) {
      best = d;
      at = { x: q.x, z: q.z, hw: l.hw };
      leg = i;
    }
  }
  return { depth: best, at, leg };
}
/** Is the point on (or within `margin` of) a walk? Layout only (beds, walls keep clear) — not gated by the flag. */
export const nearCampusWalk = (x: number, z: number, margin = 0) => walkDepth(x, z).depth > -margin;
/** Walkable: on a walk, with the walks switched on. */
export const onCampusWalk = (x: number, z: number, margin = 0) => CAMPUS_WALKS_ON && walkDepth(x, z).depth > -margin;

/**
 * Keep a body on the walks (outside the plaza disc): a step off an edge slides back onto it. Returns false when the
 * point is nowhere near a walk (the caller then falls back to the plaza edge).
 */
export function clampToCampusWalk(p: P, body = 0.32): boolean {
  if (!CAMPUS_WALKS_ON) return false;
  const { depth, at } = walkDepth(p.x, p.z);
  if (depth >= body) return true;
  if (depth < -1.2) return false;
  const dx = p.x - at.x;
  const dz = p.z - at.z;
  const d = Math.hypot(dx, dz) || 1;
  const r = Math.max(0, at.hw - body);
  p.x = at.x + (dx / d) * r;
  p.z = at.z + (dz / d) * r;
  return true;
}

/** A waypoint; `plaza`: reach it across the plaza (the caller routes around the plaza furniture). */
export type WalkStep = P & { plaza?: boolean };
// (the plaza's edge band counts as plaza unless it is the mouth of a walk: a hall's doorstep, P2-WLD-13)
const inPlaza = (p: P) => Math.hypot(p.x, p.z) < PLAZA_RADIUS - 1.5 || (Math.hypot(p.x, p.z) < PLAZA_RADIUS && walkDepth(p.x, p.z).depth <= 0);

/**
 * Waypoints from one point to another over the walk network (either may be in the plaza): shortest path over the
 * graph (Dijkstra), crossing the plaza between walk exits where that is shorter. Ends at `to`.
 */
export function campusWalkRoute(from: P, to: P): WalkStep[] {
  const { nodes, legs, exits } = CAMPUS_WALKS;
  const fromIn = inPlaza(from);
  const toIn = inPlaza(to);
  if (fromIn && toIn) return [{ ...to, plaza: true }];
  const lf = fromIn ? -1 : walkDepth(from.x, from.z).leg;
  const lt = toIn ? -1 : walkDepth(to.x, to.z).leg;
  if (lf >= 0 && lf === lt) return [{ x: to.x, z: to.z }];
  const N = nodes.length;
  const S = N;
  const T = N + 1;
  type E = { to: number; w: number; plaza: boolean };
  const adj: E[][] = Array.from({ length: N + 2 }, () => []);
  const link = (a: number, b: number, w: number, plaza = false) => {
    adj[a]!.push({ to: b, w, plaza });
    adj[b]!.push({ to: a, w, plaza });
  };
  const at = (i: number) => (i === S ? from : i === T ? to : nodes[i]!);
  const dist = (a: number, b: number) => Math.hypot(at(a).x - at(b).x, at(a).z - at(b).z);
  for (const l of legs) link(l.a, l.b, dist(l.a, l.b));
  for (let i = 0; i < exits.length; i++) for (let j = i + 1; j < exits.length; j++) link(exits[i]!, exits[j]!, dist(exits[i]!, exits[j]!), true);
  const ends = (v: number, inside: boolean, leg: number) => {
    if (inside) for (const e of exits) link(v, e, dist(v, e), true);
    else for (const n of [legs[leg]!.a, legs[leg]!.b]) link(v, n, dist(v, n));
  };
  ends(S, fromIn, lf);
  ends(T, toIn, lt);
  const g = new Float64Array(N + 2).fill(Infinity);
  const prev = new Int32Array(N + 2).fill(-1);
  const viaPlaza = new Uint8Array(N + 2);
  const done = new Uint8Array(N + 2);
  g[S] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < N + 2; i++) if (!done[i] && g[i]! < Infinity && (u < 0 || g[i]! < g[u]!)) u = i;
    if (u < 0 || u === T) break;
    done[u] = 1;
    for (const e of adj[u]!) {
      const v = g[u]! + e.w;
      if (v < g[e.to]!) {
        g[e.to] = v;
        prev[e.to] = u;
        viaPlaza[e.to] = e.plaza ? 1 : 0;
      }
    }
  }
  if (prev[T]! < 0) return [{ x: to.x, z: to.z }];
  const out: WalkStep[] = [];
  for (let v = T; v !== S && v >= 0; v = prev[v]!) out.push(viaPlaza[v] ? { ...at(v), plaza: true } : { x: at(v).x, z: at(v).z });
  return out.reverse();
}

/** Walking distance (m) over the network from a point to another (the route's length). */
export function campusWalkLength(from: P, to: P): number {
  let len = 0;
  let at = from;
  for (const w of campusWalkRoute(from, to)) {
    len += Math.hypot(w.x - at.x, w.z - at.z);
    at = w;
  }
  return len;
}

/* ---------------------------------------------------------------- service spurs ---------------------------------------------------------------- */

/** Short service spurs from the loop's arc to the back of every plot (service yard), radial on the plot axis. */
export function serviceSpur(angleDeg: number, backR: number) {
  return { angleDeg, r0: backR + 0.4, r1: LOOP.r - LOOP.hw + 0.2, hw: 3.2, yardHw: 7, yardR1: backR + 5.5 };
}

/* ---------------------------------------------------------------- surfaces (beds keep clear) ---------------------------------------------------------------- */

function distToPolyline(pts: P[], x: number, z: number) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (x < Math.min(a.x, b.x) - 12 || x > Math.max(a.x, b.x) + 12 || z < Math.min(a.z, b.z) - 12 || z > Math.max(a.z, b.z) + 12) continue;
    const q = segPoint(a, b, x, z);
    best = Math.min(best, Math.hypot(x - q.x, z - q.z));
  }
  return best;
}
/** Distance (m) from the loop road's centre line. */
export const loopDistance = (x: number, z: number) => distToPolyline(CAMPUS_LOOP, x, z);

/** Is the point on a road, a car park, the forecourt or the public road (incl. footpaths), within `margin`? */
export function onCampusRoad(x: number, z: number, margin = 0): boolean {
  if (z > PUBLIC_ROAD.z0 - margin && z < PUBLIC_ROAD.z1 + margin) return true;
  if (z > FORECOURT.layby.z0 - margin && z < FORECOURT.island.z1 + margin && Math.abs(x) < FORECOURT.layby.x1 + FORECOURT.layby.taper + margin) return true;
  if (loopDistance(x, z) < LOOP.hw + LOOP.foot + margin) return true;
  if (Math.abs(x) > PARKING.x0 - 2 - margin && Math.abs(x) < PARKING.x1 + margin && z > PARKING.rows[0].z0 - 2 - margin && z < PARKING.rows[1].z1 + 2 + margin) return true;
  if (Math.abs(x - SERVICE_GATE.x) < SERVICE_GATE.hw + margin && z > LOOP.southZ && z < PUBLIC_ROAD.z0 + margin) return true;
  return false;
}

/* ---------------------------------------------------------------- road furniture ---------------------------------------------------------------- */

/** A street light: base position, facing (local +z, the arm, points over the road), base height. */
export interface Lamp {
  x: number;
  z: number;
  y: number;
  rotY: number;
}
/** Street lights: every 30 m along the public road's north footpath, about every 32 m along the loop's inner footpath
 *  (the car parks are lit from their planter islands). */
export const STREET_LIGHTS: Lamp[] = (() => {
  const out: Lamp[] = [];
  for (let x = -315; x <= 315; x += 30) if (Math.abs(x) > 6) { const q = roadPoint(x, PUBLIC_ROAD.z0 + 0.55 - PUBLIC_ROAD.mid); out.push({ x: q.x, z: q.z, y: roadY(q.x), rotY: q.rotY }); }
  let acc = 10;
  for (let i = 0; i < CAMPUS_LOOP.length - 1; i++) {
    const a = CAMPUS_LOOP[i]!;
    const b = CAMPUS_LOOP[i + 1]!;
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    acc += L;
    if (acc < 32) continue;
    acc = 0;
    const tx = (b.x - a.x) / L;
    const tz = (b.z - a.z) / L;
    // the side towards the campus centre (inner footpath)
    let nx = -tz;
    let nz = tx;
    if (nx * -a.x + nz * -a.z < 0) {
      nx = -nx;
      nz = -nz;
    }
    const off = LOOP.hw + LOOP.foot - 0.45;
    const x = a.x + nx * off;
    const z = a.z + nz * off;
    if (Math.abs(x) > PARKING.x0 - 3 && Math.abs(x) < PARKING.x1 + 3 && z > PARKING.rows[0].z0 - 3) continue;
    if (Math.abs(Math.abs(x) - SERVICE_GATE.x) < 6 && z > LOOP.southZ) continue;
    if (z > FORECOURT.barrierZ - 3) continue;
    out.push({ x, z, y: 0, rotY: Math.atan2(-nx, -nz) });
  }
  // car parks: a light in every second planter island
  PARKING_BAYS.filter((b) => b.tree).forEach((b, i) => {
    if (i % 2 === 0) out.push({ x: b.x + 0.9, z: b.z + (b.rotY ? 1.8 : -1.8), y: 0, rotY: b.rotY ? 0 : Math.PI });
  });
  return out;
})();

/** Bollards along the drop-off kerb (gaps for the pedestrian gate and the link roads). */
export const BOLLARDS: P[] = (() => {
  const out: P[] = [];
  for (let x = -22.6; x <= 22.61; x += 1.6) if (Math.abs(x) > FORECOURT.walk.hw + 0.3) out.push({ x, z: FORECOURT.layby.z0 - 0.35 });
  return out;
})();

/** A hash in [0, 1) of an integer (deterministic choices: no Math.random in the world). */
export const hash01 = (i: number, salt = 0) => {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2d);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/* ---------------------------------------------------------------- wayfinding ---------------------------------------------------------------- */

/** A wayfinding totem at a walk junction: district, and the nearest doors with walking distance (m) and time (s). */
export interface WalkTotem {
  x: number;
  z: number;
  rotY: number;
  district: District["id"] | "plaza";
  rows: { id: string; m: number; s: number }[];
}
const WALK_PACE = 2.2;
/** door entry point of a walk door (portal entry or the site gate) */
export function walkDoorPoint(id: string): P {
  const portal = PORTALS.find((p) => p.id === id);
  if (portal) {
    const t = portalTransform(portal);
    return { x: t.entryX, z: t.entryZ };
  }
  const e = EXPANSION_PLOTS.find((q) => q.id === id)!;
  const q = ringPoint(e.angleDeg, EXPANSION_RING - 2.4);
  return { x: q.x, z: q.z };
}
/**
 * Totems at every junction of the walks with the plaza edge and with the outer promenade (plan §3.3): beside the
 * walk, clear of buildings, facing back along it; each lists the three nearest doors by walking distance.
 */
export const WALK_TOTEMS: WalkTotem[] = (() => {
  const out: WalkTotem[] = [];
  const rowsFrom = (p: P) =>
    WALK_DOORS.filter((d) => onPromenadeArc(d.angleDeg))
      .map((d) => {
        const m = campusWalkLength(p, walkDoorPoint(d.id));
        return { id: d.id, m: Math.round(m / 5) * 5, s: Math.round(m / WALK_PACE / 5) * 5 };
      })
      .sort((a, b) => a.m - b.m)
      .slice(0, 3);
  const place = (at: P, dir: P, hw: number, district: WalkTotem["district"]) => {
    for (const side of [1, -1]) {
      const x = at.x - dir.z * side * (hw + 0.9);
      const z = at.z + dir.x * side * (hw + 0.9);
      if (inBuilding(x, z, 0.8) || walkDepth(x, z).depth > -0.3) continue;
      out.push({ x, z, rotY: Math.atan2(-dir.x, -dir.z), district, rows: rowsFrom(at) });
      return;
    }
  };
  for (const w of DISTRICT_WALKS) {
    if (!w.exit) continue;
    const a = w.pts[0]!;
    const b = w.pts[1]!;
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const dir = { x: (b.x - a.x) / L, z: (b.z - a.z) / L };
    const k = (PLAZA_RADIUS + 4.5 - EXIT_R) / L;
    place({ x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k }, dir, w.hw, districtOf((Math.atan2(b.x, -b.z) * 180) / Math.PI) ?? "plaza");
  }
  for (const w of DISTRICT_WALKS) {
    const end = w.pts[w.pts.length - 1]!;
    if (Math.abs(Math.hypot(end.x, end.z) - PROMENADE_R) > 0.1) continue;
    const r = Math.hypot(end.x, end.z);
    // on the outer edge of the promenade, facing the walk that arrives
    const q = { x: (end.x / r) * (OUTER_PROMENADE.r1 + 1.0), z: (end.z / r) * (OUTER_PROMENADE.r1 + 1.0) };
    if (inBuilding(q.x, q.z, 0.8) || walkDepth(q.x, q.z).depth > -0.3) continue;
    out.push({ x: q.x, z: q.z, rotY: Math.atan2(-end.x, -end.z), district: districtOf((Math.atan2(end.x, -end.z) * 180) / Math.PI) ?? "view", rows: rowsFrom(end) });
  }
  // the forks (P2-WLD-13): a totem where a walk leaves another one behind the halls (the north-east walk off the Fight
  // Games walk), a few metres along the fork, facing back towards the plaza
  for (const w of DISTRICT_WALKS) {
    if (w.exit) continue;
    const a = w.pts[0]!;
    const b = w.pts[1]!;
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const dir = { x: (b.x - a.x) / L, z: (b.z - a.z) / L };
    place({ x: a.x + dir.x * 5, z: a.z + dir.z * 5 }, dir, w.hw, districtOf((Math.atan2(b.x, -b.z) * 180) / Math.PI) ?? "plaza");
  }
  return out;
})();

/* ---------------------------------------------------------------- campus trees ---------------------------------------------------------------- */

/**
 * Shade trees inside the compound (plan §3.4): one in every car-park planter island, trees along the district walks
 * (alternating sides, clear of buildings, walks and roads) and small clusters on the lawns between the district
 * plots inside the loop. The volcano corridor stays open. Deterministic (hashes), drawn by Landscape's tree species.
 */
export function campusTrees(): { x: number; z: number; rotY: number; s: number }[] {
  const out: { x: number; z: number; rotY: number; s: number }[] = [];
  let i = 0;
  const ok = (x: number, z: number) =>
    !inBuilding(x, z, 3) &&
    !nearCampusWalk(x, z, 1.8) &&
    !onCampusRoad(x, z, 1.5) &&
    Math.hypot(x, z) > PLAZA_RADIUS + 9 &&
    Math.abs((Math.atan2(x, -z) * 180) / Math.PI) > VIEW_CORRIDOR_DEG &&
    out.every((t) => Math.hypot(t.x - x, t.z - z) > 6);
  const add = (x: number, z: number, s = 0.8) => {
    out.push({ x, z, rotY: hash01(i, 31) * Math.PI * 2, s: s + hash01(i, 32) * 0.3 });
    i++;
  };
  for (const b of PARKING_BAYS) if (b.tree) add(b.x, b.z, 0.7);
  for (const w of DISTRICT_WALKS)
    for (let k = 0; k < w.pts.length - 1; k++) {
      const a = w.pts[k]!;
      const b = w.pts[k + 1]!;
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      for (let t = 8; t < L - 4; t += 11) {
        const side = (Math.floor(t / 11) + k) % 2 ? 1 : -1;
        const x = a.x + ((b.x - a.x) * t) / L - ((b.z - a.z) / L) * side * (w.hw + 3.2);
        const z = a.z + ((b.z - a.z) * t) / L + ((b.x - a.x) / L) * side * (w.hw + 3.2);
        if (ok(x, z)) add(x, z);
      }
    }
  for (const deg of [-108, -80, -50, 50, 108])
    for (let k = 0; k < 4; k++) {
      const r = 128 + (hash01(k + Math.abs(deg), 41) - 0.5) * 14;
      const d = deg + (hash01(k + Math.abs(deg), 42) - 0.5) * 6;
      const q = ringPoint(d, r);
      if (ok(q.x, q.z)) add(q.x, q.z, 0.9);
    }
  return out;
}
