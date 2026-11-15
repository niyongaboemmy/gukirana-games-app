import { ringSteps as kitSteps } from "@/rooms/fight/ring-kit-core";
import { FEATURE_RINGS, FIGHT_SUBHALLS, RING_IDS, type FightSubHallId, type RingId } from "@gukirana/contracts";

/**
 * Fight Games hall floor plans (P3-FGT-01, docs/FIGHT-GAMES-PLAN.md §4). Pure data (no three.js), shared by the hall
 * layouts (rooms/layouts.ts), the building footprint (world/footprints.ts), the scenes, the hall hooks and the tests.
 *
 * Hall coordinates like every hall: x ∈ [−w/2, w/2], z ∈ [−d/2, d/2], the entrance door on the south wall (+z).
 * Both rooms share the building's door axis (x = 0 is the plaza door), so a door between them keeps its x.
 */

/* ---------------------------------------------------------------- lobby (hall:fight) ---------------------------------------------------------------- */

/**
 * The lobby: a 30 × 10 m foyer (z from +7 at the plaza door to the back wall at −3) with the four sub-hall doors in
 * its back wall. The layout is 4 m deeper than the foyer: behind the open Boxing door a short door passage (like the
 * plaza vestibules) lets the camera follow you through the door line before the Boxing hall takes over. The rest of
 * that strip is solid (walls).
 */
export const LOBBY_SIZE = { w: 30, d: 14, h: 5 };
export const LOBBY_BACK_Z = -3;
export const LOBBY_PASSAGE = { d: 4, w: 2.6 };
/** sub-hall door centres along the back wall, in FIGHT_SUBHALLS order (left → right seen from the entrance) */
export const SUBHALL_DOOR_X: Record<FightSubHallId, number> = { boxing: -8.3, kickboxing: -2.8, wrestling: 2.8, karate: 8.3 };
export const SUBHALL_DOOR_W = 2.4;
export const subhallDoors = () => FIGHT_SUBHALLS.map((s) => ({ ...s, x: SUBHALL_DOOR_X[s.id] }));
/** benches (x, z, w, d) and the live status board on the east wall */
export const LOBBY_BENCHES = [
  { x: -10.8, z: 2.6, w: 2.6, d: 0.62 },
  { x: 10.8, z: 2.6, w: 2.6, d: 0.62 },
];
export const LOBBY_BOARD = { x: LOBBY_SIZE.w / 2 - 0.08, z: 1.6, w: 5.2, h: 2.6, y: 2.4 };

type R = { x: number; z: number; w: number; d: number };
/** full-height walls of the lobby: the back wall (Boxing doorway open), the door passage, the solid strip behind */
export const LOBBY_WALLS: R[] = (() => {
  const { w, d } = LOBBY_SIZE;
  const bx = SUBHALL_DOOR_X.boxing;
  const hw = LOBBY_PASSAGE.w / 2;
  const back = LOBBY_BACK_Z - 0.2;
  const zBack = -d / 2;
  const out: R[] = [];
  // back wall either side of the Boxing doorway
  out.push({ x: (-w / 2 + (bx - hw)) / 2, z: back, w: bx - hw + w / 2, d: 0.4 });
  out.push({ x: (bx + hw + w / 2) / 2, z: back, w: w / 2 - (bx + hw), d: 0.4 });
  // the strip behind the back wall is solid except the passage
  const sz = (LOBBY_BACK_Z - 0.4 + zBack) / 2;
  const sd = LOBBY_BACK_Z - 0.4 - zBack;
  out.push({ x: (-w / 2 + (bx - hw - 0.2)) / 2, z: sz, w: bx - hw - 0.2 + w / 2, d: sd });
  out.push({ x: (bx + hw + 0.2 + w / 2) / 2, z: sz, w: w / 2 - (bx + hw + 0.2), d: sd });
  return out;
})();
/** the Boxing door line (lobby z) and where the passage ends */
export const BOXING_DOOR_LINE_Z = LOBBY_BACK_Z;

/* ---------------------------------------------------------------- Boxing hall (hall:boxing) ---------------------------------------------------------------- */

/**
 * The Boxing hall: 93 × 30 m, 11 m high (plan §4.3, ring pitch 6.2 m across so the hall fits the site: §4.1 allows
 * it before dropping rings). Two blocks of 6 columns × 4 rows of standard rings either side of the feature zone
 * (R1 front, R2 back on a raised 1.2 m stage under the four-sided screen); main aisles either side of it; a 2.6 m
 * cross aisle along the front. The door from the lobby opens into the west main aisle.
 */
