import { ARENA_BOWL } from "@gukirana/contracts";

/**
 * Tournament Arena floor plan (P2-ARN-03): pure geometry shared by the interior (rooms/TournamentArena.tsx), the
 * controller hooks (arena/hooks.ts), the HUD seat finder and the tests. Metres, hall frame: the bowl centre is the
 * origin, the entrance door is on the south wall at z = ARENA_DOOR_Z (+z), angles θ are measured from +z (south)
 * towards +x (east), in degrees.
 *
 *            north: players' tunnel (lower gap 168°–192°) + media gantry (upper gap 162°–198°)
 *        U5 U6 V3 V4 U7 U8   upper tier (r 20.3–25.1, rising outward)   U4 U3 V2 V1 U2 U1
 *        ──────── concourse ring (cross-aisle, r 17.3–20.3, y = 0) ────────
 *        G H I J K L         lower bowl (r 12.2–17.3, falling to the floor)  F E D C B A
 *                       competition floor (r < 12.1, y = FLOOR_Y): stage + feature tables
 *            south: entry portal through the upper-tier gap (342°–18°), lobby, door
 *
 * Seat ids and counts come from @gukirana/contracts (ARENA_BOWL): `{section}-{row}-{seat}`, row 1 = nearest the
 * floor, seats numbered from the section's low-angle edge.
 */

export const ARENA_SIZE = { w: 56, d: 68.8, h: 18 } as const;
export const ARENA_DOOR_Z = ARENA_SIZE.d / 2;
export const ARENA_COLOR = "#9B51E0";

export const FLOOR_Y = -3.2;
/** competition floor (inside the front barrier) */
export const FLOOR_R = 12.1;
/** lower bowl: row treads [front + (i-1)·depth, + depth], the rake rises 0.5 m per metre towards the concourse */
export const LOWER = { front: 12.175, depth: 0.85, rows: ARENA_BOWL.lower.rows, slope: 0.5 } as const;
export const LOWER_BACK = LOWER.front + LOWER.depth * LOWER.rows; // 17.275
export const CONCOURSE = { r0: 17.3, r1: 20.3, mid: 18.8 } as const;
/** upper tier: treads [r0 + (j-1)·depth, + depth], rising 0.533 m per metre outward */
export const UPPER = { r0: 20.3, depth: 0.9, rows: ARENA_BOWL.upper.rows, slope: 0.48 / 0.9 } as const;
export const UPPER_BACK = UPPER.r0 + UPPER.depth * UPPER.rows; // 24.8
export const OUTER_R = 26.2;
/** media gantry (north, behind the players' tunnel): a raised viewpoint reached by a short stair at 180° */
export const GANTRY = { a0: 162, a1: 198, r0: 21.6, y: 1.6, steps: 6 } as const;
/** restrooms behind the lobby side walls (one each side), entered through a door at doorZ */
export const RESTROOM = { z0: 31.6, z1: 34.0, depth: 2.4, doorZ: 33.0, doorW: 1.2 } as const;
/** steps of the players' tunnel stair */
export const TUNNEL_STEPS = 12;
/** VIP boxes: raised floor between the box front and the back wall */
export const VIP = { floorY: 0.9, front: 21.3, back: 25.8, seatR: 22.1, stairOff: 2.6 } as const;
/** lobby between the bowl wall and the entrance wall */
export const LOBBY = { hw: 14.6, z1: ARENA_DOOR_Z } as const;
/** entry portal from the lobby through the upper-tier gap onto the concourse */
export const PORTAL_HW = 3.0;
/** players' walk-in tunnel (north, through the lower-bowl gap) and its stair down to the floor */
export const PLAYERS_TUNNEL_HW = 1.4;

const D2R = Math.PI / 180;
const norm = (deg: number) => ((deg % 360) + 360) % 360;
/** shortest signed angle a − b (deg) */
const dAng = (a: number, b: number) => ((a - b + 540) % 360) - 180;
export const angleOf = (x: number, z: number) => norm(Math.atan2(x, z) / D2R);
export const polar = (r: number, deg: number) => ({ x: r * Math.sin(deg * D2R), z: r * Math.cos(deg * D2R) });
/** avatar yaw facing the bowl centre from (x, z) (forward = (sin yaw, cos yaw)) */
export const yawToCentre = (x: number, z: number) => Math.atan2(-x, -z);

