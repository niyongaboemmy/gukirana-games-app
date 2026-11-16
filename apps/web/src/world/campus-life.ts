import { ACTIVITY_SPOTS, CAFE_FRONT_R } from "./activities";
import { BUS_STOP, DISTRICT_WALKS, hash01, PUBLIC_ROAD, type P } from "./campus";
import { FOUNTAIN_RADIUS, INNER_PORTALS, PLAZA_RADIUS, ringPoint, SERVICE_ANGLE } from "./layout";

/**
 * Campus life (P2-WLD-22, docs/COMPOUND-REALISM.md): who is about on the campus besides the players — staff and
 * visitors walking between the halls, people reading the notice board or stopping at the fountain, two friends
 * talking, someone waiting at the bus stop — and the traffic on Musanze Road. Pure, seeded data (no Math.random):
 * every motion is a function of the wall clock, so every screen sees the same people in the same places.
 *
 * These are scenery, not players: never listed, never clickable, never in a hall or a match (no bots in cash rooms,
 * SRS FR-MM-03 / FR-REV-X1 are about matches; nobody here can be challenged).
 * Kill switch: NEXT_PUBLIC_FF_COMPOUND_LIFE=0 (no ambient people or traffic; the campus as before).
 */
export const COMPOUND_LIFE_ON = process.env.NEXT_PUBLIC_FF_COMPOUND_LIFE !== "0";

/** A stop on a stroll: where to stand, which way to face (yaw: forward = (sin, cos)), for how long (s). */
export interface Stop {
  x: number;
  z: number;
  yaw: number;
  pause: number;
}
export interface Stroller {
  id: string;
  kind: "stroll";
  stops: Stop[];
  /** walking pace (m/s) */
  speed: number;
  /** clock offset (s): people don't move in step */
  phase: number;
  /** present only by day (false = also after dark; a few people stay on the lit plaza in the evening) */
  dayOnly: boolean;
}
export interface Stander {
  id: string;
  kind: "stand";
  x: number;
  z: number;
  yaw: number;
  /** talking with the person they face (gestures, jaw) */
  talks: boolean;
  dayOnly: boolean;
}
export type Npc = Stroller | Stander;

const towards = (a: P, b: P) => Math.atan2(b.x - a.x, b.z - a.z);

/** Spots on the plaza people walk between (clear of furniture; the route planner goes round anything in between). */
function plazaStops(): Stop[] {
  const out: Stop[] = [];
  // in front of each open hall door, looking at it (reading the sign, waiting for a friend)
  for (const p of INNER_PORTALS) {
    const s = ringPoint(p.angleDeg + 4, PLAZA_RADIUS - 4.2);
    const d = ringPoint(p.angleDeg, PLAZA_RADIUS + 1.5);
    out.push({ x: s.x, z: s.z, yaw: towards(s, d), pause: 4 });
  }
  // at the fountain's edge, looking at the water
  for (const deg of [30, 150, -110, -40]) {
    const s = ringPoint(deg, FOUNTAIN_RADIUS + 1.35);
    out.push({ x: s.x, z: s.z, yaw: towards(s, { x: 0, z: 0 }), pause: 7 });
  }
  // beside the notice board, the water point and the viewpoint (never ON the player's spot)
  const b = ACTIVITY_SPOTS.board;
  out.push({ x: b.x + 0.9, z: b.z + 0.1, yaw: b.yaw, pause: 9 });
  const w = ACTIVITY_SPOTS.water;
  out.push({ x: w.x - 0.4, z: w.z + 1.1, yaw: w.yaw, pause: 5 });
  const v = ACTIVITY_SPOTS.photo;
  out.push({ x: v.x + 1.0, z: v.z + 0.6, yaw: v.yaw, pause: 8 });
  // the café front (the service pavilion)
  const c = ringPoint(SERVICE_ANGLE - 3, CAFE_FRONT_R - 2.2);
  out.push({ x: c.x, z: c.z, yaw: towards(c, ringPoint(SERVICE_ANGLE, PLAZA_RADIUS + 2)), pause: 10 });
  return out;
}

