import { PLAZA_RADIUS, ringPoint } from "./layout";

/**
 * Plaza activities (P2-WLD-09): everyday things to do on the plaza, placed like a real town square, plus the
 * deterministic schedules behind the plaza's living details. Pure data + functions (no three.js, no React), so the
 * placement and the schedules are unit tested (activities.test.ts).
 *
 *  - café counter: a free drink (coffee, tea, juice) — cosmetic only, no Stars, no balance change of any kind;
 *  - notice board: the real arena events (GET /arena/status, /arena/events) and which halls are open (GET /buildings);
 *  - water point: a stone drinking fountain by the entry walk;
 *  - volcano viewpoint: a small brass lectern framing Bisoke between the Pool Hall and the arena — take a photo;
 *  - pigeons on the fountain court that fly off when someone walks close and come back later;
 *  - Musanze morning mist that clears by mid-morning (Kigali time, from the clock: same for everyone).
 *
 * Feature flag: NEXT_PUBLIC_FF_PLAZA_ACTIVITIES=0 hides the new activities (props stay as set dressing).
 */
export const PLAZA_ACTIVITIES_ON = process.env.NEXT_PUBLIC_FF_PLAZA_ACTIVITIES !== "0";

/** Notice board: on the west side of the entry walk, facing the arrivals (local +z = the face). */
export const NOTICE_BOARD = { x: -7.6, z: 19.6, rotY: 0, w: 2.1, h: 1.25 } as const;
/** Drinking water point: a lava-stone pillar with a push tap, east side of the entry walk, tap facing the walk. */
export const WATER_POINT = { x: 7.6, z: 19.6, rotY: -Math.PI / 2 } as const;
/** Volcano viewpoint lectern: on the fountain-court side of the −22° seating cluster, looking out at Bisoke (az −23°). */
export const VIEWPOINT_DEG = -22;
const vp = ringPoint(VIEWPOINT_DEG, 21.2);
/** the lectern is read from the fountain side, looking out at the mountain beyond it */
export const VIEWPOINT = { x: vp.x, z: vp.z, rotY: vp.rotY } as const;

/** The café counter is used from the café front: the edge of the walkable plaza under the pavilion's canopy line. */
export const CAFE_FRONT_R = PLAZA_RADIUS - 0.75;

/** Where you stand to use each one, and the way you face (avatar yaw: forward = (sin yaw, cos yaw)). */
const towards = (fx: number, fz: number, tx: number, tz: number) => Math.atan2(tx - fx, tz - fz);
export const ACTIVITY_SPOTS = {
  board: { x: NOTICE_BOARD.x, z: NOTICE_BOARD.z + 0.95, yaw: Math.PI },
  water: { x: WATER_POINT.x - 0.62, z: WATER_POINT.z, yaw: towards(WATER_POINT.x - 0.62, WATER_POINT.z, WATER_POINT.x, WATER_POINT.z) },
  photo: (() => {
    const s = ringPoint(VIEWPOINT_DEG, 20.4);
    const far = ringPoint(-23, 1900);
    return { x: s.x, z: s.z, yaw: towards(s.x, s.z, far.x, far.z) };
  })(),
} as const;

/** Round / box footprints of the new props (registered as obstacles at runtime by the plaza). */
export const ACTIVITY_OBSTACLES = {
  board: { x: NOTICE_BOARD.x, z: NOTICE_BOARD.z, hw: NOTICE_BOARD.w / 2 + 0.08, hd: 0.16, rot: NOTICE_BOARD.rotY },
  water: { x: WATER_POINT.x, z: WATER_POINT.z, r: 0.3 },
  viewpoint: { x: VIEWPOINT.x, z: VIEWPOINT.z, r: 0.22 },
} as const;

/** The drinks the café counter gives away (cosmetic; the avatar holds a cup and sips). */
export const DRINKS = ["coffee", "tea", "juice"] as const;
export type Drink = (typeof DRINKS)[number];

