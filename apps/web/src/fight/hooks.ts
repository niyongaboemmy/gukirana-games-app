"use client";
import { kitFor, type RingId } from "@gukirana/contracts";
import { useWorld } from "@/lib/world-store";
import { hallHooks } from "@/rooms/hall-hooks";
import { useFightBridge } from "./bridge";
import { stepHeight } from "@/rooms/fight/ring-kit-core";
import { kitSpec, ringBase } from "./climb";
import { FEATURE_RING, inFeatureStage, RING_BY_ID, ringAt, RINGS } from "./plan";

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

hallHooks.boxing = {
  walkable: boxingWalkable,
  ground: boxingGround,
  chairR: 0.3,
  frozen: () => {
    const m = useFightBridge.getState().mine;
    return !!m && !!m.snap && m.snap.phase !== "over";
  },
};

export const ringPlace = (id: RingId) => RING_BY_ID[id]!;
