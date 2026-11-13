"use client";
import dynamic from "next/dynamic";
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
import { useDoorway } from "@/world/doorway";

const WorldCanvas = dynamic(() => import("@/world/WorldCanvas"), {
  ssr: false,
  // preloaded at the gate; if anything is still loading, show a calm sky + hills instead of a spinner screen
  loading: () => <div className="h-full bg-[#1c1d22]" />, // hidden behind the closed doors
});

export default function WorldPage() {
  const router = useRouter();
  const profile = useProfile();
  const [ready, setReady] = useState(false);
  // fade in from black only when stepping out of a hall (the gate hand-off stays seamless)
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

  useEffect(() => {
    setReady(true);
    useDoorway.getState().hold("Gukirana Plaza"); // no-op when you just walked through a door (already shut)
  }, []);
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

  if (!ready || !profile.onboarded) return <div className="fixed inset-0 bg-[#1c1d22]" />;
  return (
    <div className="fixed inset-0 overflow-hidden bg-[#1c1d22]">
      <WorldCanvas profile={{ name: profile.name, color: profile.color, level: levelForXp(profile.xp) }} />
      <WorldHud />
      <MatchmakingPanel />
      {fromRoom && (
        <div role="status" className="gk-toast pointer-events-none fixed left-1/2 top-16 z-30 -translate-x-1/2 rounded-full border border-white/20 bg-[#151935]/85 px-4 py-2 text-sm font-bold text-white shadow-xl backdrop-blur-md">
          Back in the plaza · walk to any lit door to enter a room
        </div>
      )}
      <WorldControls />
      <RotateGuard />
    </div>
  );
}
