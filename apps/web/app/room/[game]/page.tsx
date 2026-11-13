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

const RoomCanvas = dynamic(() => import("@/rooms/RoomCanvas"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center bg-[#0b0d1a] font-bold text-white">Opening the doors…</div>,
});

/** Game hall interior: walk in through the auto door, choose a table, sit, play (SRS §8.4.6). */
export default function RoomPage() {
  const { game } = useParams<{ game: string }>();
  const router = useRouter();
  const session = useSession();
  const profile = useProfile();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  useEffect(() => {
    if (!ready || session.status === "loading" || !isHallGame(game)) return;
    if (session.status === "anonymous" || !profile.onboarded) return void router.replace("/gate");
    useRoom.getState().set({ seated: null, nearSeat: null, doorOpen: false });
    void connectPlaza({ name: profile.name, color: profile.color, level: levelForXp(profile.xp), token: session.accessToken, look: session.me?.look ?? undefined }, { name: "hall", game });
    return () => leavePlaza();
  }, [ready, session.status, profile.onboarded, game]);

  if (!ready || !isHallGame(game)) return null;
  const layout = HALLS[game];
  return (
    <div className="fixed inset-0 overflow-hidden bg-[#0b0d1a]">
      <RoomCanvas layout={layout} onExit={() => router.push("/world")} />
      <WorldHud />
      <MatchmakingPanel />
      <WorldControls />
      <RoomOverlay layout={layout} />
      <RotateGuard />
    </div>
  );
}
