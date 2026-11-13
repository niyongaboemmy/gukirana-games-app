"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { WorldHud } from "@/hud/WorldHud";
import { RotateGuard } from "@/hud/RotateGuard";
import { levelForXp, useProfile } from "@/lib/profile-store";
import { connectPlaza, leavePlaza } from "@/lib/realtime";
import { saveWorldPose } from "@/lib/return-point";
import { useWorld } from "@/lib/world-store";
import { useSession } from "@/lib/session";
import { MatchmakingPanel } from "@/match/MatchmakingPanel";
import { WorldControls } from "@/hud/WorldControls";
import { WorldOverlays } from "@/world/GateExitPrompt";
import { useStage } from "@/world/stage";

/**
 * The plaza. The 3D scene lives in the persistent stage (world/SceneHost in the root layout), which already shows
 * the plaza when you walk in from the gate or out of a hall; this page owns the plaza's realtime room and its HUD.
 */
export default function WorldPage() {
  const router = useRouter();
  const profile = useProfile();
  const [ready, setReady] = useState(false);
  // a short note only when stepping out of a hall
  const [fromRoom] = useState(() => {
    try {
      const v = typeof window !== "undefined" && sessionStorage.getItem("gk-from-room") === "1";
      if (v) sessionStorage.removeItem("gk-from-room");
      return v;
    } catch {
      return false;
    }
  });
  const session = useSession();
  const hud = useStage((s) => s.hud);

  useEffect(() => setReady(true), []);
  useEffect(() => {
    if (!ready || session.status === "loading") return;
    if (session.status === "anonymous" || !profile.onboarded) {
      router.replace("/gate");
      return;
    }
    void connectPlaza({ name: profile.name, color: profile.color, level: levelForXp(profile.xp), token: session.accessToken, look: session.me?.look ?? undefined });
    return () => {
      // only remember the spot while signed in (signing out must not save "where you signed out")
      if (useSession.getState().status === "authenticated") saveWorldPose();
      useWorld.getState().set({ nearPortal: null, nearPlayer: null });
      leavePlaza();
    };
  }, [ready, session.status, profile.onboarded, router]);

  // the HUD never shows over a scene that is still booting (it fades in after the reveal)
  if (!ready || !profile.onboarded || !hud) return null;
  return (
    <div className="gk-hud-in">
      <WorldHud />
      <MatchmakingPanel />
      {fromRoom && (
        <div role="status" className="gk-toast pointer-events-none fixed left-1/2 top-16 z-30 -translate-x-1/2 toast px-4 py-2 text-sm font-bold">
          Back in the plaza · walk to any lit door to enter a room
        </div>
      )}
      <WorldControls />
      <WorldOverlays />
      <RotateGuard />
    </div>
  );
}
