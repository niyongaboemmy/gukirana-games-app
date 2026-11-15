"use client";
import { useEffect } from "react";
import { PLACE_HOLD } from "@gukirana/contracts";
import { SEAT_BACK } from "@/world/human/seat-profiles";
import type { ReturnPoint } from "@/lib/return-point";
import { useWorld } from "@/lib/world-store";
import { useMatch } from "@/lib/match-store";
import { clearPlace, loadPlace, placeToRestore, savePlace, usePlace, type PlaceRef } from "@/lib/place-hold";
import { sitAt } from "@/lib/realtime";
import { RING_BY_ID, ringSteps } from "@/fight/plan";
import type { RingId } from "@gukirana/contracts";
import { useRoom } from "./room-store";
import type { HallLayout } from "./layouts";

/**
 * P2-NET-06 in the hall: where a reload starts you when the server still holds your place (rooms/RoomPlayer feeds it
 * to rooms/arrival as a "restore", exactly like coming back from a game), and the table-side record keeping.
 */

const holdMs = (r: PlaceRef) =>
  1000 * (r.kind === "seat" ? PLACE_HOLD.seatSeconds : r.state === "practice" ? PLACE_HOLD.ringPracticeSeconds : PLACE_HOLD.ringWaitingSeconds);

/** a reload with a held place: on the chair (re-taken once connected) or at the ring's red-corner steps */
export function placeReturn(layout: HallLayout): ReturnPoint | null {
  const r = placeToRestore(layout.game, holdMs);
  if (!r) return null;
  const path = `/room/${layout.game}`;
  if (r.kind === "seat") {
    const s = layout.seats.find((x) => x.id === r.place);
    if (!s) return null;
    return { path, seat: s.id, x: s.x - Math.sin(s.yaw) * SEAT_BACK, z: s.z - Math.cos(s.yaw) * SEAT_BACK, yaw: s.yaw, at: Date.now() };
  }
  const ring = RING_BY_ID[r.place as RingId];
  if (!ring || layout.game !== "boxing") return null;
  const f = ringSteps(ring, "red");
  return { path, seat: null, x: f.x, z: f.z, yaw: Math.atan2(ring.x - f.x, ring.z - f.z), at: Date.now() };
}

/**
 * Table halls: remember my chair while I sit (and whether I wait for an opponent), forget it when I stand up, walk
 * out or leave for a game. A reload never runs the "stood up" path (the page just goes), so the record survives it.
 */
export function useTablePlaceSync(layout: HallLayout): void {
  useEffect(() => {
    const hall = layout.game;
    let was: string | null = useRoom.getState().seated;
    const sync = () => {
      const seated = useRoom.getState().seated;
      const w = useWorld.getState();
      const q = useMatch.getState().quick;
      const roomId = w.roomId;
      if (seated && w.you && w.seats[seated] === w.you && roomId) {
        const waiting = q.status === "waiting" && q.game !== undefined;
        savePlace({ hall, roomId, kind: "seat", place: seated, state: waiting ? "waiting" : "seated", ...(waiting ? { game: q.game, stake: q.stake } : {}) });
      } else if (was && !seated && loadPlace()?.hall === hall) clearPlace();
      was = seated;
    };
    // the server gave my chair back (a reload whose new connection came in before the old one closed): sit on it
    const back = () => {
      const j = usePlace.getState().joined;
      if (j?.status !== "restored" || j.kind !== "seat" || j.hall !== hall || useRoom.getState().seated === j.place) return;
      sitAt(j.place);
      useRoom.getState().set({ seated: j.place, nearSeat: null });
    };
    const offs = [usePlace.subscribe((s, p) => s.joined !== p.joined && back()), useRoom.subscribe(sync), useWorld.subscribe((s, p) => (s.seats !== p.seats || s.roomId !== p.roomId) && sync()), useMatch.subscribe((s, p) => s.quick !== p.quick && sync())];
    return () => offs.forEach((o) => o());
  }, [layout.game]);
}