/** How long each activity's action lasts once you are in place (ms; 0 = until you walk away). */
export const ACTIVITY_HOLD_MS = { coffee: 0, water: 6000, board: 0, photo: 8200 } as const;

// ------------------------------------------------------------------ morning mist (Musanze, Kigali time UTC+2)

/** Hour of day in Kigali (CAT, UTC+2, no daylight saving) for a timestamp (ms). */
export function kigaliHour(ms: number): number {
  const h = ((ms / 3_600_000 + 2) % 24 + 24) % 24;
  return h;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Mist amount 0…1 for a Kigali hour: valley mist from before dawn, thick until ~7:30, thinning and gone by 10:00;
 * a light haze gathers again after 17:30 (evening cooling). Deterministic: everyone sees the same sky.
 */
export function mistLevel(hour: number): number {
  const morning = smooth(4.5, 5.5, hour) * (1 - smooth(7.5, 10, hour));
  const evening = hour >= 12 ? 0.25 * smooth(17.5, 19.5, hour) : hour < 5.5 ? 0.25 : 0;
  return Math.min(1, Math.max(morning, evening));
}

/** Fog density multiplier for a mist amount (the clear-day density × up to 3). */
export const fogFactor = (mist: number) => 1 + mist * 2;
/** The current mist amount as a shader uniform (the valley mist banks in Landscape thicken with it). */
export const mistUniform = { value: 0 };

// ------------------------------------------------------------------ pigeons on the fountain court

export interface BirdHome {
  x: number;
  z: number;
  /** resting heading (rad) */
  yaw: number;
  /** per-bird phase (pecking rhythm, flight path) */
  phase: number;
}

/** Seeded positions (no Math.random): a loose group on the south side of the fountain court, off the walk lines. */
export function birdHomes(n = 8): BirdHome[] {
  let s = 20261114;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const out: BirdHome[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((145 + rnd() * 70) * Math.PI) / 180; // bearings 145°…215° (south of the fountain)
    const r = 6.2 + rnd() * 3.2; // on the granite court, outside the basin
    out.push({ x: r * Math.sin(a), z: -r * Math.cos(a), yaw: rnd() * Math.PI * 2, phase: rnd() * 100 });
  }
  return out;
}

export const BIRD_SCARE_R = 3.2;
/** seconds in the air before they settle again */
export const BIRD_AWAY_S = 26;
const TAKEOFF_S = 1.2;
const LAND_S = 2.5;

export type BirdPhase = "ground" | "takeoff" | "away" | "landing";
export interface BirdState {
  phase: BirdPhase;
  /** 0…1 within the phase */
  k: number;
}

/**
 * Where a bird is in its cycle, from the time since the flock was last scared (seconds; Infinity = never).
 * Each bird lifts off a moment after the next (by index), is away BIRD_AWAY_S, then glides back in.
 */
export function birdState(sinceScare: number, index: number): BirdState {
  const t = sinceScare - index * 0.12;
  if (!Number.isFinite(t) || t < 0) return { phase: "ground", k: 0 };
  if (t < TAKEOFF_S) return { phase: "takeoff", k: t / TAKEOFF_S };
  const away = t - TAKEOFF_S;
  if (away < BIRD_AWAY_S) return { phase: "away", k: away / BIRD_AWAY_S };
  const land = away - BIRD_AWAY_S;
  if (land < LAND_S) return { phase: "landing", k: land / LAND_S };
  return { phase: "ground", k: 0 };
}

/** The whole flock is back on the ground (a new scare restarts the cycle only then or while landing). */
export const flockSettled = (sinceScare: number, n: number) => birdState(sinceScare, n - 1).phase === "ground";

/** Is anyone (positions in metres) within the scare radius of any resting bird? */
export function someoneNear(homes: BirdHome[], people: { x: number; z: number }[], r = BIRD_SCARE_R): boolean {
  for (const p of people) for (const h of homes) if ((p.x - h.x) ** 2 + (p.z - h.z) ** 2 < r * r) return true;
  return false;
}