export const BOXING_SIZE = { w: 93, d: 30, h: 11 };
export const BOXING_DOOR = { x: SUBHALL_DOOR_X.boxing, w: 2.6 };
/** standard ring: platform incl. apron (square), canvas height, rope zone half-size */
export const RING = { platform: 4.9, canvasY: 0.8, inside: 4.3 };
/** feature rings: the assets ring kit's mid-size pro ring (rooms/fight/ring-kit-core RING: 6.9 m platform, 0.8 m deck,
 *  9.8 m spectator-rail square) on the raised 1.2 m stage */
export const FEATURE_RING = { platform: 6.9, canvasY: 1.2 + 0.8, inside: 5.9, stage: 1.2, rail: 4.9 };
export const RING_PITCH = { x: 6.2, z: 6.4 };
/**
 * Standard rings stand turned a quarter (P3-FGT-04): their corner steps (red on the south side, blue on the north side)
 * open into the 1.5 m row aisles and the front cross aisle, never towards the side walls (at rotY 0 the outer columns'
 * steps ended 3 cm from the west / east wall) nor into the narrower 1.3 m column aisles, which stay clear for walking.
 * The centres are unchanged (apps/realtime boxing-rings.ts mirrors them).
 */
export const STANDARD_ROT_Y = Math.PI / 2;
/** wall margin, main aisle width (m) */
const MARGIN = 1.0;
const MAIN_AISLE = 2.0;
/** row centres (A front … D back) */
export const ROW_Z = [9.5, 3.1, -3.3, -9.7];
const BLOCK_X0 = -BOXING_SIZE.w / 2 + MARGIN + RING.platform / 2; // west-most column centre
export const BLOCK_COLS_X = {
  west: Array.from({ length: 6 }, (_, c) => BLOCK_X0 + c * RING_PITCH.x),
  east: Array.from({ length: 6 }, (_, c) => -BLOCK_X0 - (5 - c) * RING_PITCH.x),
};
/** the feature zone between the main aisles (|x| < FEATURE_ZONE_HW) */
export const FEATURE_ZONE_HW = BLOCK_COLS_X.east[0]! - RING.platform / 2 - MAIN_AISLE;
export const FEATURE_Z: Record<(typeof FEATURE_RINGS)[number], number> = { R1: 4.6, R2: -5.4 };
/** the raised feature stage under R1 and R2 (x half-width, z range) */
export const FEATURE_STAGE = { hw: FEATURE_RING.rail + 0.3, z0: FEATURE_Z.R1 + FEATURE_RING.rail + 0.3, z1: FEATURE_Z.R2 - FEATURE_RING.rail - 0.3 };
/** the four-sided screen over the feature zone */
export const BIG_SCREEN = { x: 0, z: (FEATURE_Z.R1 + FEATURE_Z.R2) / 2, y: 8.2, w: 5.2, h: 2.9 };

export interface RingPlace {
  id: RingId;
  x: number;
  z: number;
  /** rotation about Y; at 0 the red corner is local (−x, −z), blue (+x, +z) (the ring kit's convention) */
  rotY: number;
  feature: boolean;
  /** half the platform size and the canvas height */
  half: number;
  canvasY: number;
  /** row letter (A front … D back) for standard rings; "F" for the feature rings */
  row: "A" | "B" | "C" | "D" | "F";
}

/**
 * Every ring of the hall: R1 / R2 in the feature zone, then R3–R50 row by row from the west side (row A = R3–R14:
 * the west block's six columns, then the east block's), exactly `RING_IDS`.
 */
export const RINGS: RingPlace[] = (() => {
  const out: RingPlace[] = [];
  for (const id of FEATURE_RINGS)
    out.push({ id, x: 0, z: FEATURE_Z[id], rotY: 0, feature: true, half: FEATURE_RING.platform / 2, canvasY: FEATURE_RING.canvasY, row: "F" });
  const rows = ["A", "B", "C", "D"] as const;
  let n = 3;
  rows.forEach((row, r) => {
    for (const x of [...BLOCK_COLS_X.west, ...BLOCK_COLS_X.east])
      out.push({ id: `R${n++}` as RingId, x, z: ROW_Z[r]!, rotY: STANDARD_ROT_Y, feature: false, half: RING.platform / 2, canvasY: RING.canvasY, row });
  });
  if (out.length !== RING_IDS.length) throw new Error("ring plan does not match RING_IDS");
  return out;
})();
export const RING_BY_ID: Partial<Record<RingId, RingPlace>> = Object.fromEntries(RINGS.map((r) => [r.id, r]));

