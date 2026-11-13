"use client";
import { Suspense, useMemo, useState, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { AdaptiveDpr, PerformanceMonitor } from "@react-three/drei";
import * as THREE from "three";
import { Effects } from "@/world/Lighting";
import { RoomScene } from "./RoomScene";
import { RoomPlayer } from "./RoomPlayer";
import { RemotePlayers } from "@/world/Player";
import type { HallLayout } from "./layouts";

function pickTier(): "lite" | "standard" {
  if (typeof window !== "undefined" && new URLSearchParams(location.search).get("tier") === "lite")
    return "lite";
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return mem <= 3 || (navigator.hardwareConcurrency ?? 8) <= 4 ? "lite" : "standard";
}

export default function RoomCanvas({
  layout,
  onExit,
  children,
}: {
  layout: HallLayout;
  onExit: () => void;
  children?: ReactNode;
}) {
  const tier = useMemo(pickTier, []);
  // bloom on the lamps / neon only on Standard and only while the frame rate holds (DESIGN-SPEC §16.3)
  const [fx, setFx] = useState(tier === "standard");
  return (
    <Canvas
      shadows={tier !== "lite"}
      dpr={tier === "lite" ? [1, 1.25] : [1, 1.75]}
      camera={{ fov: 55, near: 0.05, far: 120, position: [0, 4, 14] }}
      gl={{
        antialias: tier !== "lite",
        powerPreference: "high-performance",
        toneMapping: THREE.ACESFilmicToneMapping,
      }}
      style={{ touchAction: "none" }}
    >
      <PerformanceMonitor
        onDecline={() => setFx(false)}
        onIncline={() => setFx(tier === "standard")}
        flipflops={3}
        onFallback={() => setFx(false)}
      />
      <AdaptiveDpr pixelated={false} />
      <Suspense fallback={null}>
        <RoomScene layout={layout} lite={tier === "lite"} />
        <RoomPlayer layout={layout} onExit={onExit} tier={tier} />
        <RemotePlayers tier={tier} />
        {children}
      </Suspense>
      {fx && <Effects />}
    </Canvas>
  );
}
