"use client";
import { kitFor, type RingId } from "@gukirana/contracts";
import { useWorld } from "@/lib/world-store";
import { hallHooks, type P } from "@/rooms/hall-hooks";
import { useFightBridge } from "./bridge";
import { stepHeight } from "@/rooms/fight/ring-kit-core";
import { kitSpec, ringBase } from "./climb";
import { BOXING_AISLES, BOXING_SIZE, FEATURE_RING, FEATURE_STAGE, inFeatureStage, RING_BY_ID, ringAt, RINGS } from "./plan";

const FEATURE_STAGE_Y = FEATURE_RING.stage;

/**
 * The Boxing hall's extensions of the hall controller (rooms/RoomPlayer via rooms/hall-hooks, P3-FGT-01 §4.6):
 *  - the ring platforms (and the raised feature stage) are solid for everyone except the fighter who holds that ring:
 *    they climb in over the kit's corner steps (the ground follows its three treads, then the canvas height);
 *  - walking is frozen while your fight is on (your pose comes from the fight, not the joystick).
 */

/** do I hold this ring (the bridge's fight, or the registry says I am its red / blue fighter)? */
export function iHold(id: RingId): boolean {
  const b = useFightBridge.getState();
  if (b.mine?.ring === id) return true;
  const you = useWorld.getState().you;
  const r = b.rings[id];
  return !!(you && r && kitFor(you, [r]));
}
/** the ring kit's barrier rail round a training ring stands this far off the platform (keep people outside it) */
const RAIL_PAD = 0.26;

/** walking-surface height: canvas inside a held ring, the stage under R1 / R2, the treads of a held ring's steps */
export function boxingGround(x: number, z: number): number {
  const r = ringAt(x, z);
  if (r && iHold(r.id)) return r.canvasY;
  const base = inFeatureStage(x, z) ? FEATURE_STAGE_Y : 0;
  for (const q of RINGS) {
    if (Math.abs(x - q.x) > q.half + 1.2 || Math.abs(z - q.z) > q.half + 1.2) continue;
    const h = stepHeight(kitSpec(q), x, z);
    if (h != null && iHold(q.id)) return ringBase(q) + h;
  }
  return base;
}

/** on a set of corner steps of a ring I hold (the way in) */
const onMySteps = (x: number, z: number) => RINGS.some((q) => Math.abs(x - q.x) < q.half + 1.2 && Math.abs(z - q.z) < q.half + 1.2 && stepHeight(kitSpec(q), x, z) != null && iHold(q.id));

export function boxingWalkable(x: number, z: number): boolean {
  if (onMySteps(x, z)) return true;
  const r = ringAt(x, z, 0.08);
  if (r) return iHold(r.id);
  const railed = ringAt(x, z, RAIL_PAD);
  if (railed && !railed.feature) return iHold(railed.id);
  if (inFeatureStage(x, z, 0.1)) return iHold("R1") || iHold("R2");
  return true;
}

/** the front cross aisle's walking line (between row A and the south-wall benches) */
const CROSS_Z = BOXING_SIZE.d / 2 - 1.75;
/** the straight line a → b is open floor for a walker (sampled every 0.3 m, the end points' own rings allowed) */
function clear(a: P, b: P): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.3));
  for (let k = 1; k < n; k++) if (!boxingWalkable(a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n)) return false;
  return true;
}
const nearestAisle = (x: number) => BOXING_AISLES.reduce((b, a) => (Math.abs(a - x) < Math.abs(b - x) ? a : b), BOXING_AISLES[0]!);
/**
 * Walking routes through the hall (P3-FGT-04: tap-to-walk, "Find a free ring", Leave): straight when the line is open,
 * else along the ring-free north–south aisles and the front cross aisle (Manhattan, never through a platform, a rail or
 * the feature stage). The last point is the destination.
 */
export function boxingRoute(from: P, to: P): P[] {
  if (clear(from, to)) return [to];
  const a = nearestAisle(from.x);
  const b = nearestAisle(to.x);
  const out: P[] = [];
  if (Math.abs(from.x - a) > 0.2) out.push({ x: a, z: from.z });
  if (Math.abs(a - b) > 0.2) out.push({ x: a, z: CROSS_Z }, { x: b, z: CROSS_Z });
  if (Math.abs(to.x - b) > 0.2) out.push({ x: b, z: to.z });
  out.push(to);
  return out;
}

/** a follow camera over a ring rises to this height (m): above the ropes and the fighters' heads */
const CAM_OVER_RING_Y = 4.0;
/**
 * The follow camera behind you in a 1.3–1.5 m aisle often lands over the next ring, right among its ropes and fighters
 * (P3-FGT-04). Over a ring (its rail + 0.3 m, or the feature stage) it rises smoothly towards CAM_OVER_RING_Y — a
 * continuous lift by how deep it is inside, so crossing a ring's edge never bumps the view.
 */
export function boxingCamLift(x: number, z: number): number {
  let lift = 0;
  for (const r of RINGS) {
    const h = r.feature ? 0 : r.half + 0.5;
    if (!h) continue;
    const depth = Math.min(h - Math.abs(x - r.x), h - Math.abs(z - r.z));
    if (depth > 0) lift = Math.max(lift, Math.min(1, depth / 1.2));
  }
  const s = FEATURE_STAGE;
  const fd = Math.min(s.hw + 0.9 - Math.abs(x), s.z0 + 0.9 - z, z - (s.z1 - 0.9));
  if (fd > 0) lift = Math.max(lift, Math.min(1, fd / 1.2));
  return lift * lift * (3 - 2 * lift);
}

hallHooks.boxing = {
  walkable: boxingWalkable,
  ground: boxingGround,
  route: boxingRoute,
  camClamp: (c) => {
    const k = boxingCamLift(c.x, c.z);
    if (k > 0 && c.y < CAM_OVER_RING_Y) c.y += (CAM_OVER_RING_Y - c.y) * k;
  },
  chairR: 0.3,
  frozen: () => {
    const m = useFightBridge.getState().mine;
    return !!m && !!m.snap && m.snap.phase !== "over";
  },
};

export const ringPlace = (id: RingId) => RING_BY_ID[id]!;
