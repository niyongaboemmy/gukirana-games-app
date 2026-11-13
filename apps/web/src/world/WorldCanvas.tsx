"use client";
import { Suspense, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { AdaptiveDpr, PerformanceMonitor } from "@react-three/drei";
import { createXRStore, XR, XROrigin, useXR, useXRControllerLocomotion } from "@react-three/xr";
import * as THREE from "three";
import type { Group } from "three";
import { Plaza } from "./Plaza";
import { Effects } from "./Lighting";
import { LocalPlayer, RemotePlayers } from "./Player";
import { SPAWN } from "./layout";
import type { Tier } from "./materials";
import { useWorld } from "@/lib/world-store";
import { WorldOverlays } from "./GateExitPrompt";
import { preloadHumans } from "./Avatar";

// start streaming the realistic human models + animation sets as soon as the world bundle loads
if (typeof window !== "undefined") preloadHumans();

export const xrStore = createXRStore({
  emulate: false,
  hand: { teleportPointer: true },
  controller: { teleportPointer: true },
});

function VROrigin() {
  const ref = useRef<Group>(null);
  // thumbstick locomotion + snap turn (comfort defaults, DESIGN-SPEC §15.2)
  useXRControllerLocomotion(ref, { speed: 2 }, { type: "snap", degrees: 45 });
  return <XROrigin ref={ref} position={[SPAWN.x, 0, SPAWN.z + 2]} />;
}

/** Detects a weak device and picks the Lite tier (DESIGN-SPEC §4.3, §16). `?tier=lite|standard` overrides for testing. */
function pickTier(): Tier {
  if (typeof navigator === "undefined") return "standard";
  const q = new URLSearchParams(location.search).get("tier");
  if (q === "lite" || q === "standard") return q;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return mem <= 3 || (navigator.hardwareConcurrency ?? 8) <= 4 ? "lite" : "standard";
}

/** Bloom only on Standard, only outside XR (post-processing breaks foveation / layers on Quest), and only while fps holds. */
function MaybeEffects({ enabled }: { enabled: boolean }) {
  const inXR = useXR((s) => s.session != null);
  return enabled && !inXR ? <Effects /> : null;
}

export default function WorldCanvas({
  profile,
}: {
  profile: { name: string; color: string; level: number };
}) {
  const nearPortal = useWorld((s) => s.nearPortal);
  const tier = useMemo(pickTier, []);
  const [fx, setFx] = useState(tier === "standard");
  return (
    <>
      <Canvas
        shadows={tier === "lite" ? false : "percentage"}
        dpr={tier === "lite" ? [1, 1.25] : [1, 1.75]}
        camera={{ fov: 60, near: 0.15, far: 3200, position: [0, 4, 24] }}
        gl={{
          antialias: tier !== "lite",
          powerPreference: "high-performance",
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.0,
        }}
        style={{ touchAction: "none" }}
      >
        {/* Dynamic quality (§16.3): drop bloom first when frame time is over budget, restore when it recovers. */}
        <PerformanceMonitor
          onDecline={() => setFx(false)}
          onIncline={() => setFx(tier === "standard")}
          flipflops={3}
          onFallback={() => setFx(false)}
        />
        <AdaptiveDpr pixelated={false} />
        <XR store={xrStore}>
          <Suspense fallback={null}>
            <Plaza nearPortal={nearPortal} tier={tier} />
            <LocalPlayer color={profile.color} name={profile.name} level={profile.level} tier={tier} />
            <RemotePlayers tier={tier} />
            <VROrigin />
          </Suspense>
          <MaybeEffects enabled={fx} />
        </XR>
      </Canvas>
      <WorldOverlays />
    </>
  );
}
