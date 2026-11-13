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

const WorldCanvas = dynamic(() => import("@/world/WorldCanvas"), {
  ssr: false,
  // preloaded at the gate; if anything is still loading, show a calm sky + hills instead of a spinner screen
  loading: () => <div className="h-full bg-gradient-to-b from-[#9cc8ea] via-[#d9ecf7] to-[#7fae72]" />,
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
      useWorld.getState().set({ nearPortal: null, nearPlayer: null });
      leavePlaza();
    };
  }, [ready, session.status, profile.onboarded, router]);

  if (!ready || !profile.onboarded) return <div className="fixed inset-0 bg-gradient-to-b from-[#9cc8ea] via-[#d9ecf7] to-[#7fae72]" />;
  return (
    <div className="fixed inset-0 overflow-hidden bg-gradient-to-b from-[#9cc8ea] via-[#d9ecf7] to-[#7fae72]">
      <WorldCanvas profile={{ name: profile.name, color: profile.color, level: levelForXp(profile.xp) }} />
      <WorldHud />
      <MatchmakingPanel />
      <WorldControls />
      <RotateGuard />
    </div>
  );
}
