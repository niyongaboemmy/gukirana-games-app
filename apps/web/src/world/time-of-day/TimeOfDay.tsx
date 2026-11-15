"use client";
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import { invalidateCaptures } from "../GlassCapture";
import { applyDaylightTint, todUniforms } from "./hooks";
import { onTimePhaseChange, stepTimeOfDay, tod } from "./store";

/**
 * The time-of-day driver (P2-WLD-19), mounted once at the root of the persistent canvas (world/SceneCanvas): it
 * advances the clock every frame and pushes the shared values every lit part reads (lamp diffusers, window glow,
 * far-hill haze, unlit daylight tints). The area scenes read `tod` themselves (Lighting, Clouds, NightLights …).
 *
 * When the phase has settled on a new value, the facade glass reflections (world/GlassCapture, P2-WLD-18) are retaken
 * so the glass reflects the evening / night forecourt; the hall window views (rooms/OutdoorView) re-capture
 * themselves on the same event.
 */
export function TimeOfDay() {
  const inXR = useXR((s) => s.session != null);
  const ver = useRef(-1);
  useEffect(() => onTimePhaseChange(() => invalidateCaptures("reflections")), []);
  // dev-only: the root scene for the QA scripts (qa/e2e/tod-debug.mjs lists the lights of every area)
  const root = useThree((s) => s.scene);
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") (window as unknown as Record<string, unknown>).__gkTodRoot = root;
  }, [root]);
  useFrame(() => {
    stepTimeOfDay(performance.now(), inXR);
    if (ver.current === tod.version) return;
    ver.current = tod.version;
    const L = tod.look;
    todUniforms.uGkLamp.value = L.lampHead;
    todUniforms.uGkWin.value = L.windows / 0.3;
    todUniforms.uGkHaze.value.set(...L.hazeSrgb);
    applyDaylightTint(L.unlit);
  }, -10);
  return null;
}
