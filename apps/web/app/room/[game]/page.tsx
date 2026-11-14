"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { WorldHud } from "@/hud/WorldHud";
import { WorldControls } from "@/hud/WorldControls";
import { RotateGuard } from "@/hud/RotateGuard";
import { MatchmakingPanel } from "@/match/MatchmakingPanel";
import { RoomOverlay } from "@/rooms/RoomOverlay";
import { AdminBlockOverlay } from "@/admin-block/AdminBlockOverlay";
import { ConsoleLauncher } from "@/console/ConsoleLauncher";
import { HALLS, isHallGame } from "@/rooms/layouts";
import { useRoom } from "@/rooms/room-store";
import { levelForXp, useProfile } from "@/lib/profile-store";
import { connectPlaza, leavePlaza } from "@/lib/realtime";
import { useSession } from "@/lib/session";
import { useWorld } from "@/lib/world-store";
import { useStage } from "@/world/stage";

/**
 * Game hall interior: walk in through the auto door, choose a table, sit, play (SRS §8.4.6). The hall itself is an
 * area of the persistent stage (world/SceneHost); walking out of its door continues live on the plaza.
 */
export default function RoomPage() {
  const { game } = useParams<{ game: string }>();
  const router = useRouter();
  const session = useSession();
  const profile = useProfile();
  const [ready, setReady] = useState(false);
  const hud = useStage((s) => s.hud);
  useEffect(() => setReady(true), []);

  useEffect(() => {
    if (!ready || session.status === "loading" || !isHallGame(game)) return;
    if (session.status === "anonymous" || !profile.onboarded) return void router.replace("/gate");
    useRoom.getState().set({ seated: null, nearSeat: null, leaving: false, nearExit: false });
    // plaza proximity state must not leak into the hall ("Enter Pool Hall" prompt while already inside)
    useWorld.getState().set({ nearPortal: null, nearPlayer: null });
    void connectPlaza({ name: profile.name, color: profile.color, level: levelForXp(profile.xp), token: session.accessToken, look: session.me?.look ?? undefined }, { name: "hall", game });
    return () => leavePlaza();
  }, [ready, session.status, profile.onboarded, game]);

  // the HUD never shows over a scene that is still booting (it fades in after the reveal)
  if (!ready || !isHallGame(game) || !hud) return null;
  const layout = HALLS[game];
  return (
    <div className="gk-hud-in">
      <WorldHud />
      <MatchmakingPanel />
      <WorldControls />
      {game === "admin" ? <AdminBlockOverlay layout={layout} /> : <RoomOverlay layout={layout} />}
      {game === "admin" && <ConsoleLauncher />}
      <RotateGuard />
    </div>
  );
}
