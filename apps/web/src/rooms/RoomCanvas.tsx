"use client";
import { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { AdaptiveDpr } from "@react-three/drei";
import { RoomScene } from "./RoomScene";
import { RoomPlayer } from "./RoomPlayer";
import { RemotePlayers } from "@/world/Player";
import type { HallLayout } from "./layouts";

function pickTier(): "lite" | "standard" {
  if (typeof window !== "undefined" && new URLSearchParams(location.search).get("tier") === "lite") return "lite";
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return mem <= 3 || (navigator.hardwareConcurrency ?? 8) <= 4 ? "lite" : "standard";
}

export default function RoomCanvas({ layout, onExit }: { layout: HallLayout; onExit: () => void }) {
  const tier = useMemo(pickTier, []);
  return (
    <Canvas shadows={tier !== "lite"} dpr={tier === "lite" ? [1, 1.25] : [1, 1.75]} camera={{ fov: 55, near: 0.05, far: 120, position: [0, 4, 14] }} gl={{ antialias: tier !== "lite" }} style={{ touchAction: "none" }}>
      <AdaptiveDpr pixelated={false} />
      <Suspense fallback={null}>
        <RoomScene layout={layout} lite={tier === "lite"} />
        <RoomPlayer layout={layout} onExit={onExit} tier={tier} />
        <RemotePlayers tier={tier} />
      </Suspense>
    </Canvas>
  );
}
