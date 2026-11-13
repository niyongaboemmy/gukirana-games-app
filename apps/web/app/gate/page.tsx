"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GateFlow } from "@/components/GateFlow";
import { RotateGuard } from "@/hud/RotateGuard";
import { refreshSession, useSession } from "@/lib/session";
import { useProfile } from "@/lib/profile-store";
import { useGate } from "@/world/gate/gate-store";
import { decodeLook } from "@/world/outfits";
import { clearPositions } from "@/lib/return-point";

const GateCanvas = dynamic(() => import("@/world/gate/GateCanvas"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center bg-[#0b0d1a] text-white">
      <div className="text-center">
        <div className="mx-auto mb-3 size-12 animate-spin rounded-full border-4 border-white/20 border-t-[#3DA9FC]" />
        <p className="font-bold">Arriving at Gukirana Playground…</p>
      </div>
    </div>
  ),
});

/**
 * 3D arrival gate (entry to the world): show your ID (phone or email + OTP) at the kiosk, the turnstile opens,
 * new players set up at the wardrobe, then walk into the arena district (/world).
 * Session restore: an authenticated player with a username skips straight inside.
 */
export default function GatePage() {
  const router = useRouter();
  const status = useSession((s) => s.status);
  const me = useSession((s) => s.me);
  const step = useGate((s) => s.step);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
    useGate.setState({ step: "arrive", code: "", devCode: null, error: null, busy: false });
    if (useSession.getState().status === "loading") void refreshSession();
    // preload the playground while the player is at the gate, so the hand-off never shows a loading screen
    router.prefetch("/world");
    void import("@/world/WorldCanvas");
    void import("@/hud/WorldHud");
  }, [router]);

  // apply the server look to the local avatar whenever we have a session
  useEffect(() => {
    if (!me) return;
    if (me.look) useProfile.getState().setLook(decodeLook(me.look, me.color));
    else useProfile.getState().setBodyType(me.bodyType);
  }, [me]);

  // already signed in → skip the ID check (straight inside, or to the wardrobe if no username yet)
  useEffect(() => {
    if (status !== "authenticated" || !me) return;
    const s = useGate.getState().step;
    if (s !== "arrive" && s !== "id") return;
    // returning player: the turnstile opens and they walk through (no instant jump, no loading screen)
    if (me.username) useGate.setState({ step: "opening", isNew: false });
    else useGate.setState({ step: "setup", isNew: true });
  }, [status, me, router]);

  useEffect(() => {
    if (step !== "entering") return;
    clearPositions(); // coming in through the gate: spawn just inside it
    const t = setTimeout(() => router.push("/world"), 2300);
    return () => clearTimeout(t);
  }, [step, router]);

  if (!ready) return null;
  return (
    <div className="fixed inset-0 overflow-hidden bg-[#0b0d1a]">
      <GateCanvas />
      <GateFlow />
      <RotateGuard />
    </div>
  );
}