/**
 * The people (deterministic). Strollers loop through 4–5 plaza stops; walkers go out along the district walks to
 * the outer promenade and back; a pair of friends talk by the fountain court; one person waits at the bus stop.
 */
export function campusNpcs(): Npc[] {
  const stops = plazaStops();
  const out: Npc[] = [];
  const N = stops.length;
  for (let i = 0; i < 7; i++) {
    const n = 4 + Math.floor(hash01(i, 71) * 2);
    const seq: Stop[] = [];
    let k = Math.floor(hash01(i, 72) * N);
    for (let j = 0; j < n; j++) {
      seq.push({ ...stops[k % N]!, pause: stops[k % N]!.pause * (0.6 + hash01(i * 7 + j, 73) * 0.9) });
      k += 2 + Math.floor(hash01(i * 11 + j, 74) * (N - 3));
    }
    out.push({
      id: `stroll-${i}`,
      kind: "stroll",
      stops: seq,
      speed: 1.15 + hash01(i, 75) * 0.35,
      phase: hash01(i, 76) * 400,
      dayOnly: i >= 3,
    });
  }
  // out along a district walk to the promenade and back (a pause at each end)
  DISTRICT_WALKS.forEach((w, i) => {
    const a = w.pts[0]!;
    const z = w.pts[w.pts.length - 1]!;
    const there = w.pts.map((p) => ({ x: p.x, z: p.z, yaw: 0, pause: 0 }));
    there[there.length - 1] = { x: z.x, z: z.z, yaw: towards(w.pts[w.pts.length - 2]!, z), pause: 6 };
    const back = [...there].reverse().slice(1);
    back[back.length - 1] = { x: a.x, z: a.z, yaw: towards(w.pts[1]!, a), pause: 3 };
    out.push({
      id: `walk-${w.id}`,
      kind: "stroll",
      stops: [...there, ...back],
      speed: 1.3 + hash01(i, 81) * 0.25,
      phase: hash01(i, 82) * 300,
      dayOnly: true,
    });
  });
  // two friends talking on the fountain court (off the walking lines), facing each other
  const f = ringPoint(-150, 14.2);
  const g = ringPoint(-153.5, 14.6);
  out.push({ id: "chat-a", kind: "stand", x: f.x, z: f.z, yaw: towards(f, g), talks: true, dayOnly: false });
  out.push({ id: "chat-b", kind: "stand", x: g.x, z: g.z, yaw: towards(g, f), talks: true, dayOnly: false });
  // waiting at the bus stop across Musanze Road (looking up the road)
  out.push({
    id: "bus-wait",
    kind: "stand",
    x: BUS_STOP.x + 3.1,
    z: BUS_STOP.z - 0.8,
    yaw: -Math.PI / 2 + 0.3,
    talks: false,
    dayOnly: true,
  });
  return out;
}

/* ---------------------------------------------------------------- stroll schedule ---------------------------------------------------------------- */

export interface Leg {
  /** polyline of this walk (≥ 2 points) */
  pts: P[];
  cum: number[];
  len: number;
  t0: number;
  walk: number;
  stop: Stop;
}
export interface Schedule {
  legs: Leg[];
  period: number;
}

/** Walk legs between consecutive stops (`route(a, b)` gives the waypoints after `a`), each followed by its pause. */
export function schedule(n: Stroller, route: (a: P, b: P) => P[]): Schedule {
  const legs: Leg[] = [];
  let t = 0;
  for (let i = 0; i < n.stops.length; i++) {
    const a = n.stops[i]!;
    const b = n.stops[(i + 1) % n.stops.length]!;
    const pts: P[] = [{ x: a.x, z: a.z }, ...route(a, b)];
    if (pts.length < 2 || Math.hypot(pts[pts.length - 1]!.x - b.x, pts[pts.length - 1]!.z - b.z) > 0.05)
      pts.push({ x: b.x, z: b.z });
    const cum = [0];
    for (let k = 1; k < pts.length; k++)
      cum.push(cum[k - 1]! + Math.hypot(pts[k]!.x - pts[k - 1]!.x, pts[k]!.z - pts[k - 1]!.z));
    const len = cum[cum.length - 1]!;
    const walk = len / n.speed;
    legs.push({ pts, cum, len, t0: t, walk, stop: b });
    t += walk + b.pause;
  }
  return { legs, period: Math.max(1, t) };
}

