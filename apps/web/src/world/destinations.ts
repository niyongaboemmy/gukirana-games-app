import type { PortalId } from "@/lib/world-store";
import { DOOR_RING, ENTRY_Z, FOUNTAIN_COURT, PLAZA_RADIUS, PORTALS, portalTransform, ringOf, ringPoint, SERVICE_ANGLE } from "./layout";
import { CAMPUS_WALKS_ON, campusWalkRoute, DISTRICTS, PROMENADE_R, type District, type P } from "./campus";

/**
 * Go To destinations (P2-WLD-13): THE one list of places the Go To window offers, and which of them are featured.
 * Change what players are guided to here (order, featured items, the first-visit guide) — the HUD (hud/GoToModal),
 * the route guide (world/GoToGuide) and the tests read nothing else. Pure data + route geometry (no React, no three.js).
 *
 *  - halls: every hall door on the plaza ring and the outer-ring halls (the Fight Games hall); `portal` links the
 *    door so the status (open / closed by staff / opening soon) comes from the buildings API (world/door-access.ts);
 *  - places: the plaza fountain, the main gate, the help desk and café, the districts (promenade junctions).
 *
 * `stop`: where the walk ends (a hall's doorstep, outside the door); `through`: the point just past the door line a
 * walk continues to when the door opens for you (crossing it enters the hall, exactly like walking in by hand).
 */

/** Featured destinations, shown first with a one-tap "Walk there" (Fight Games: the main reason people come). */
export const FEATURED: readonly DestId[] = ["fight"];
/** The first-visit guide after sign-in points here ("Fight Games is this way"), once per user. */
export const FIRST_VISIT_DEST: DestId = "fight";
/** Pace (m/s) for the walking time shown next to every destination: the normal walking pace (Player WALK_SPEEDS). */
export const GOTO_PACE = 2.2;

export type DestId = PortalId | "plaza" | "gate" | "help" | `district:${District["id"]}`;
export interface Destination {
  id: DestId;
  group: "halls" | "places";
  /** i18n key suffix of the name (hud/goto-strings.ts GO.dest) */
  label: string;
  /** a hall's door (status: open / closed / opening soon) */
  portal?: PortalId;
  stop: P;
  through?: P;
  /** where the destination's mass is (map framing, the beacon), when not at `stop` */
  focus?: P;
}

const pt = (deg: number, r: number): P => {
  const q = ringPoint(deg, r);
  return { x: q.x, z: q.z };
};

const halls: Destination[] = [...PORTALS]
  // the featured halls first, then the plaza ring clockwise from the arena
  .sort((a, b) => Number(FEATURED.includes(b.id)) - Number(FEATURED.includes(a.id)) || ((a.angleDeg + 360) % 360) - ((b.angleDeg + 360) % 360))
  .map((p): Destination => {
    const R = ringOf(p);
    const outer = R !== DOOR_RING;
    const t = portalTransform(p);
    return {
      id: p.id,
      group: "halls",
      label: p.id,
      portal: p.id,
      // inner halls: the doorstep inside the plaza edge; outer halls: the door's entry point on its forecourt
      stop: outer ? { x: t.entryX, z: t.entryZ } : pt(p.angleDeg, PLAZA_RADIUS - 0.4),
      through: pt(p.angleDeg, R + 0.2),
      focus: pt(p.angleDeg, R + (outer ? 22 : p.kind === "arena" ? 24 : 12)),
    };
  });

const places: Destination[] = [
  { id: "plaza", group: "places", label: "plaza", stop: { x: 0, z: FOUNTAIN_COURT + 1.2 }, focus: { x: 0, z: 0 } },
  { id: "gate", group: "places", label: "gate", stop: { x: 0, z: ENTRY_Z - 4.2 }, focus: { x: 0, z: ENTRY_Z + 16.5 } },
  { id: "help", group: "places", label: "help", stop: pt(SERVICE_ANGLE, PLAZA_RADIUS - 1.6), focus: pt(SERVICE_ANGLE, DOOR_RING + 3) },
  // districts: the junction of their walk with the outer promenade (the volcano view: the promenade behind the arena)
  ...(
    [
      ["northEast", 50],
      ["east", 115],
      ["view", 0],
      ["northWest", -52],
      ["west", -115],
    ] as const
  )
    .filter(([id]) => DISTRICTS.some((d) => d.id === id))
    .map(([id, deg]): Destination => ({ id: `district:${id}`, group: "places", label: `district.${id}`, stop: pt(deg, PROMENADE_R) })),
];

export const DESTINATIONS: Destination[] = [...halls, ...places];
export const destination = (id: DestId | null | undefined) => DESTINATIONS.find((d) => d.id === id) ?? null;

/** A destination beyond the plaza needs the campus walks (on with the Fight hall / the campus walks flag). */
export const reachable = (d: Destination) => CAMPUS_WALKS_ON || Math.hypot(d.stop.x, d.stop.z) < PLAZA_RADIUS;

/**
 * The route's corners from a point to a destination's stop (over the walk network; straight across the plaza — the
 * player's walk goes round the plaza furniture, world/goto-walk.ts). Starts at `from`, ends at the stop.
 */
export function destRoute(from: P, d: Destination): P[] {
  const pts: P[] = [{ x: from.x, z: from.z }];
  if (Math.hypot(d.stop.x, d.stop.z) < PLAZA_RADIUS && Math.hypot(from.x, from.z) < PLAZA_RADIUS) pts.push(d.stop);
  else for (const w of campusWalkRoute(from, d.stop)) pts.push({ x: w.x, z: w.z });
  return pts;
}
export const pathLength = (pts: P[]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p.x - pts[i - 1]!.x, p.z - pts[i - 1]!.z) : 0), 0);
/** Metres (rounded to 5 beyond 20 m) and seconds at GOTO_PACE from a point to a destination. */
export function destDistance(from: P, d: Destination): { m: number; s: number } {
  const L = pathLength(destRoute(from, d));
  return { m: L < 20 ? Math.round(L) : Math.round(L / 5) * 5, s: Math.max(1, Math.round(L / GOTO_PACE)) };
}
/** Heading (rad, world yaw convention: 0 = +z, atan2(dx, dz)) of the route's first leg. */
export function routeHeading(pts: P[]): number | null {
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i]!.x - pts[0]!.x;
    const dz = pts[i]!.z - pts[0]!.z;
    if (Math.hypot(dx, dz) > 1.5) return Math.atan2(dx, dz);
  }
  return null;
}
