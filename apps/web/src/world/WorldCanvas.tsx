"use client";
import { useRef } from "react";
import { XROrigin, useXRControllerLocomotion } from "@react-three/xr";
import type { Group } from "three";
import { LocalPlayer, RemotePlayers } from "./Player";
import { SPAWN } from "./layout";
import type { Tier } from "./materials";
import { levelForXp, useProfile } from "@/lib/profile-store";
import { SocialLayer } from "@/social/SocialLayer";

/**
 * The plaza's people and controls inside the persistent stage (world/SceneCanvas): the plaza itself (buildings,
 * landscape, lighting) belongs to the outdoor area and stays mounted; these mount when the plaza is on screen.
 */

// (the human models for other people stream after the first reveal: world/SceneCanvas DeferredAssets)

export { xrStore } from "./xr-store";

function VROrigin() {
  const ref = useRef<Group>(null);
  // thumbstick locomotion + snap turn (comfort defaults, DESIGN-SPEC §15.2)
  useXRControllerLocomotion(ref, { speed: 2 }, { type: "snap", degrees: 45 });
  return <XROrigin ref={ref} position={[SPAWN.x, 0, SPAWN.z + 2]} />;
}

/** Detects a weak device and picks the Lite tier (DESIGN-SPEC §4.3, §16). `?tier=lite|standard` overrides for testing. */
export function pickTier(): Tier {
  if (typeof navigator === "undefined") return "standard";
  const q = new URLSearchParams(location.search).get("tier");
  if (q === "lite" || q === "standard") return q;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return mem <= 3 || (navigator.hardwareConcurrency ?? 8) <= 4 ? "lite" : "standard";
}

export function PlazaActors({ tier }: { tier: Tier }) {
  const name = useProfile((s) => s.name);
  const color = useProfile((s) => s.color);
  const xp = useProfile((s) => s.xp);
  return (
    <>
      <LocalPlayer color={color} name={name} level={levelForXp(xp)} tier={tier} />
      <RemotePlayers tier={tier} />
      <SocialLayer />
      <VROrigin />
    </>
  );
}
