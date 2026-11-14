"use client";
import { Suspense } from "react";
import { RoomScene } from "./RoomScene";
import { RoomPlayer } from "./RoomPlayer";
import { RemotePlayers } from "@/world/Player";
import { SocialLayer } from "@/social/SocialLayer";
import { leaveHall } from "@/world/stage";
import type { HallLayout } from "./layouts";
import { hallHooks } from "./hall-hooks";

/**
 * A hall inside the persistent stage (world/SceneCanvas). The interior (`HallInterior`) is mounted while the hall
 * is on screen OR warm (you walked up to its door), so it is compiled and uploaded before you step through; the
 * people (`HallActors`) mount when the hall is on screen.
 */
export function HallInterior({ layout, lite }: { layout: HallLayout; lite: boolean }) {
  return <RoomScene layout={layout} lite={lite} />;
}

export function HallActors({ layout, tier }: { layout: HallLayout; tier: "lite" | "standard" }) {
  return (
    <Suspense fallback={null}>
      {/* walking out through the door continues as the plaza step-out (world/stage.ts leaveHall) */}
      <RoomPlayer layout={layout} onExit={leaveHall} tier={tier} />
      {/* seated people snap to their seat and fit it (seat profile per hall); halls on several levels (arena bowl):
          people stand on the rake, and its 1,224 bowl seats are not game tables (no spectator "watch" life) */}
      <RemotePlayers tier={tier} hallSeats={layout.seats} seatArea={layout.game} lifeTables={!hallHooks[layout.game]?.ground} ground={hallHooks[layout.game]?.ground} />
      <SocialLayer />
    </Suspense>
  );
}