export interface Section {
  id: string;
  tier: "lower" | "upper" | "vip";
  /** slot start / end angle (deg) */
  a0: number;
  a1: number;
  rows: number;
  seats: number;
}

const LOWER_STARTS = [0, 28, 56, 84, 112, 140, 192, 220, 248, 276, 304, 332];
const UPPER_SLOTS: [number, number][] = [
  [18, 44],
  [44, 70],
  [110, 136],
  [136, 162],
  [198, 224],
  [224, 250],
  [290, 316],
  [316, 342],
];
const VIP_SLOTS: [number, number][] = [
  [70, 90],
  [90, 110],
  [250, 270],
  [270, 290],
];
export const SECTIONS: Section[] = [
  ...ARENA_BOWL.lower.sections.map((id, i) => ({ id, tier: "lower" as const, a0: LOWER_STARTS[i]!, a1: LOWER_STARTS[i]! + 28, rows: ARENA_BOWL.lower.rows, seats: ARENA_BOWL.lower.seats })),
  ...ARENA_BOWL.upper.sections.map((id, i) => ({ id, tier: "upper" as const, a0: UPPER_SLOTS[i]![0], a1: UPPER_SLOTS[i]![1], rows: ARENA_BOWL.upper.rows, seats: ARENA_BOWL.upper.seats })),
  ...ARENA_BOWL.vip.sections.map((id, i) => ({ id, tier: "vip" as const, a0: VIP_SLOTS[i]![0], a1: VIP_SLOTS[i]![1], rows: ARENA_BOWL.vip.rows, seats: ARENA_BOWL.vip.seats })),
];
export const sectionById = (id: string) => SECTIONS.find((s) => s.id === id);

/** aisle centre angles (deg): lower stair aisles at every lower slot edge, upper stair aisles at every upper slot edge */
export const LOWER_AISLES = [...new Set(SECTIONS.filter((s) => s.tier === "lower").flatMap((s) => [s.a0, norm(s.a1)]))].sort((a, b) => a - b);
// (none against a VIP box wall: those sections are reached from their other edge)
export const UPPER_AISLES = [...new Set(SECTIONS.filter((s) => s.tier === "upper").flatMap((s) => [s.a0, s.a1]))]
  .filter((a) => !VIP_SLOTS.some(([v0, v1]) => Math.abs(a - v0) < 0.01 || Math.abs(a - v1) < 0.01))
  // nor against the portal blocks / media gantry (each upper section is reached along its rows from the shared aisle)
  .filter((a) => ![18, 162, 198, 342].includes(a))
  .sort((a, b) => a - b);
/** seat margin inside a slot (deg, each side): the aisle half */
const LOWER_MARGIN = 2.2;
const UPPER_MARGIN = 1.5;
const VIP_SPAN = 12; // the 6 VIP seats share the middle 12° of the box
/** walking half-width of a stair aisle (lateral, m) */
const AISLE_HW = { lower: 0.32, upper: 0.36 } as const;

export const lowerTreadY = (row: number) => (LOWER.front + LOWER.depth * (row - 0.5) - LOWER_BACK) * LOWER.slope;
export const upperTreadY = (row: number) => (UPPER.depth * (row - 0.5)) * UPPER.slope;

export interface BowlSeat {
  id: string;
  /** section id (used as the "table" of the generic hall seat model) */
  table: string;
  x: number;
  z: number;
  y: number;
  yaw: number;
  /** angle (deg) and radius of the seat, row and seat number */
  a: number;
  r: number;
  row: number;
  n: number;
}

