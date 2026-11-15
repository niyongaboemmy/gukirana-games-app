"use client";
import { useEffect } from "react";
import type { RingId } from "@gukirana/contracts";
import { useWorld } from "@/lib/world-store";
import { clearPlace, loadPlace, savePlace, usePlace } from "@/lib/place-hold";
import { useFightBridge } from "./bridge";
import { fightActions } from "./actions";
import { useBoxingNet } from "./game/net/client";

/**
 * P2-NET-06 in the Boxing hall: remember the ring I wait or practise in (stake, AI level) so a reload puts me back
 * at its steps, forget it when I step out / cancel or my fight starts (the fight's own resume, P2-NET-05, takes
 * over), and when the server gives me my practice ring back, start a fresh practice fight at the same level.
 */
export function useRingPlaceSync(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    let had = !!useBoxingNet.getState().ring;
    const sync = () => {
      const mineRing = useBoxingNet.getState().ring;
      const b = useFightBridge.getState();
      const w = useWorld.getState();
      const r = mineRing ? b.rings[mineRing.id] : undefined;
      if (mineRing && r && w.roomId && r.red?.sid === w.you && (r.status === "waiting" || r.status === "practice")) {
        const prev = loadPlace();
        const level = b.mine?.mode === "practice" ? b.mine.level : prev?.place === r.id ? prev.level : undefined;
        savePlace({ hall: "boxing", roomId: w.roomId, kind: "ring", place: r.id, state: r.status, ...(r.status === "waiting" ? { stake: r.stake ?? 0 } : {}), ...(level ? { level } : {}) });
      } else if (r && (r.status === "starting" || r.status === "fighting")) {
        if (loadPlace()?.hall === "boxing") clearPlace();
      } else if (had && !mineRing && loadPlace()?.hall === "boxing") clearPlace();
      had = !!mineRing;
    };
    // back on my practice ring: the old practice fight ran in the closed page, so start a new one at the same level
    const restart = () => {
      const j = usePlace.getState().joined;
      if (j?.status !== "restored" || j.kind !== "ring") return;
      // (the hall's `boxing-assigned` may have come before the live client listened)
      if (!useBoxingNet.getState().ring) useBoxingNet.setState({ ring: { id: j.place as RingId, corner: "red" } });
      if (j.state !== "practice" || useFightBridge.getState().mine) return;
      const level = loadPlace()?.level ?? 2;
      usePlace.setState({ joined: null });
      setTimeout(() => fightActions.practice(j.place as RingId, level), 400);
    };
    const offs = [useBoxingNet.subscribe(sync), useFightBridge.subscribe((s, p) => (s.rings !== p.rings || s.mine !== p.mine) && sync()), usePlace.subscribe((s, p) => s.joined !== p.joined && restart())];
    restart();
    return () => offs.forEach((o) => o());
  }, [on]);
}
