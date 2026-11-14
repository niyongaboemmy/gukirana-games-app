"use client";
import { useMemo } from "react";
import type { RingId, RingState, RingStatus } from "@gukirana/contracts";
import { useFightBridge } from "./bridge";
import { RINGS, type RingPlace } from "./plan";

/** a ring's registry entry (a ring the hall has not reported yet is free) */
export function ringState(id: RingId, rings = useFightBridge.getState().rings): RingState {
  return rings[id] ?? { id, status: "free", watchers: 0, since: 0 };
}

/** status of every ring in RINGS order, re-rendering only when a status changes */
export function useRingStatuses(): RingStatus[] {
  const key = useFightBridge((s) => RINGS.map((r) => s.rings[r.id]?.status ?? "free").join(","));
  return useMemo(() => key.split(",") as RingStatus[], [key]);
}

export function useRingKitRings() {
  const st = useRingStatuses();
  return useMemo(() => RINGS.map((r: RingPlace, i) => ({ id: r.id, x: r.x, z: r.z, rotY: r.rotY, feature: r.feature, status: st[i]! })), [st]);
}

/** live counts for signs and boards */
export function ringCounts(rings = useFightBridge.getState().rings) {
  let fights = 0;
  let free = 0;
  for (const r of RINGS) {
    const s = rings[r.id]?.status ?? "free";
    if (s === "fighting" || s === "starting") fights++;
    if (s === "free") free++;
  }
  return { fights, free };
}
export function useRingCounts() {
  const k = useFightBridge((s) => {
    const c = ringCounts(s.rings);
    return `${c.fights}:${c.free}`;
  });
  return useMemo(() => {
    const [fights, free] = k.split(":").map(Number);
    return { fights: fights!, free: free! };
  }, [k]);
}