function seatAngle(s: Section, n: number) {
  if (s.tier === "vip") {
    const mid = (s.a0 + s.a1) / 2;
    return mid - VIP_SPAN / 2 + (n - 0.5) * (VIP_SPAN / s.seats);
  }
  const m = s.tier === "lower" ? LOWER_MARGIN : UPPER_MARGIN;
  return s.a0 + m + (n - 0.5) * ((s.a1 - s.a0 - 2 * m) / s.seats);
}
function seatRadius(s: Section, row: number) {
  // the seat sits towards the back of its tread (legroom in front)
  if (s.tier === "lower") return LOWER.front + LOWER.depth * (row - 1) + LOWER.depth * 0.62;
  if (s.tier === "upper") return UPPER.r0 + UPPER.depth * (row - 1) + UPPER.depth * 0.62;
  return VIP.seatR;
}
function seatY(s: Section, row: number) {
  return s.tier === "lower" ? lowerTreadY(row) : s.tier === "upper" ? upperTreadY(row) : VIP.floorY;
}

/** Every bowl seat (1,224): lower 720, upper 480, VIP 24. */
export const BOWL_SEATS: BowlSeat[] = SECTIONS.flatMap((s) =>
  Array.from({ length: s.rows * s.seats }, (_, k) => {
    const row = Math.floor(k / s.seats) + 1;
    const n = (k % s.seats) + 1;
    const a = seatAngle(s, n);
    const r = seatRadius(s, row);
    const p = polar(r, a);
    return { id: `${s.id}-${row}-${n}`, table: s.id, x: p.x, z: p.z, y: seatY(s, row), yaw: yawToCentre(p.x, p.z), a: norm(a), r, row, n };
  }),
);
const SEAT_BY_ID = new Map(BOWL_SEATS.map((s) => [s.id, s]));
export const bowlSeat = (id: string) => SEAT_BY_ID.get(id);

/* ---------------- ground height + walkable space ---------------- */

const nearestAisle = (aisles: number[], a: number) => aisles.reduce((b, x) => (Math.abs(dAng(x, a)) < Math.abs(dAng(b, a)) ? x : b), aisles[0]!);
const lateral = (r: number, a: number, centre: number) => Math.abs(dAng(a, centre)) * D2R * r;
const vipAt = (a: number) => SECTIONS.find((s) => s.tier === "vip" && dAng(a, s.a0) >= 0 && dAng(a, s.a1) < 0);
const inPlayersTunnel = (x: number, z: number, r: number) => z < 0 && Math.abs(x) < PLAYERS_TUNNEL_HW && r >= FLOOR_R - 0.3 && r <= CONCOURSE.r0 + 0.05;
const inPortal = (x: number, z: number, r: number) => z > 0 && Math.abs(x) <= PORTAL_HW && r >= CONCOURSE.r1 - 0.3 && r <= OUTER_R + 0.6;
/** the lower rows run all round except the players' tunnel gap (170°–190°) */
const inLowerSpan = (a: number) => !(a > 170 && a < 190);
/** upper rows: the four upper arcs */
const UPPER_ARCS: [number, number][] = [
  [18, 70],
  [110, 162],
  [198, 250],
  [290, 342],
];
const inUpperArc = (a: number) => UPPER_ARCS.some(([a0, a1]) => a >= a0 && a <= a1);
const inGantry = (a: number) => a >= GANTRY.a0 && a <= GANTRY.a1;

/** Feature stage on the floor (deck 0.3 m above the floor), x/z half sizes. */
export const STAGE = { hw: 8.2, hd: 3.6, z: 1.2, h: 0.3 } as const;
const onStage = (x: number, z: number) => Math.abs(x) <= STAGE.hw && Math.abs(z - STAGE.z) <= STAGE.hd;

/** row number (1-based, clamped) of a radius inside a tier */
const rowAt = (r: number, r0: number, depth: number, rows: number) => Math.min(rows, Math.max(1, Math.floor((r - r0) / depth) + 1));
/**
 * Stair aisles have two steps per row: the front half of a tread at the row height, the back half one half-step up
 * (the geometry draws exactly these steps; the controller eases the body height across them).
 */
