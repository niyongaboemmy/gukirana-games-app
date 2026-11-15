"use client";
import { useEffect } from "react";
import { create } from "zustand";
import type { RingId } from "@gukirana/contracts";
import { selfPose } from "@/lib/world-store";
import { walkQueue } from "@/rooms/hall-hooks";
import { softBodies } from "@/rooms/soft-bodies";
import { nav } from "@/world/navigation";
import { boxingRoute, boxingWalkable } from "./hooks";
import { BOXING_DOOR_LINE_Z, LOBBY_PASSAGE, RING_BY_ID, ringSteps, SUBHALL_DOOR_X } from "./plan";

/**
 * "Take me to ring N" (the lobby's ring status board): in the Boxing hall it walks you along the aisles to the ring's
 * red-corner steps (where its prompt appears); from the lobby it walks you into the passage first — the hall takes
 * over at the door line — and the walk to the ring continues on arrival. Pure client navigation.
 */
export const useRingGoto = create<{ pending: RingId | null; at: number; going: RingId | null }>()(() => ({ pending: null, at: 0, going: null }));

/** walk to a ring's steps inside the Boxing hall */
export function walkToRing(id: RingId): boolean {
  const r = RING_BY_ID[id];
  if (!r) return false;
  const legs = boxingRoute({ x: selfPose.x, z: selfPose.z }, ringSteps(r, "red"));
  walkQueue.legs = legs.slice(1);
  nav.goal = null;
  nav.target = legs[0] ?? null;
  nav.progress = { best: Infinity, since: performance.now(), detours: 0 };
  useRingGoto.setState({ pending: null, going: id });
  return true;
}

/** from the lobby: into the Boxing passage, then on to the ring once the hall has taken over */
export function goToRingFromLobby(id: RingId) {
  const x = SUBHALL_DOOR_X.boxing;
  // in front of the doorway (straight on through the door, never diagonally into its frame), then deep into the passage
  walkQueue.legs = [{ x, z: BOXING_DOOR_LINE_Z - LOBBY_PASSAGE.d + 0.6 }];
  nav.goal = null;
  nav.target = { x, z: BOXING_DOOR_LINE_Z + 1.6 };
  nav.progress = { best: Infinity, since: performance.now(), detours: 0 };
  useRingGoto.setState({ pending: id, at: performance.now(), going: id });
}

/** mounted by the Fight overlay: continues a pending walk once you are in the Boxing hall; forgets it after 25 s */
export function usePendingRingWalk(inBoxing: boolean) {
  const pending = useRingGoto((s) => s.pending);
  useEffect(() => {
    if (!pending) return;
    if (!inBoxing) {
      const t = setTimeout(() => useRingGoto.setState({ pending: null, going: null }), 25_000);
      return () => clearTimeout(t);
    }
    // a beat after the crossing so the hall's controller owns the pose before the route is laid
    const t = setTimeout(() => walkToRing(pending), 350);
    return () => clearTimeout(t);
  }, [pending, inBoxing]);
}

// dev-only hook for automated walk-through tests
if ((process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_GK_QA === "1") && typeof window !== "undefined")
  (window as unknown as { __gkRingGoto: unknown }).__gkRingGoto = {
    walkToRing,
    route: (id: RingId) => {
      const r = RING_BY_ID[id];
      return r ? { steps: ringSteps(r, "red"), legs: boxingRoute({ x: selfPose.x, z: selfPose.z }, ringSteps(r, "red")) } : null;
    },
    walkable: boxingWalkable,
    bodies: () => [...softBodies.entries()],
    state: () => ({ target: nav.target, legs: walkQueue.legs, store: useRingGoto.getState() }),
  };
