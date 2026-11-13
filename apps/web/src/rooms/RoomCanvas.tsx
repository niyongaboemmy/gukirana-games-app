"use client";
import { Suspense } from "react";
import { RoomScene } from "./RoomScene";
import { RoomPlayer } from "./RoomPlayer";
import { RemotePlayers } from "@/world/Player";
import { SocialLayer } from "@/social/SocialLayer";
import { leaveHall } from "@/world/stage";
import type { HallLayout } from "./layouts";

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
      <RemotePlayers tier={tier} hallSeats={layout.seats} />
      <SocialLayer />
    </Suspense>
  );
}
