import type { Corner } from "@gukirana/contracts";
import { dimsOf, ringSteps, stepHeight, type RingSize } from "@/rooms/fight/ring-kit-core";
import type { RingPlace } from "./plan";

/**
 * Climbing into / out of a ring (P3-FGT-03, plan §5–6): the ring kit's corner steps (`ringSteps`: foot → top → in).
 * A pure function of the time since the climb started, so it is identical on every client:
 *   in:  walk from the foot of the corner steps up the three treads to the apron, duck through the ropes onto the
 *        canvas, turn to face the ring centre;
 *   out: the same, backwards (turn to the ropes, duck out, walk down the steps).
 */

export const kitSize = (r: Pick<RingPlace, "feature">): RingSize => (r.feature ? "pro" : "training");
export const kitSpec = (r: RingPlace) => ({ x: r.x, z: r.z, rotY: r.rotY, size: kitSize(r) });
/** the floor under a ring (the feature rings stand on the raised stage) */
export const ringBase = (r: RingPlace) => r.canvasY - dimsOf(kitSpec(r)).deck;

/** seconds per leg: walking up the steps, ducking through the ropes, turning to the centre */
export const CLIMB = { walk: 1.25, duck: 0.85, turn: 0.35 };
export const CLIMB_S = CLIMB.walk + CLIMB.duck + CLIMB.turn;

export interface ClimbPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** walking (base locomotion) vs standing */
  walk: boolean;
  /** 0…1: ducking under the ropes (the boxing duck pose weight) */
  duck: number;
  /** 0…1 through the ropes (the duck clip's progress), −1 outside that leg */
  duckT: number;
  done: boolean;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const smooth = (k: number) => k * k * (3 - 2 * k);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** the climber's pose `t` seconds into a climb in (or out) through `corner`'s steps of ring `r` */
export function climbPose(r: RingPlace, corner: Corner, dir: "in" | "out", t: number): ClimbPose {
  const spec = kitSpec(r);
  const s = ringSteps(spec, corner);
  const base = ringBase(r);
  const k = dir === "in" ? t : CLIMB_S - t;
  const centreYaw = Math.atan2(r.x - s.in.x, r.z - s.in.z);
  const inYaw = s.foot.yaw;
  const yawOut = wrap(inYaw + Math.PI);
  let x: number, z: number, y: number, yaw: number;
  let walk = false;
  let duck = 0;
  let duckT = -1;
  if (k <= CLIMB.walk) {
    // up the steps: the height follows the treads (with a short smooth rise between them)
    const u = Math.max(0, k) / CLIMB.walk;
    x = lerp(s.foot.x, s.top.x, u);
    z = lerp(s.foot.z, s.top.z, u);
    const h = stepHeight(spec, x, z);
    const deck = dimsOf(spec).deck;
    y = base + (h ?? (u > 0.5 ? deck : 0));
    yaw = dir === "in" ? inYaw : yawOut;
    walk = t < CLIMB_S - 0.02 || dir === "in";
  } else if (k <= CLIMB.walk + CLIMB.duck) {
    // through the ropes, bent low between the second and third rope
    const u = (k - CLIMB.walk) / CLIMB.duck;
    x = lerp(s.top.x, s.in.x, smooth(u));
    z = lerp(s.top.z, s.in.z, smooth(u));
    y = r.canvasY;
    yaw = dir === "in" ? inYaw : yawOut;
    duck = Math.sin(Math.PI * Math.min(1, u * 1.1));
    duckT = u;
  } else {
    const u = Math.min(1, (k - CLIMB.walk - CLIMB.duck) / CLIMB.turn);
    x = s.in.x;
    z = s.in.z;
    y = r.canvasY;
    const from = dir === "in" ? inYaw : yawOut;
    yaw = from + wrap(centreYaw - from) * smooth(u);
  }
  return { x, y, z, yaw, walk, duck, duckT, done: t >= CLIMB_S };
}