/** corner points of a ring in hall coordinates (red: local −x,−z; blue: local +x,+z), at the platform corner */
export function cornerPoint(r: RingPlace, corner: "red" | "blue", out = 0) {
  const s = corner === "red" ? -1 : 1;
  const k = r.half + out;
  const lx = s * k;
  const lz = s * k;
  const c = Math.cos(r.rotY);
  const sn = Math.sin(r.rotY);
  return { x: r.x + lx * c + lz * sn, z: r.z - lx * sn + lz * c };
}
/** where you stand to use a ring's prompt / climb in: at the foot of the ring kit's corner steps (P3-FGT-03) */
export const ringSteps = (r: RingPlace, corner: "red" | "blue" = "red") => {
  const f = kitSteps({ x: r.x, z: r.z, rotY: r.rotY, size: r.feature ? "pro" : "training" }, corner).foot;
  return { x: f.x, z: f.z };
};

/** the foot of both corner steps of every ring (RINGS order), for the prompt target */
const RING_FEET = RINGS.map((r) => [ringSteps(r, "red"), ringSteps(r, "blue")] as const);
/** standing at a ring's steps beats being nearer another ring's platform by up to this much (m) */
const STEP_BIAS = 0.6;
/**
 * How far you are from using a ring (P3-FGT-04): the distance to the foot of its corner steps, or to its platform edge
 * plus STEP_BIAS — whichever is smaller. At the foot of a ring's steps that ring wins even though the platform across
 * the aisle is nearer (the aisles are 1.3–1.5 m: by platform distance alone the neighbour took the prompt).
 */
export function ringPromptDist(i: number, x: number, z: number): number {
  const r = RINGS[i]!;
  if (r.feature) {
    // the raised stage is climbed only by the feature fighters: distance to this ring's half of the stage (R1 the
    // front half, R2 the back half), so its prompt (Watch / Practice) shows at the stage edge
    const mid = (FEATURE_STAGE.z0 + FEATURE_STAGE.z1) / 2;
    const [z0, z1] = r.z > mid ? [mid, FEATURE_STAGE.z0] : [FEATURE_STAGE.z1, mid];
    return Math.hypot(Math.max(0, Math.abs(x) - FEATURE_STAGE.hw), Math.max(0, z0 - z, z - z1));
  }
  const edge = Math.hypot(Math.max(0, Math.abs(x - r.x) - r.half), Math.max(0, Math.abs(z - r.z) - r.half));
  const [a, b] = RING_FEET[i]!;
  return Math.min(edge + STEP_BIAS, Math.hypot(x - a.x, z - a.z), Math.hypot(x - b.x, z - b.z));
}

/** the ring whose platform (incl. the feature stage around R1 / R2) contains the point, if any */
export function ringAt(x: number, z: number, pad = 0): RingPlace | null {
  for (const r of RINGS) if (Math.abs(x - r.x) < r.half + pad && Math.abs(z - r.z) < r.half + pad) return r;
  return null;
}
export const inFeatureStage = (x: number, z: number, pad = 0) => Math.abs(x) < FEATURE_STAGE.hw + pad && z < FEATURE_STAGE.z0 + pad && z > FEATURE_STAGE.z1 - pad;

/** nearest ring to a point (centre distance), within `max` m of its platform edge */
export function nearestRing(x: number, z: number, max = 6): { ring: RingPlace; d: number } | null {
  let best: { ring: RingPlace; d: number } | null = null;
  for (const r of RINGS) {
    const dx = Math.max(0, Math.abs(x - r.x) - r.half);
    const dz = Math.max(0, Math.abs(z - r.z) - r.half);
    const d = Math.hypot(dx, dz);
    if (d <= max && (!best || d < best.d)) best = { ring: r, d };
  }
  return best;
}

/** back-wall lockers (colliders), north–south aisle centres for the Leave route */
/**
 * Spectator benches (P3-FGT-03) along the long walls: the south wall (clear of the lobby door) and the middle of the
 * north wall between the locker banks. Seat 0.45 m high, 0.5 m deep, against the wall.
 */
