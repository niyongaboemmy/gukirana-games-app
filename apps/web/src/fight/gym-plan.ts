import { BOXING_SIZE, FEATURE_STAGE, LOBBY_SIZE, RINGS, ringSteps } from "./plan";

/**
 * Gym life (P3-FGT-04): where the training wall, the venue props, the staff and the lobby reception stand. Pure data
 * (no three.js), shared by the scenes (training-zone, gym-life, lobby-venue), the hall colliders and the tests.
 *
 * The training wall runs along the east half of the Boxing hall's south wall (x 12 … 45, z ≥ 13.85): rubber floor, a
 * mirror, heavy bags, a speed bag, a double-end bag, skipping space, a pads corner, a weight bench + rack, a water
 * station and a towel cart. It keeps clear of the front cross aisle's walking line (z 13.25) and of the foot of every
 * ring's steps; no ring is touched. Staff never stand in a ring.
 */

const S = BOXING_SIZE.d / 2; // the south wall (z = +15)
/** the rubber floor of the training wall */
export const TRAINING_FLOOR = { x0: 12, x1: 45, z0: 13.85, z1: S };
/** the line people stand on to use a prop (just in front of the rubber) */
const STAND_Z = 13.65;
/** the strip people training at the wall take (the stand line less a body radius → the wall), for the aisle check */
export const TRAINING_USE = { x0: TRAINING_FLOOR.x0, x1: TRAINING_FLOOR.x1, z0: STAND_Z - 0.25, z1: S };

export type GymPropKind = "heavyBag" | "speedBag" | "water" | "mirror";
export interface GymProp {
  id: string;
  kind: GymPropKind;
  /** the prop itself (hall coordinates) */
  x: number;
  z: number;
  /** where you stand to use it, facing it */
  stand: { x: number; z: number; yaw: number };
  /** an NPC uses it all the time (not offered to players) */
  npc?: boolean;
}

const prop = (id: string, kind: GymPropKind, x: number, z: number, npc = false): GymProp => ({
  id,
  kind,
  x,
  z,
  stand: { x, z: STAND_Z, yaw: Math.atan2(0, z - STAND_Z) },
  npc,
});
/** heavy bags hang 0.65 m off the wall; the trainee's bag is in use by the staff loop */
export const GYM_PROPS: GymProp[] = [
  prop("bag-trainee", "heavyBag", 19.0, S - 0.65, true),
  prop("bag-1", "heavyBag", 25.0, S - 0.65),
  prop("bag-2", "heavyBag", 26.8, S - 0.65),
  prop("speed-bag", "speedBag", 32.2, S - 0.42),
  prop("water", "water", 38.4, S - 0.4),
  // shadow boxing in front of the mirror (P3-FGT-08), beside the staff trainer's spot
  prop("mirror", "mirror", 15.0, S - 0.05),
];
export const HEAVY_BAGS = GYM_PROPS.filter((p) => p.kind === "heavyBag");
/** decorative training kit along the wall */
export const GYM_DECOR = {
  towelCart: { x: 12.7, z: S - 0.45 },
  doubleEnd: { x: 13.9, z: S - 0.7 },
  mirror: { x0: 14.6, x1: 17.6, y0: 0.25, y1: 2.35 },
  skipping: { x: 34.6, z: S - 0.95 },
  pads: { x: 21.6, z: S - 0.85 },
  bench: { x: 41.6, z: S - 0.7, w: 1.25, d: 0.34 },
  rack: { x: 43.7, z: S - 0.35, w: 1.4, d: 0.5 },
  clock: { x: 16.1, y: 3.2 },
};
/** venue props at the feature stage: the announcer's stand and the timekeeper's table, in front of the stage rail */
export const VENUE = {
  announcer: { x: -4.6, z: FEATURE_STAGE.z0 + 1.6 },
  timekeeper: { x: 4.6, z: FEATURE_STAGE.z0 + 1.6, w: 1.5, d: 0.6 },
  notices: [
    { x: -13.4, kind: "rules" as const },
    { x: -15.6, kind: "etiquette" as const },
  ],
  /** the changing room door on the north wall, past the east locker bank */
  changingDoor: { x: 44.0, w: 1.3 },
};

type R = { x: number; z: number; w: number; d: number };
/** solid training-wall and venue props (hall colliders) */
export const GYM_COLLIDERS: R[] = [
  ...HEAVY_BAGS.map((b) => ({ x: b.x, z: b.z, w: 0.5, d: 0.5 })),
  { x: GYM_PROPS[3]!.x, z: S - 0.3, w: 0.7, d: 0.6 },
  { x: GYM_PROPS[4]!.x, z: S - 0.3, w: 0.6, d: 0.6 },
  { x: GYM_DECOR.towelCart.x, z: GYM_DECOR.towelCart.z, w: 0.8, d: 0.5 },
  { x: GYM_DECOR.doubleEnd.x, z: GYM_DECOR.doubleEnd.z, w: 0.4, d: 0.4 },
  { ...GYM_DECOR.bench },
  { ...GYM_DECOR.rack },
  { x: VENUE.announcer.x, z: VENUE.announcer.z, w: 0.8, d: 0.6 },
  { ...VENUE.timekeeper },
];

/* ---------------- staff (ambient NPCs) ---------------- */

