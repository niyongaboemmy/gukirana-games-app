"use client";
import { kitFor, type RingId } from "@gukirana/contracts";
import { useWorld } from "@/lib/world-store";
import { hallHooks } from "@/rooms/hall-hooks";
import { useFightBridge } from "./bridge";
import { cornerPoint, FEATURE_RING, inFeatureStage, RING_BY_ID, ringAt, RINGS } from "./plan";

const FEATURE_STAGE_Y = FEATURE_RING.stage;

/**
 * The Boxing hall's extensions of the hall controller (rooms/RoomPlayer via rooms/hall-hooks, P3-FGT-01 §4.6):
 *  - the ring platforms (and the raised feature stage) are solid for everyone except the fighter who holds that ring:
 *    they climb in over the corner steps (ground rises with the steps, then the canvas height);
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
const STEP_R = 1.1;

/** walking-surface height: canvas inside a held ring, the stage under R1 / R2, rising over the corner steps */
export function boxingGround(x: number, z: number): number {
  const r = ringAt(x, z);
  if (r && iHold(r.id)) return r.canvasY;
  const onStage = inFeatureStage(x, z);
  const base = onStage ? FEATURE_STAGE_Y : 0;
  for (const q of RINGS) {
    if (Math.abs(x - q.x) > q.half + STEP_R || Math.abs(z - q.z) > q.half + STEP_R) continue;
    if (!iHold(q.id)) continue;
    for (const c of ["red", "blue"] as const) {
      const p = cornerPoint(q, c);
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < STEP_R) return Math.max(base, base + (q.canvasY - base) * (1 - d / STEP_R));
    }
  }
  return base;
}

export function boxingWalkable(x: number, z: number): boolean {
  const r = ringAt(x, z, 0.08);
  if (r) return iHold(r.id);
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