export interface Pose {
  x: number;
  z: number;
  /** yaw the person wants to face */
  yaw: number;
  moving: boolean;
}

/** Where a stroller is at time `t` (s): on a walk leg (facing along it) or paused at its stop. Pure. */
export function poseAt(s: Schedule, t: number, out: Pose): Pose {
  const u = ((t % s.period) + s.period) % s.period;
  let leg = s.legs[s.legs.length - 1]!;
  for (const l of s.legs)
    if (u < l.t0 + l.walk + l.stop.pause) {
      leg = l;
      break;
    }
  const dt = u - leg.t0;
  if (dt >= leg.walk) {
    out.x = leg.stop.x;
    out.z = leg.stop.z;
    out.yaw = leg.stop.pause > 0.5 ? leg.stop.yaw : out.yaw;
    out.moving = false;
    return out;
  }
  const d = (dt / leg.walk) * leg.len;
  let k = 1;
  while (k < leg.cum.length - 1 && leg.cum[k]! < d) k++;
  const a = leg.pts[k - 1]!;
  const b = leg.pts[k]!;
  const seg = leg.cum[k]! - leg.cum[k - 1]! || 1;
  const f = Math.min(1, Math.max(0, (d - leg.cum[k - 1]!) / seg));
  out.x = a.x + (b.x - a.x) * f;
  out.z = a.z + (b.z - a.z) * f;
  out.yaw = Math.atan2(b.x - a.x, b.z - a.z);
  out.moving = true;
  return out;
}

/* ---------------------------------------------------------------- road traffic ---------------------------------------------------------------- */

export type VehicleKind = "moto" | "car" | "bus";
export interface Vehicle {
  kind: VehicleKind;
  /** +1 eastbound (south lane: right-hand traffic), −1 westbound (north lane) */
  dir: 1 | -1;
  speed: number;
  phase: number;
  colour: number;
}
/** The straight stretch of Musanze Road the traffic is drawn on (west end → the bend east of the campus). */
export const TRAFFIC_X = { x0: -420, x1: 140 } as const;
export const laneZ = (dir: 1 | -1) => PUBLIC_ROAD.mid + dir * 1.75;

export function vehicles(): Vehicle[] {
  const out: Vehicle[] = [];
  for (let i = 0; i < 14; i++) {
    const h = hash01(i, 91);
    const kind: VehicleKind = h < 0.55 ? "moto" : h < 0.88 ? "car" : "bus";
    const speed =
      kind === "moto"
        ? 9 + hash01(i, 92) * 4
        : kind === "car"
          ? 10 + hash01(i, 92) * 4
          : 8 + hash01(i, 92) * 2;
    out.push({
      kind,
      dir: i % 2 ? 1 : -1,
      speed,
      phase: hash01(i, 93) * (TRAFFIC_X.x1 - TRAFFIC_X.x0),
      colour: Math.floor(hash01(i, 94) * 10),
    });
  }
  return out;
}

/** x of a vehicle at time t (s) along its lane (wraps over the drawn stretch). */
export function vehicleX(v: Vehicle, t: number): number {
  const L = TRAFFIC_X.x1 - TRAFFIC_X.x0;
  const u = (((t * v.speed + v.phase) % L) + L) % L;
  return v.dir > 0 ? TRAFFIC_X.x0 + u : TRAFFIC_X.x1 - u;
}
