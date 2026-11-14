"use client";
import { Suspense } from "react";
import type { HallLayout } from "./layouts";
import { AutoDoor, DoorGlimpse } from "./shell";
import { OutdoorView } from "./OutdoorView";
import { PoolHall } from "./PoolHall";
import { LudoLounge } from "./LudoLounge";
import { IgisoroCourt } from "./IgisoroCourt";
import { AdminBlock } from "./AdminBlock";
import { TournamentArena } from "./TournamentArena";

/**
 * Hall interior = the room (per-game interior: shell, furniture, lights), the glass entrance (auto sliding
 * door, EXIT sign, a glimpse of the plaza through the glass) and the real outdoors behind the windows
 * (OutdoorView). Interiors use CC0 photographic materials and props from /public/assets/interiors, loaded only
 * for the hall you enter.
 */
export function RoomScene({ layout, lite }: { layout: HallLayout; lite: boolean }) {
  const { d } = layout.size;
  const g = layout.game;
  return (
    <group>
      <OutdoorView layout={layout} lite={lite} />
      {g === "pool" ? (
        <PoolHall layout={layout} lite={lite} />
      ) : g === "ludo" ? (
        <LudoLounge layout={layout} lite={lite} />
      ) : g === "arena" ? (
        <TournamentArena layout={layout} lite={lite} />
      ) : g === "admin" ? (
        <AdminBlock layout={layout} lite={lite} />
      ) : (
        <IgisoroCourt layout={layout} lite={lite} />
      )}
      <AutoDoor x={layout.door.x} z={d / 2} w={layout.door.w} color={layout.color} />
      <Suspense fallback={null}>
        <DoorGlimpse layout={layout} lite={lite} />
      </Suspense>
    </group>
  );
}