function aisleStep(r: number, r0: number, depth: number, rows: number, treadY: (row: number) => number, rise: number) {
  const row = rowAt(r, r0, depth, rows);
  const inTread = r - (r0 + depth * (row - 1));
  return treadY(row) + (row < rows && inTread >= depth / 2 ? rise / 2 : 0);
}

/** Height of the walking surface at (x, z): treads and legroom, stepped stair aisles, the floor / stage, boxes, gantry. */
export function groundAt(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const a = angleOf(x, z);
  if (r < FLOOR_R) return FLOOR_Y + (onStage(x, z) ? STAGE.h : 0);
  if (r < LOWER_BACK) {
    if (inPlayersTunnel(x, z, r)) {
      // twelve steps down to the floor
      const k = Math.min(TUNNEL_STEPS, Math.max(0, Math.floor(((r - FLOOR_R) / (CONCOURSE.r0 - FLOOR_R)) * TUNNEL_STEPS)));
      return FLOOR_Y * (1 - k / TUNNEL_STEPS);
    }
    if (r < LOWER.front) return lowerTreadY(1);
    if (lateral(r, a, nearestAisle(LOWER_AISLES, a)) < 0.6) return aisleStep(r, LOWER.front, LOWER.depth, LOWER.rows, lowerTreadY, LOWER.depth * LOWER.slope);
    return lowerTreadY(rowAt(r, LOWER.front, LOWER.depth, LOWER.rows));
  }
  if (r < CONCOURSE.r1 || inPortal(x, z, r) || r >= OUTER_R) return 0;
  if (inGantry(a)) {
    if (r >= GANTRY.r0) return GANTRY.y;
    if (lateral(r, a, 180) < 0.7) return Math.min(GANTRY.steps, Math.floor(((r - CONCOURSE.r1) / (GANTRY.r0 - CONCOURSE.r1)) * GANTRY.steps) + 1) * (GANTRY.y / GANTRY.steps);
    return 0;
  }
  const vip = vipAt(a);
  if (vip) {
    if (r >= VIP.front) return VIP.floorY;
    if (lateral(r, a, vip.a0 + VIP.stairOff) < 0.6) return Math.min(4, Math.floor(((r - CONCOURSE.r1) / (VIP.front - CONCOURSE.r1)) * 4) + 1) * (VIP.floorY / 4);
    return 0;
  }
  if (!inUpperArc(a)) return 0;
  if (r >= UPPER_BACK) return upperTreadY(UPPER.rows); // the top walkway behind the last row
  if (lateral(r, a, nearestAisle(UPPER_AISLES, a)) < 0.6) return aisleStep(r, UPPER.r0, UPPER.depth, UPPER.rows, upperTreadY, UPPER.depth * UPPER.slope);
  return upperTreadY(rowAt(r, UPPER.r0, UPPER.depth, UPPER.rows));
}

/** legroom strip of a row (between the seat fronts and the row in front), as a radius band */
const LEGROOM = { lower: [0.04, 0.33], upper: [0.06, 0.38] } as const;
function inLegroom(r: number, r0: number, depth: number, rows: number, band: readonly [number, number]) {
  const row = rowAt(r, r0, depth, rows);
  const t = r - (r0 + depth * (row - 1));
  return r >= r0 && r <= r0 + depth * rows && t >= band[0] && t <= band[1];
}

export interface WalkOpts {
  /** participants / staff: the floor and the players' tunnel */
  floor?: boolean;
  /** a restroom whose door is open right now (−1 west, 1 east) */
  restroom?: -1 | 0 | 1;
}

/**
 * May a person stand at (x, z)? Lobby, entry portal, concourse ring, every stair aisle, along every row (the legroom
 * in front of the seats), the top walkway behind the upper tier, the VIP boxes, the media gantry; the floor and the
 * players' tunnel only for participants; a restroom only while its door is open. Rails, walls, seats block.
 */
