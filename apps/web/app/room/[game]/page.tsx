"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { WorldHud } from "@/hud/WorldHud";
import { WorldControls } from "@/hud/WorldControls";
import { RotateGuard } from "@/hud/RotateGuard";
import { MatchmakingPanel } from "@/match/MatchmakingPanel";
import { RoomOverlay } from "@/rooms/RoomOverlay";
import { AdminBlockOverlay } from "@/admin-block/AdminBlockOverlay";
import { ArenaOverlay } from "@/arena/ArenaOverlay";
import { FightOverlay, LiveBoxingNet } from "@/fight/FightOverlay";
import { GymPrompt } from "@/fight/GymPrompt";
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

  if (!ready || !isHallGame(game)) return null;
  // the live boxing client runs for the whole Boxing hall visit, also while the stage boots / re-warms (same tree
  // position whether the HUD shows or not: moving it would restart it and drop a running fight)
  const net = game === "boxing" && session.status === "authenticated" && profile.onboarded ? <LiveBoxingNet /> : null;
  const layout = HALLS[game];
  return (
    <>
      {net}
      {/* the HUD never shows over a scene that is still booting (it fades in after the reveal) */}
      {hud && (
        <div className="gk-hud-in">
          <WorldHud />
          <MatchmakingPanel />
          <WorldControls />
          {game === "admin" ? <AdminBlockOverlay layout={layout} /> : game === "fight" || game === "boxing" ? <><FightOverlay layout={layout} /><GymPrompt game={game} /></> : game === "arena" ? <ArenaOverlay layout={layout} /> : <RoomOverlay layout={layout} />}
          <RotateGuard />
        </div>
      )}
    </>
  );
}
