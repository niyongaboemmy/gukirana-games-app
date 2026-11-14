import { ACT, type ArenaStatus } from "@gukirana/contracts";
import { angleOf, bowlSeat, COMMENTATORS, CONCESSIONS, CONCOURSE, GANTRY, KIOSK, LOBBY, OUTER_R, polar, RESTROOM, SECTIONS, seatFront, TOTEM_ANGLES, VIP } from "./bowl";

/**
 * The living venue (P2-ARN-04): interaction points, PA announcements, the crowd-noise level and the VIP box voice
 * scope. Pure logic (no React, no three), shared by the HUD, the scene and the tests. Everything is derived from REAL
 * state: people inside come from the server's occupancy, reactions from real emotes — nothing is inflated or faked.
 */

export type SpotKind = "kiosk" | "board" | "snack" | "drink" | "restroom" | "photo" | "desk" | "tunnel" | "gantry" | "totem";
export interface Spot {
  id: string;
  kind: SpotKind;
  x: number;
  z: number;
  /** prompt radius (m) */
  r: number;
  /** restroom side (−1 west, 1 east) */
  side?: -1 | 1;
}

/** event board in the lobby (freestanding, facing the door) */
export const EVENT_BOARD = { x: 6.8, z: 27.9 } as const;
/** photo spot: the concourse rail above section A/L, the whole bowl behind you */
export const PHOTO_SPOT = { x: 0, z: CONCOURSE.r0 + 0.55, yaw: 0 } as const;
/** digital wayfinding totems on the concourse (bearing, deg; beside the upper stairs) */
export { TOTEM_ANGLES };
export const TOTEM_R = CONCOURSE.r1 - 0.45;
export const totemPos = (deg: number) => polar(TOTEM_R, deg);

export const SPOTS: Spot[] = [
  { id: "kiosk", kind: "kiosk", x: KIOSK.x, z: KIOSK.z + KIOSK.d / 2 + 0.8, r: 1.5 },
  { id: "board", kind: "board", x: EVENT_BOARD.x, z: EVENT_BOARD.z + 1.1, r: 1.5 },
  { id: "snack", kind: "snack", x: CONCESSIONS[0]!.x + 1.25, z: CONCESSIONS[0]!.z, r: 1.6 },
  { id: "drink", kind: "drink", x: CONCESSIONS[1]!.x - 1.25, z: CONCESSIONS[1]!.z, r: 1.6 },
  { id: "restroom-w", kind: "restroom", side: -1, x: -(LOBBY.hw - 0.9), z: RESTROOM.doorZ, r: 1.0 },
  { id: "restroom-e", kind: "restroom", side: 1, x: LOBBY.hw - 0.9, z: RESTROOM.doorZ, r: 1.0 },
  { id: "photo", kind: "photo", x: PHOTO_SPOT.x, z: PHOTO_SPOT.z, r: 1.0 },
  { id: "desk", kind: "desk", x: COMMENTATORS.x, z: COMMENTATORS.z - COMMENTATORS.d / 2 - 0.6, r: 1.2 },
  { id: "tunnel", kind: "tunnel", x: 0, z: -(CONCOURSE.r0 + 0.5), r: 0.9 },
  { id: "gantry", kind: "gantry", x: 0, z: -(CONCOURSE.r1 - 0.35), r: 0.8 },
  ...TOTEM_ANGLES.map((deg) => {
    const p = polar(TOTEM_R - 0.95, deg);
    return { id: `totem-${deg}`, kind: "totem" as const, x: p.x, z: p.z, r: 1.1 };
  }),
];

