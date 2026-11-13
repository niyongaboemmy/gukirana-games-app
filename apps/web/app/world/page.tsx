"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { WorldHud } from "@/hud/WorldHud";
import { RotateGuard } from "@/hud/RotateGuard";
import { levelForXp, useProfile } from "@/lib/profile-store";
import { connectPlaza, leavePlaza } from "@/lib/realtime";
import { saveWorldPose } from "@/lib/return-point";
import { useSession } from "@/lib/session";
import { MatchmakingPanel } from "@/match/MatchmakingPanel";
import { WorldControls } from "@/hud/WorldControls";

const WorldCanvas = dynamic(() => import("@/world/WorldCanvas"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center bg-[#0b0d1a] text-white">
      <div className="text-center">
        <div className="mx-auto mb-3 size-12 animate-spin rounded-full border-4 border-white/20 border-t-[#3DA9FC]" />
        <p className="font-bold">Loading Gukirana Plaza…</p>
      </div>
    </div>
  ),
});

export default function WorldPage() {
  const router = useRouter();
  const profile = useProfile();
  const [ready, setReady] = useState(false);
  const session = useSession();

  useEffect(() => {
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready || session.status === "loading") return;
    if (session.status === "anonymous" || !profile.onboarded) {
      router.replace("/gate");
      return;
    }
    void connectPlaza({ name: profile.name, color: profile.color, level: levelForXp(profile.xp), token: session.accessToken, look: session.me?.look ?? undefined });
    return () => {
      saveWorldPose();
      leavePlaza();
    };
  }, [ready, session.status, profile.onboarded, router]);

  if (!ready || !profile.onboarded) return null;
  return (
    <div className="fixed inset-0 overflow-hidden bg-[#0b0d1a]">
      <WorldCanvas profile={{ name: profile.name, color: profile.color, level: levelForXp(profile.xp) }} />
      <WorldHud />
      <MatchmakingPanel />
      <WorldControls />
      <RotateGuard />
    </div>
  );
}
