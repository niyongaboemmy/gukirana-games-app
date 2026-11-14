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
export const OUTER_R = 25.3;
/** VIP boxes: raised floor between the box front and the back wall */
export const VIP = { floorY: 0.9, front: 21.3, back: 24.9, seatR: 22.1, stairOff: 2.6 } as const;
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

/** Feature stage on the floor (deck 0.3 m above the floor), x/z half sizes. */
export const STAGE = { hw: 8.2, hd: 3.6, z: 1.2, h: 0.3 } as const;
const onStage = (x: number, z: number) => Math.abs(x) <= STAGE.hw && Math.abs(z - STAGE.z) <= STAGE.hd;

/** Height of the walking surface at (x, z): treads in the bowl, ramps in the stair aisles, the floor / stage. */
export function groundAt(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const a = angleOf(x, z);
  if (r < FLOOR_R) return FLOOR_Y + (onStage(x, z) ? STAGE.h : 0);
  if (r < LOWER_BACK) {
    if (inPlayersTunnel(x, z, r)) return FLOOR_Y + ((r - FLOOR_R) / (CONCOURSE.r0 - FLOOR_R)) * -FLOOR_Y;
    if (lateral(r, a, nearestAisle(LOWER_AISLES, a)) < 0.6) return Math.max(LOWER.front - LOWER_BACK, r - LOWER_BACK) * LOWER.slope;
    const row = Math.min(LOWER.rows, Math.max(1, Math.floor((r - LOWER.front) / LOWER.depth) + 1));
    return lowerTreadY(row);
  }
  if (r < CONCOURSE.r1 || inPortal(x, z, r) || r >= OUTER_R) return 0;
  const vip = vipAt(a);
  if (vip) {
    if (r >= VIP.front) return VIP.floorY;
    if (lateral(r, a, vip.a0 + VIP.stairOff) < 0.6) return ((r - CONCOURSE.r1) / (VIP.front - CONCOURSE.r1)) * VIP.floorY;
    return 0;
  }
  if (r >= UPPER_BACK) return upperTreadY(UPPER.rows);
  if (lateral(r, a, nearestAisle(UPPER_AISLES, a)) < 0.6) return (r - UPPER.r0) * UPPER.slope;
  const row = Math.min(UPPER.rows, Math.max(1, Math.floor((r - UPPER.r0) / UPPER.depth) + 1));
  return upperTreadY(row);
}

/**
 * May a person stand at (x, z)? Lobby, entry portal, concourse ring, the stair aisles, the VIP boxes; the floor and
 * the players' tunnel only with `floor` (participants). Seat rows are not walkable: you reach a seat along its row
 * through the staged sit (rooms/RoomPlayer) once the server has given it to you.
 */
export function walkable(x: number, z: number, floor = false): boolean {
  const r = Math.hypot(x, z);
  const a = angleOf(x, z);
  if (z > 0 && r >= OUTER_R - 0.05) return Math.abs(x) <= LOBBY.hw || (Math.abs(x) < 1.3 && z > LOBBY.z1 - 0.5);
  if (inPortal(x, z, r)) return true;
  if (r >= CONCOURSE.r0 + 0.05 && r <= CONCOURSE.r1 - 0.05) return true;
  if (r < FLOOR_R - 0.3) return floor && r < FLOOR_R - 0.5;
  if (r < CONCOURSE.r0 + 0.05) {
    if (inPlayersTunnel(x, z, r)) return floor && Math.abs(x) < PLAYERS_TUNNEL_HW - 0.3;
    return r >= LOWER.front + 0.2 && lateral(r, a, nearestAisle(LOWER_AISLES, a)) < AISLE_HW.lower;
  }
  if (r > OUTER_R - 0.45) return false;
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
  if (r > UPPER_BACK - 0.2) return false;
  return lateral(r, a, nearestAisle(UPPER_AISLES, a)) < AISLE_HW.upper;
}

/* ---------------- routes (leg by leg, every leg a straight walkable line) ---------------- */

export interface P {
  x: number;
  z: number;
}
type Zone = { kind: "lobby" } | { kind: "concourse" } | { kind: "lower" | "upper"; a: number } | { kind: "vip"; a: number } | { kind: "floor" };

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
      return [polar(r, z.a), polar(CONCOURSE.mid, z.a)];
    case "vip": {
      const inBox = r >= VIP.front;
      return [...(inBox ? [polar(VIP.front + 0.6, z.a)] : []), polar(CONCOURSE.mid, z.a)];
    }
    case "floor":
      return [...(r < FLOOR_R ? [{ x: 0, z: -(FLOOR_R - 1.2) }] : []), { x: 0, z: -CONCOURSE.mid }];
  }
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

/** Where you stand in the aisle to take `seat` (the staged sit walks along the row from here). */
export function aisleSpot(seat: BowlSeat): P {
  const s = sectionById(seat.table)!;
  if (s.tier === "vip") return polar(VIP.front + 0.6, s.a0 + VIP.stairOff);
  const aisles = s.tier === "lower" ? LOWER_AISLES : UPPER_AISLES;
  // the nearer of the section's two edge aisles, at the seat's row
  const edges = [s.a0, s.a1].filter((e) => aisles.some((x) => Math.abs(dAng(x, e)) < 0.01));
  const a = edges.reduce((b, e) => (Math.abs(dAng(seat.a, e)) < Math.abs(dAng(seat.a, b)) ? e : b), edges[0] ?? s.a0);
  const tread = s.tier === "lower" ? LOWER.front + LOWER.depth * (seat.row - 0.5) : UPPER.r0 + UPPER.depth * (seat.row - 0.5);
  return polar(tread, nearestAisle(aisles, a));
}

/** The point on a walkable surface nearest to a tap (for click-to-walk). */
export function snapWalkable(p: P, floor = false): P {
  if (walkable(p.x, p.z, floor)) return p;
  const r = Math.hypot(p.x, p.z);
  const a = angleOf(p.x, p.z);
  if (r < CONCOURSE.r0 && r >= LOWER.front + 0.2 && !(r < FLOOR_R)) return polar(r, nearestAisle(LOWER_AISLES, a));
  if (r > CONCOURSE.r1 && r < UPPER_BACK - 0.2 && !vipAt(a)) return polar(r, nearestAisle(UPPER_AISLES, a));
  if (p.z > OUTER_R) return { x: Math.max(-LOBBY.hw + 0.5, Math.min(LOBBY.hw - 0.5, p.x)), z: Math.min(p.z, LOBBY.z1 - 0.6) };
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
export const CONCESSIONS = [-1, 1].map((s) => ({ x: s * (LOBBY.hw - 0.6), z: 29.6, w: 1.0, d: 5.6 }));
export const COMMENTATORS = { x: -6.2, z: -7.6, w: 3.2, d: 0.9 } as const;
export const ARENA_COLLIDERS = [
  ...Object.values(FEATURE_TABLES).map((t) => ({ x: t.x, z: t.z, w: t.w, d: t.d })),
  { x: KIOSK.x, z: KIOSK.z, w: KIOSK.w, d: KIOSK.d },
  ...CONCESSIONS,
  { x: COMMENTATORS.x, z: COMMENTATORS.z, w: COMMENTATORS.w, d: COMMENTATORS.d },
];
