"use client";
import { Suspense, useMemo, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { AdaptiveDpr, PerformanceMonitor } from "@react-three/drei";
import { createXRStore, XR, XROrigin, useXRControllerLocomotion } from "@react-three/xr";
import type { Group } from "three";
import { Plaza } from "./Plaza";
import { LocalPlayer, RemotePlayers } from "./Player";
import { SPAWN } from "./layout";
import { useWorld } from "@/lib/world-store";

export const xrStore = createXRStore({ emulate: false, hand: { teleportPointer: true }, controller: { teleportPointer: true } });

function VROrigin() {
  const ref = useRef<Group>(null);
  // thumbstick locomotion + snap turn (comfort defaults, DESIGN-SPEC §15.2)
  useXRControllerLocomotion(ref, { speed: 2 }, { type: "snap", degrees: 45 });
  return <XROrigin ref={ref} position={[SPAWN.x, 0, SPAWN.z + 2]} />;
}

/** Detects a weak device and picks the Lite tier (DESIGN-SPEC §4.3, §16). */
function pickTier(): "lite" | "standard" {
  if (typeof navigator === "undefined") return "standard";
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return mem <= 3 || (navigator.hardwareConcurrency ?? 8) <= 4 ? "lite" : "standard";
}

export default function WorldCanvas({ profile }: { profile: { name: string; color: string; level: number } }) {
  const nearPortal = useWorld((s) => s.nearPortal);
  const tier = useMemo(pickTier, []);
  return (
    <Canvas
      shadows={tier !== "lite"}
      dpr={tier === "lite" ? [1, 1.25] : [1, 1.75]}
      camera={{ fov: 60, near: 0.1, far: 600, position: [0, 4, 24] }}
      gl={{ antialias: tier !== "lite", powerPreference: "high-performance" }}
      style={{ touchAction: "none" }}
    >
      <PerformanceMonitor />
      <AdaptiveDpr pixelated={false} />
      <XR store={xrStore}>
        <Suspense fallback={null}>
          <Plaza nearPortal={nearPortal} />
          <LocalPlayer color={profile.color} name={profile.name} level={profile.level} />
          <RemotePlayers />
          <VROrigin />
        </Suspense>
      </XR>
    </Canvas>
  );
}