export function walkable(x: number, z: number, opts: boolean | WalkOpts = false): boolean {
  const o: WalkOpts = typeof opts === "boolean" ? { floor: opts } : opts;
  const r = Math.hypot(x, z);
  const a = angleOf(x, z);
  if (z > 0 && r >= OUTER_R - 0.05) {
    const side = Math.sign(x) as -1 | 1;
    if (o.restroom && side === o.restroom && Math.abs(x) > LOBBY.hw - 0.4) {
      // through the open door into the restroom (privacy: the camera stays in the lobby)
      const inDoor = Math.abs(z - RESTROOM.doorZ) < RESTROOM.doorW / 2 - 0.2;
      return (inDoor && Math.abs(x) <= LOBBY.hw + 0.3) || (Math.abs(x) > LOBBY.hw + 0.2 && Math.abs(x) < LOBBY.hw + RESTROOM.depth - 0.3 && z > RESTROOM.z0 + 0.3 && z < RESTROOM.z1 - 0.3);
    }
    return Math.abs(x) <= LOBBY.hw - 0.35 || (Math.abs(x) < 1.3 && z > LOBBY.z1 - 0.5);
  }
  if (inPortal(x, z, r)) return Math.abs(x) <= PORTAL_HW - 0.3;
  if (r >= CONCOURSE.r0 + 0.25 && r <= CONCOURSE.r1 - 0.2) return true;
  if (r < FLOOR_R - 0.3) return !!o.floor && r < FLOOR_R - 0.5;
  if (r < CONCOURSE.r0 + 0.25) {
    if (inPlayersTunnel(x, z, r)) return !!o.floor && Math.abs(x) < PLAYERS_TUNNEL_HW - 0.3;
    if (!inLowerSpan(a) || r < LOWER.front + 0.04) return false;
    if (lateral(r, a, nearestAisle(LOWER_AISLES, a)) < AISLE_HW.lower) return true;
    // the concourse rail stands at the top of the bowl: only the aisles break through it
    if (r > LOWER_BACK - 0.02) return false;
    return inLegroom(r, LOWER.front, LOWER.depth, LOWER.rows, LOWER_LEGROOM);
  }
  if (r > OUTER_R - 0.4) return false;
  if (inGantry(a)) {
    if (r >= GANTRY.r0) return a > GANTRY.a0 + 1 && a < GANTRY.a1 - 1;
    return lateral(r, a, 180) < 0.45;
  }
  const vip = vipAt(a);
  if (vip) {
    if (r >= VIP.front) {
      // the box floor, except the row of seats itself
      const mid = (vip.a0 + vip.a1) / 2;
      const inRow = r > VIP.seatR - 0.45 && r < VIP.seatR + 0.4 && Math.abs(dAng(a, mid)) < VIP_SPAN / 2 + 0.6;
      return !inRow && dAng(a, vip.a0) * D2R * r > 0.45 && dAng(vip.a1, a) * D2R * r > 0.45 && r <= VIP.back - 0.3;
    }
    return lateral(r, a, vip.a0 + VIP.stairOff) < 0.4;
  }
  if (!inUpperArc(a)) return false;
  // keep clear of the side walls where an arc ends
  if (UPPER_ARCS.some(([a0, a1]) => lateral(r, a, a0) < 0.3 || lateral(r, a, a1) < 0.3)) return false;
  if (r < CONCOURSE.r1 + 0.05) return lateral(r, a, nearestAisle(UPPER_AISLES, a)) < AISLE_HW.upper; // the wall opening
  if (lateral(r, a, nearestAisle(UPPER_AISLES, a)) < AISLE_HW.upper) return true;
  if (r >= UPPER_BACK + 0.08) return true; // top walkway
  return inLegroom(r, UPPER.r0, UPPER.depth, UPPER.rows, UPPER_LEGROOM);
}
const LOWER_LEGROOM = LEGROOM.lower;
const UPPER_LEGROOM = LEGROOM.upper;

/* ---------------- routes (leg by leg, every leg a straight walkable line) ---------------- */

export interface P {
  x: number;
  z: number;
}
type Zone = { kind: "lobby" } | { kind: "concourse" } | { kind: "lower" | "upper"; a: number } | { kind: "vip"; a: number } | { kind: "floor" } | { kind: "gantry" };