/** The interaction you can use from (x, z): the nearest spot in reach (the desk only for staff). */
export function nearestSpot(x: number, z: number, ctx: { staff: boolean }): Spot | null {
  let best: Spot | null = null;
  let bd = Infinity;
  for (const s of SPOTS) {
    if (s.kind === "desk" && !ctx.staff) continue;
    const d = Math.hypot(s.x - x, s.z - z);
    if (d < s.r && d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

/* ---------------- PA announcements (from real event state changes) ---------------- */

export const PA = {
  doorsOpen: (t: string) => `Doors are open for ${t}. Please find your seat.`,
  live: (t: string) => `${t} is live now. Enjoy the match.`,
  ended: (t: string) => `${t} has ended. Thank you for coming.`,
  cancelled: (t: string) => `${t} is cancelled. We are sorry.`,
  soon: (t: string, m: number) => `${t} starts in ${m} minute${m === 1 ? "" : "s"}.`,
  closed: "The arena is closing. Please make your way to the exit.",
} as const;

/** What the PA says when the status changes from `prev` to `next` (null = nothing to announce). */
export function announcementFor(prev: ArenaStatus | null, next: ArenaStatus): string | null {
  if (!prev) return null; // first load: no chime on arrival
  if (prev.open && !next.open) return PA.closed;
  const p = prev.current;
  const n = next.current;
  if (n && (!p || p.id !== n.id || p.status !== n.status)) {
    if (n.status === "doors_open") return PA.doorsOpen(n.title);
    if (n.status === "live") return PA.live(n.title);
  }
  if (p && (!n || n.id !== p.id)) return PA.ended(p.title);
  return null;
}

/** "Starts in 4 min" style countdown (null when not before the start). */
export function countdown(startsAt: string, now: number): { ms: number; text: string } | null {
  const ms = Date.parse(startsAt) - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const text = h ? `${h} h ${String(m).padStart(2, "0")} min` : m >= 10 ? `${m} min` : `${m}:${String(sec).padStart(2, "0")}`;
  return { ms, text };
}

/* ---------------- crowd sound (real people, real reactions) ---------------- */

/** reactions that count for the crowd swell (cheer, clap, wave, thumbs up) */
export const REACTION_IDS: number[] = [ACT.cheer, ACT.clap, ACT.wave, ACT.thumbsUp];

/**
 * Crowd-noise gain (0 … 1) from the REAL number of people inside and reactions in the last few seconds. Empty
 * arena = silence (plus the hall's own air); it never plays a recorded full house.
 */
export function crowdLevel(people: number, reactionTimes: number[], now: number): { bed: number; swell: number } {
  const bed = people <= 1 ? 0 : Math.min(0.5, Math.sqrt(people - 1) * 0.045);
  const recent = reactionTimes.filter((t) => now - t < 4000).length;
  const swell = Math.min(0.6, recent * 0.08 * Math.min(1, 0.4 + people / 20));
  return { bed, swell };
}

/* ---------------- VIP box voice scope ---------------- */

/** Which VIP box (section id) a point is inside, if any. */
export function boxAt(x: number, z: number): string | null {
  const r = Math.hypot(x, z);
  if (r < VIP.front - 0.05 || r > OUTER_R) return null;
  const a = angleOf(x, z);
  return SECTIONS.find((s) => s.tier === "vip" && a >= s.a0 && a < s.a1)?.id ?? null;
}

/**
 * Voice rule inside the arena: in a VIP box you hear the people in your box (no distance falloff) and the PA
 * (commentator on air); outside the boxes it is normal proximity voice, plus the PA everywhere.
 */
export function voiceRule(me: { box: string | null }, other: { id: string; box: string | null }, onAir: string | null) {
  if (other.id === onAir) return { allow: true, room: true };
  if (me.box) return { allow: other.box === me.box, room: other.box === me.box };
  return { allow: other.box === null, room: false };
}

/** Gantry is a viewpoint, not a seat area: its stair foot on the concourse. */
export const GANTRY_TOP = polar(GANTRY.r0 + 1.4, 180);

/**
 * Arrival at a seat you walked to: within 1.1 m of its front, or the route ran out within 2.5 m (blocked by
 * someone in the row, a slide along a rail): ask for it either way. The server has the final say.
 */
export function seatArrival(id: string, at: { x: number; z: number }, walking: boolean): "ask" | "wait" | "cancel" {
  const s = bowlSeat(id);
  if (!s) return "cancel";
  const f = seatFront(s);
  const d = Math.hypot(at.x - f.x, at.z - f.z);
  if (d < 1.1) return "ask";
  if (!walking) return d < 2.5 ? "ask" : "cancel";
  return "wait";
}