export type StaffRole =
  "coach" | "trainee" | "skipper" | "shadow" | "cleaner" | "referee" | "timekeeper" | "reception";
export interface StaffSpot {
  id: string;
  role: StaffRole;
  /** standing spot and facing (or the first point of a walking loop) */
  x: number;
  z: number;
  yaw: number;
  /** a walking loop (closed), metres per second */
  path?: { x: number; z: number }[];
  speed?: number;
  /** which room */
  room: "boxing" | "fight";
}
const face = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z);
const P = GYM_DECOR;
/** the referee's rounds: up the west main aisle, along the back of the stage, down the east main aisle, the front */
const AISLE = 8.6;
export const STAFF: StaffSpot[] = [
  { id: "shadow", role: "shadow", room: "boxing", x: 16.1, z: S - 1.05, yaw: 0 },
  { id: "trainee", role: "trainee", room: "boxing", x: 19.0, z: S - 1.25, yaw: 0 },
  {
    id: "coach",
    role: "coach",
    room: "boxing",
    x: P.pads.x + 0.55,
    z: P.pads.z,
    yaw: face(P.pads.x + 0.55, 0, P.pads.x - 0.5, 0),
  },
  {
    id: "padder",
    role: "trainee",
    room: "boxing",
    x: P.pads.x - 0.5,
    z: P.pads.z,
    yaw: face(P.pads.x - 0.5, 0, P.pads.x + 0.55, 0),
  },
  { id: "skipper", role: "skipper", room: "boxing", x: P.skipping.x, z: P.skipping.z, yaw: Math.PI },
  {
    id: "timekeeper",
    role: "timekeeper",
    room: "boxing",
    x: VENUE.timekeeper.x,
    z: VENUE.timekeeper.z + 0.55,
    yaw: Math.PI,
  },
  {
    id: "referee",
    role: "referee",
    room: "boxing",
    x: -AISLE,
    z: 11.5,
    yaw: Math.PI,
    speed: 0.9,
    path: [
      { x: -AISLE, z: 11.5 },
      { x: -AISLE, z: -12.4 },
      { x: AISLE, z: -12.4 },
      { x: AISLE, z: 11.5 },
    ],
  },
  {
    id: "cleaner",
    role: "cleaner",
    room: "boxing",
    x: -40,
    z: 13.25,
    yaw: Math.PI / 2,
    speed: 0.55,
    path: [
      { x: -40, z: 13.25 },
      { x: -12, z: 13.25 },
    ],
  },
  { id: "reception", role: "reception", room: "fight", x: -12.55, z: 4.9, yaw: Math.PI / 2 },
];

/** a point `d` metres along a closed path (deterministic: d = speed × clock), and the heading there */
export function alongPath(
  path: { x: number; z: number }[],
  d: number,
): { x: number; z: number; yaw: number } {
  const legs = path.map((a, i) => {
    const b = path[(i + 1) % path.length]!;
    return { a, b, len: Math.hypot(b.x - a.x, b.z - a.z) };
  });
  const total = legs.reduce((s, l) => s + l.len, 0) || 1;
  let k = ((d % total) + total) % total;
  for (const l of legs) {
    if (k <= l.len) {
      const u = l.len ? k / l.len : 0;
      return {
        x: l.a.x + (l.b.x - l.a.x) * u,
        z: l.a.z + (l.b.z - l.a.z) * u,
        yaw: Math.atan2(l.b.x - l.a.x, l.b.z - l.a.z),
      };
    }
    k -= l.len;
  }
  const a = path[0]!;
  return { x: a.x, z: a.z, yaw: 0 };
}

/* ---------------- the lobby as a venue entrance ---------------- */

/** reception desk (west of the door), trophy cabinet (east wall, front), plants either side of the plaza door */
export const LOBBY_VENUE = {
  desk: { x: -11.4, z: 4.9, w: 0.7, d: 2.4 },
  cabinet: { x: LOBBY_SIZE.w / 2 - 0.45, z: 5.3, w: 0.6, d: 1.8, h: 2.1 },
  /** "Fights now" (live ring data) on the west wall behind the reception desk */
  fightsBoard: { x: -LOBBY_SIZE.w / 2 + 0.1, y: 3.95, z: 4.9, w: 2.5, h: 1.2 }, // above the slat band and its light line
  plants: [
    { x: -3.4, z: LOBBY_SIZE.d / 2 - 0.6 },
    { x: 3.4, z: LOBBY_SIZE.d / 2 - 0.6 },
    { x: -14.2, z: -2.3 },
    { x: 14.2, z: -2.3 },
  ],
};
export const LOBBY_VENUE_COLLIDERS: R[] = [
  { ...LOBBY_VENUE.desk },
  { x: LOBBY_VENUE.desk.x - 1.1, z: LOBBY_VENUE.desk.z, w: 0.9, d: 2.6 }, // behind the desk: staff only
  { x: LOBBY_VENUE.cabinet.x, z: LOBBY_VENUE.cabinet.z, w: LOBBY_VENUE.cabinet.w, d: LOBBY_VENUE.cabinet.d },
  ...LOBBY_VENUE.plants.map((p) => ({ x: p.x, z: p.z, w: 0.6, d: 0.6 })),
];

/** every ring's step foot (for the clearance test) */
export const STEP_FEET = RINGS.flatMap((r) => [ringSteps(r, "red"), ringSteps(r, "blue")]);
