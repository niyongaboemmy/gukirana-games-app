"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { WorldHud } from "@/hud/WorldHud";
import { WorldControls } from "@/hud/WorldControls";
import { RotateGuard } from "@/hud/RotateGuard";
import { MatchmakingPanel } from "@/match/MatchmakingPanel";
import { RoomOverlay } from "@/rooms/RoomOverlay";
import { HALLS, isHallGame } from "@/rooms/layouts";
import { useRoom } from "@/rooms/room-store";
import { levelForXp, useProfile } from "@/lib/profile-store";
import { connectPlaza, leavePlaza } from "@/lib/realtime";
import { useSession } from "@/lib/session";
import { useWorld } from "@/lib/world-store";
import { useDoorway } from "@/world/doorway";

const RoomCanvas = dynamic(() => import("@/rooms/RoomCanvas"), {
  ssr: false,
  loading: () => <div className="h-full bg-[#1c1d22]" />, // hidden behind the closed doors
});

/** Game hall interior: walk in through the auto door, choose a table, sit, play (SRS §8.4.6). */
export default function RoomPage() {
  const { game } = useParams<{ game: string }>();
  const router = useRouter();
  const session = useSession();
  const profile = useProfile();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
    if (isHallGame(game)) useDoorway.getState().hold(HALLS[game].title); // back from a game / reload: open onto the hall
  }, [game]);

  useEffect(() => {
    if (!ready || session.status === "loading" || !isHallGame(game)) return;
    if (session.status === "anonymous" || !profile.onboarded) return void router.replace("/gate");
    useRoom.getState().set({ seated: null, nearSeat: null, doorOpen: false, leaving: false, nearExit: false });
    // plaza proximity state must not leak into the hall ("Enter Pool Hall" prompt while already inside)
    useWorld.getState().set({ nearPortal: null, nearPlayer: null });
    void connectPlaza({ name: profile.name, color: profile.color, level: levelForXp(profile.xp), token: session.accessToken, look: session.me?.look ?? undefined }, { name: "hall", game });
    return () => leavePlaza();
  }, [ready, session.status, profile.onboarded, game]);

  if (!ready || !isHallGame(game)) return null;
  const layout = HALLS[game];
  return (
    <div className="fixed inset-0 overflow-hidden bg-ink-950">
      <RoomCanvas
        layout={layout}
        onExit={() => {
          try {
            sessionStorage.setItem("gk-from-room", "1");
          } catch {
            /* private mode */
          }
          // you walk on out through the door, the frame freezes while the plaza loads, then dissolves onto it
          useDoorway.getState().pass("Gukirana Plaza", () => router.push("/world"));
        }}
      />
      <WorldHud />
      <MatchmakingPanel />
      <WorldControls />
      <RoomOverlay layout={layout} />
      <RotateGuard />
    </div>
  );
}