function zoneOf(p: P): Zone {
  const r = Math.hypot(p.x, p.z);
  const a = angleOf(p.x, p.z);
  if (p.z > 0 && (r > CONCOURSE.r1 + 0.2 || p.z > OUTER_R - 1) && Math.abs(p.x) <= PORTAL_HW + 0.2) return { kind: "lobby" };
  if (p.z > 0 && r >= OUTER_R - 0.05) return { kind: "lobby" };
  if (r >= CONCOURSE.r0 && r <= CONCOURSE.r1) return { kind: "concourse" };
  if (r < CONCOURSE.r0) {
    if (r < FLOOR_R || (p.z < 0 && Math.abs(p.x) < PLAYERS_TUNNEL_HW)) return { kind: "floor" };
    return { kind: "lower", a: nearestAisle(LOWER_AISLES, a) };
  }
  if (inGantry(a)) return { kind: "gantry" };
  const vip = vipAt(a);
  if (vip) return { kind: "vip", a: vip.a0 + VIP.stairOff };
  return { kind: "upper", a: nearestAisle(UPPER_AISLES, a) };
}

/** from inside a zone to its concourse gateway (points in walking order, ending on the concourse mid ring) */
function toConcourse(p: P, z: Zone): P[] {
  const r = Math.hypot(p.x, p.z);
  switch (z.kind) {
    case "concourse":
      return [];
    case "lobby":
      return [...(p.z > OUTER_R + 1.2 || Math.abs(p.x) > PORTAL_HW - 0.5 ? [{ x: 0, z: Math.max(OUTER_R + 1.2, Math.min(p.z, LOBBY.z1 - 2)) }] : []), { x: 0, z: CONCOURSE.mid }];
    case "lower":
    case "upper":
      // along the row (legroom / walkway, following its curve) to the aisle, then along the aisle to the concourse
      return [...alongRow(r, angleOf(p.x, p.z), z.a), polar(CONCOURSE.mid, z.a)];
    case "vip": {
      // in the box: behind the seats → round the row end along the back; then along the front to the stair, down it
      const inBox = r >= VIP.front;
      const behind = r > VIP.seatR - 0.45;
      const front = polar(VIP_FRONT_R, z.a);
      return [...(inBox && behind ? [...alongRow(r, angleOf(p.x, p.z), z.a)] : []), ...(inBox ? [front] : []), polar(CONCOURSE.mid, z.a)];
    }
    case "gantry":
      return [polar(GANTRY.r0 + 1.4, angleOf(p.x, p.z)), polar(GANTRY.r0 + 1.4, 180), polar(CONCOURSE.mid, 180)];
    case "floor":
      return [...(r < FLOOR_R ? [{ x: 0, z: -(FLOOR_R - 1.2) }] : []), { x: 0, z: -CONCOURSE.mid }];
  }
}

/** along a row at radius r from angle a to b (shorter way), every ≤ 5° (the legroom strip is narrow) */
function alongRow(r: number, a: number, b: number): P[] {
  const d = dAng(b, a);
  if (Math.abs(d) < 0.3) return [];
  const n = Math.ceil(Math.abs(d) / 5);
  return Array.from({ length: n }, (_, i) => polar(r, a + (d * (i + 1)) / n));
}

/** along the concourse mid ring from angle a to b (shorter way), every ≤ 14° */
function alongRing(a: number, b: number): P[] {
  const d = dAng(b, a);
  const n = Math.ceil(Math.abs(d) / 14);
  return Array.from({ length: n }, (_, i) => polar(CONCOURSE.mid, a + (d * (i + 1)) / n));
}