export const BOXING_BENCHES: R[] = (() => {
  const out: R[] = [];
  const zs = BOXING_SIZE.d / 2 - 0.55;
  const zn = -BOXING_SIZE.d / 2 + 0.55;
  for (let x = -BOXING_SIZE.w / 2 + 3; x <= BOXING_SIZE.w / 2 - 3; x += 4.2) if (Math.abs(x - BOXING_DOOR.x) > 3.4 && x < 10.5) out.push({ x, z: zs, w: 3, d: 0.5 });
  for (let x = -16.8; x <= 16.8; x += 4.2) out.push({ x, z: zn, w: 3, d: 0.5 });
  return out;
})();
export const BOXING_COLLIDERS: R[] = [
  { x: -30, z: -BOXING_SIZE.d / 2 + 0.35, w: 22, d: 0.6 },
  { x: 30, z: -BOXING_SIZE.d / 2 + 0.35, w: 22, d: 0.6 },
  ...BOXING_BENCHES,
];
export const BOXING_AISLES: number[] = [
  -BOXING_SIZE.w / 2 + MARGIN / 2 + 0.05,
  ...BLOCK_COLS_X.west.slice(0, 5).map((x) => x + RING_PITCH.x / 2),
  -(FEATURE_ZONE_HW + MAIN_AISLE / 2),
  FEATURE_ZONE_HW + MAIN_AISLE / 2,
  ...BLOCK_COLS_X.east.slice(0, 5).map((x) => x + RING_PITCH.x / 2),
  BOXING_SIZE.w / 2 - MARGIN / 2 - 0.05,
];

/* ---------------------------------------------------------------- the building (local door frame) ---------------------------------------------------------------- */

/**
 * The building in its plaza door frame (door centre at the origin, +z towards the plaza). Since P2-WLD-14 (Fight
 * Games on the plaza, docs/CAMPUS-MASTER-PLAN.md §8) the door is on the plaza's own door ring at 88°: the lobby is
 * the entrance pavilion on the ring, and the Boxing hall's body runs straight back from it, away from the plaza
 * (a 30.8 m wide, 94 m long slab, its back corners chamfered). The exterior hall is the interior turned a quarter
 * (hall x → depth behind the pavilion, hall z → across): the 94 m hall would not fit across the inner ring between
 * the Ludo Lounge and the service pavilion. Inside nothing changes (the scenes and the rings are hall-local; nobody
 * sees the inside and the outside at once). `lz(z)` maps a room's z to the door frame's local z.
 */
export const FIGHT_DOOR_INSET = -0.8;
export const FIGHT_WALL = 0.4;
/** lobby z → door-frame z (the lobby's south wall is the door line) */
export const lobbyLz = (z: number) => z - LOBBY_SIZE.d / 2 + FIGHT_DOOR_INSET;
/** the hall's front (plaza side) wall is the lobby's back wall (one wall thickness further in) */
export const HALL_FRONT_LZ = lobbyLz(LOBBY_BACK_Z) - FIGHT_WALL;
/** a Boxing hall point (x along its 93 m, z across its 30 m) → door-frame local point of the exterior volume */
export const hallLocal = (x: number, z: number) => ({ lx: -z, lz: HALL_FRONT_LZ - (x + BOXING_SIZE.w / 2) });
/** lobby ↔ hall through the Boxing door: same x, z shifted by the room offsets */
export const LOBBY_TO_HALL_DZ = BOXING_SIZE.d / 2 - LOBBY_BACK_Z;
export const FIGHT_BUILDING = (() => {
  const hw = BOXING_SIZE.d / 2 + FIGHT_WALL; // the slab's half-width: the hall's 30 m across (= the lobby's 30 m)
  const front = HALL_FRONT_LZ + FIGHT_WALL; // outside face of the hall's front wall (over the lobby roof)
  const back = HALL_FRONT_LZ - BOXING_SIZE.w - FIGHT_WALL; // outside face of the back wall, 94 m further out
  const lobbyHw = LOBBY_SIZE.w / 2 + FIGHT_WALL;
  return { hw, front, back, lobbyHw, lobbyFront: 0.4, chamfer: 3.6, H: BOXING_SIZE.h + 1.2, lobbyH: 6.4 };
})();
