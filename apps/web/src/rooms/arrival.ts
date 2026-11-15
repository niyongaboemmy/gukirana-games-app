/**
 * Where you appear in a hall, which way you face, which way the scripted first steps go and where the follow camera
 * starts (P3-FGT-12). Pure: rooms/RoomPlayer reads it once on mount.
 *
 * A hall can be reached four ways, and each must look like what it is:
 *   "front"   through the hall's own door (layout.door, the south wall): from the plaza, or from the Fight lobby into
 *             the Boxing hall. You walk in (−z, yaw π), the camera behind you (+z side, cameraState.yaw 0).
 *   "subhall" back out of a sub-hall into the Fight lobby through its back-wall doorway (Boxing → lobby). You come
 *             OUT of the passage: you keep walking into the lobby (+z, yaw 0), away from that door, the camera behind
 *             you in the passage (−z side, cameraState.yaw π) — never turned round to walk back in.
 *   "restore" back from a game, or a reload: the exact spot and heading you had, no walk at all, camera behind.
 *   "door"    a cold deep link: just inside the hall's own door, walking in (as "front", without a handed-over pose).
 *
 * Camera yaw convention (RoomPlayer / world/Player): the camera sits at pos + (sin yaw, cos yaw) · distance, so "behind
 * a person facing f" is yaw = f + π.
 */

export type ArrivalVia = "front" | "subhall";
export type ArrivalKind = ArrivalVia | "restore" | "door";

export interface ArrivalIn {
  /** the hall's door (south wall, z = d/2) and size */
  door: { x: number };
  size: { d: number };
  /** pose handed over by the place you came from (world/stage Handoff), already mapped into this hall */
  hand?: { x: number; z: number; yaw: number; via?: ArrivalVia } | null;
  /** an exact pose to restore (back from a game, or a reload) */
  restore?: { x: number; z: number; yaw: number } | null;
}

export interface Arrival {
  kind: ArrivalKind;
  x: number;
  z: number;
  /** facing on the first frame */
  facing: number;
  /** heading the scripted first steps ease round to and walk along (null: no scripted walk) */
  heading: number | null;
  /** scripted walk length (s); 0 = none */
  intro: number;
  /** follow-camera orbit yaw at the end of the arrival (behind the person) */
  camYaw: number;
  /** cap on the follow-camera distance during the arrival (the passage behind the doorway is short), or null */
  camMax: number | null;
}

export const INTRO_S = 1.9;
/** coming out of the passage: a shorter walk (you are already moving and the lobby is right in front of you) */
export const OUT_INTRO_S = 1.3;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** behind a person facing `f` */
export const behind = (f: number) => wrap(f + Math.PI);

export function arrival(a: ArrivalIn): Arrival {
  if (a.restore) {
    const { x, z, yaw } = a.restore;
    return { kind: "restore", x, z, facing: yaw, heading: null, intro: 0, camYaw: behind(yaw), camMax: null };
  }
  const h = a.hand;
  if (h && h.via === "subhall") {
    // out through the sub-hall doorway: on into the lobby (+z), whatever small angle you crossed the door line at; the
    // camera behind you stays inside the room's bounds (the passage behind the doorway ends at −d/2)
    const heading = 0;
    return { kind: "subhall", x: h.x, z: h.z, facing: h.yaw, heading, intro: OUT_INTRO_S, camYaw: behind(heading), camMax: Math.max(1.6, h.z + a.size.d / 2 - 0.3) };
  }
  if (h) return { kind: "front", x: h.x, z: h.z, facing: h.yaw, heading: Math.PI, intro: INTRO_S, camYaw: 0, camMax: null };
  return { kind: "door", x: a.door.x, z: a.size.d / 2 - 1.0, facing: Math.PI, heading: Math.PI, intro: INTRO_S, camYaw: 0, camMax: null };
}