/** Walking route from `from` to `to` (both should be walkable); the last point is `to`. */
export function routeBetween(from: P, to: P): P[] {
  const zf = zoneOf(from);
  const zt = zoneOf(to);
  const same = zf.kind === zt.kind && (!("a" in zf) || !("a" in zt) || Math.abs(dAng(zf.a, zt.a)) < 0.5);
  if (same && (zf.kind === "lower" || zf.kind === "upper")) {
    // same aisle: along my row to the aisle, along the aisle to the other row, along it (unless both on one row)
    const rf = Math.hypot(from.x, from.z);
    const rt = Math.hypot(to.x, to.z);
    const a = (zf as { a: number }).a;
    if (Math.abs(rf - rt) < 0.15) return [...alongRow(rf, angleOf(from.x, from.z), angleOf(to.x, to.z)).slice(0, -1), to];
    const back = alongRow(rt, a, angleOf(to.x, to.z));
    return [...alongRow(rf, angleOf(from.x, from.z), a), polar(rt, a), ...back.slice(0, -1), to];
  }
  if (same && zf.kind !== "concourse") return [to];
  if (zf.kind === "concourse" && zt.kind === "concourse") return [...alongRing(angleOf(from.x, from.z), angleOf(to.x, to.z)).slice(0, -1), to];
  const out = toConcourse(from, zf);
  const back = toConcourse(to, zt).reverse();
  const ringFrom = out.at(-1) ?? from;
  const ringTo = back[0] ?? to;
  const ring = alongRing(angleOf(ringFrom.x, ringFrom.z), angleOf(ringTo.x, ringTo.z));
  // the ring ends where `back` starts (its gateway on the mid ring)
  const pts = [...out, ...ring, ...back.slice(1)];
  const last = pts.at(-1);
  if (!last || Math.hypot(last.x - to.x, last.z - to.z) > 1e-6) pts.push(to);
  else pts[pts.length - 1] = to;
  return pts;
}

/** the walking line along the front of a VIP box (between the glass and the seats) */
const VIP_FRONT_R = VIP.front + 0.25;

/** Where you stand in the aisle to take `seat` (the staged sit walks along the row from here). */
export function aisleSpot(seat: BowlSeat): P {
  const s = sectionById(seat.table)!;
  if (s.tier === "vip") return polar(VIP_FRONT_R, s.a0 + VIP.stairOff);
  const aisles = s.tier === "lower" ? LOWER_AISLES : UPPER_AISLES;
  // the nearer of the section's two edge aisles, at the seat's row
  const edges = [s.a0, s.a1].filter((e) => aisles.some((x) => Math.abs(dAng(x, e)) < 0.01));
  const a = edges.reduce((b, e) => (Math.abs(dAng(seat.a, e)) < Math.abs(dAng(seat.a, b)) ? e : b), edges[0] ?? s.a0);
  return polar(legroomR(seat), nearestAisle(aisles, a));
}

/** radius of the legroom walking line of a seat's row */
export function legroomR(seat: BowlSeat): number {
  const s = sectionById(seat.table)!;
  if (s.tier === "lower") return LOWER.front + LOWER.depth * (seat.row - 1) + (LOWER_LEGROOM[0] + LOWER_LEGROOM[1]) / 2;
  if (s.tier === "upper") return UPPER.r0 + UPPER.depth * (seat.row - 1) + (UPPER_LEGROOM[0] + UPPER_LEGROOM[1]) / 2;
  return VIP_FRONT_R;
}

/** Standing in the legroom right in front of a seat (where the "Take seat" prompt is offered and the sit starts). */
export function seatFront(seat: BowlSeat): P {
  return seat.table.startsWith("V") ? polar(VIP_FRONT_R, seat.a) : polar(legroomR(seat), seat.a);
}

