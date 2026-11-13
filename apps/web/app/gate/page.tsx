"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GateFlow } from "@/components/GateFlow";
import { RotateGuard } from "@/hud/RotateGuard";
import { refreshSession, useSession } from "@/lib/session";
import { useProfile } from "@/lib/profile-store";
import { useGate } from "@/world/gate/gate-store";
import { decodeLook } from "@/world/outfits";
import { useStage } from "@/world/stage";

/**
 * 3D arrival gate (entry to the world): show your ID (phone or email + OTP) at the kiosk, the turnstile opens,
 * new players set up at the wardrobe, then walk on into the plaza in one continuous walk (the gate and the plaza
 * are the same outdoor area of the persistent stage, world/SceneHost). Signing out ends here too: the person
 * walks back out through the turnstiles and the tablet comes up for the next visitor.
 * Session restore: an authenticated player with a username walks straight inside.
 */
export default function GatePage() {
  const router = useRouter();
  const status = useSession((s) => s.status);
  const me = useSession((s) => s.me);
  const [ready, setReady] = useState(false);
  // the tablet only slides in once the gate scene is actually drawing
  const drawing = useStage((s) => !!s.ready.outdoor && s.view === "gate" && s.hud);

  useEffect(() => {
    setReady(true);
    // arriving after signing out: the walk-out is already playing (gate step "leaving"), don't restart the arrival
    if (useGate.getState().step !== "leaving") {
      let skip = false;
      try {
        skip = localStorage.getItem("gk-skip-intro") === "1";
      } catch {
        /* private mode */
      }
      useGate.setState({ step: skip ? "id" : "arrive", code: "", devCode: null, error: null, busy: false });
    }
    if (useSession.getState().status === "loading") void refreshSession();
  }, [router]);

  // apply the server look to the local avatar whenever we have a session
  useEffect(() => {
    if (!me) return;
    if (me.look) useProfile.getState().setLook(decodeLook(me.look, me.color));
    else useProfile.getState().setBodyType(me.bodyType);
  }, [me]);

  // already signed in → skip the ID check (straight inside, or to the wardrobe if no username yet)
  useEffect(() => {
    if (status !== "authenticated" || !me || useStage.getState().exiting) return;
    const s = useGate.getState().step;
    if (s !== "arrive" && s !== "id") return;
    // returning player: the turnstile opens and they walk through (no instant jump, no loading screen)
    if (me.username) useGate.setState({ step: "opening", isNew: false });
    else useGate.setState({ step: "setup", isNew: true });
  }, [status, me, router]);

  if (!ready || !drawing) return null;
  return (
    <>
      <GateFlow />
      <RotateGuard />
    </>
  );
}