/** The point on a walkable surface nearest to a tap (for click-to-walk). */
export function snapWalkable(p: P, floor = false): P {
  if (walkable(p.x, p.z, floor)) return p;
  const r = Math.hypot(p.x, p.z);
  const a = angleOf(p.x, p.z);
  const tryAll = (cands: P[]) => cands.find((c) => walkable(c.x, c.z, floor));
  // a tap on a seat or a tread: the legroom of that row, right there (else the nearest aisle at that height)
  if (r < CONCOURSE.r0 && r >= LOWER.front && inLowerSpan(a)) {
    const row = rowAt(r, LOWER.front, LOWER.depth, LOWER.rows);
    const lr = LOWER.front + LOWER.depth * (row - 1) + (LOWER_LEGROOM[0] + LOWER_LEGROOM[1]) / 2;
    const hit = tryAll([polar(lr, a), polar(r, nearestAisle(LOWER_AISLES, a))]);
    if (hit) return hit;
  }
  if (r > CONCOURSE.r1 && r < OUTER_R && inUpperArc(a)) {
    const row = rowAt(r, UPPER.r0, UPPER.depth, UPPER.rows);
    const lr = r >= UPPER_BACK ? (UPPER_BACK + OUTER_R - 0.4) / 2 : UPPER.r0 + UPPER.depth * (row - 1) + (UPPER_LEGROOM[0] + UPPER_LEGROOM[1]) / 2;
    const hit = tryAll([polar(lr, a), polar(lr, a + 1), polar(lr, a - 1), polar(r, nearestAisle(UPPER_AISLES, a))]);
    if (hit) return hit;
  }
  if (r > CONCOURSE.r1 && r < OUTER_R && inGantry(a)) return polar(GANTRY.r0 + 1.4, Math.min(GANTRY.a1 - 2, Math.max(GANTRY.a0 + 2, a)));
  const vip = vipAt(a);
  if (vip && r > CONCOURSE.r1 && r < OUTER_R) {
    const hit = tryAll([polar(Math.min(VIP.back - 0.6, Math.max(VIP.seatR + 0.8, r)), a), polar(VIP.front + 0.6, vip.a0 + VIP.stairOff)]);
    if (hit) return hit;
  }
  if (p.z > OUTER_R) return { x: Math.max(-LOBBY.hw + 0.6, Math.min(LOBBY.hw - 0.6, p.x)), z: Math.min(p.z, LOBBY.z1 - 0.6) };
  return polar(CONCOURSE.mid, a);
}

/** Section letter → plain words for wayfinding ("Lower bowl A", "Upper U3", "VIP box V2"). */
export const sectionLabel = (id: string) => {
  const s = sectionById(id);
  return !s ? id : s.tier === "lower" ? `Lower bowl ${id}` : s.tier === "upper" ? `Upper tier ${id}` : `VIP box ${id}`;
};

/* ---------------- furniture (solid, axis-aligned like hall tables) ---------------- */

/** Feature tables on the stage: one Pool, one Ludo, one Igisoro (the hall table models). */
export const FEATURE_TABLES = {
  pool: { x: -5.0, z: STAGE.z, w: 2.9, d: 1.65, h: 0.8 },
  ludo: { x: 0.9, z: STAGE.z, w: 1.1, d: 1.1, h: 0.74 },
  igisoro: { x: 5.4, z: STAGE.z, w: 1.7, d: 0.84, h: 0.55 },
} as const;
/** lobby: ticket & info kiosk (west), concession counters on both side walls; floor: commentator desk */
export const KIOSK = { x: -6.8, z: 29.8, w: 3.4, d: 1.3 } as const;
export const CONCESSIONS = [-1, 1].map((s) => ({ x: s * (LOBBY.hw - 0.6), z: 28.4, w: 1.0, d: 5.2 }));
export const COMMENTATORS = { x: -6.2, z: -7.6, w: 3.2, d: 0.9 } as const;
export const ARENA_COLLIDERS = [
  ...Object.values(FEATURE_TABLES).map((t) => ({ x: t.x, z: t.z, w: t.w, d: t.d })),
  { x: KIOSK.x, z: KIOSK.z, w: KIOSK.w, d: KIOSK.d },
  ...CONCESSIONS,
  { x: COMMENTATORS.x, z: COMMENTATORS.z, w: COMMENTATORS.w, d: COMMENTATORS.d },
  // lobby event board, the four wayfinding totems on the concourse
  { x: 6.8, z: 27.9, w: 3.4, d: 0.4 },
  ...[45, 135, 225, 315].map((deg) => ({ ...polar(CONCOURSE.r1 - 0.45, deg), w: 0.62, d: 0.62 })),
];
