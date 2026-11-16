"use client";
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import { invalidateCaptures } from "../GlassCapture";
import { applyDaylightTint, todUniforms } from "./hooks";
import { onTimePhaseChange, stepTimeOfDay, tod } from "./store";
import { useStage } from "../stage";
import { showAmp, SHOW_WRAP } from "../night/show";

/** reduced-motion preference (read once per mount: the night show holds its static warm state) */
const prefersReducedMotion = () => {
  try {
    return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

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
  // P2-WLD-21 night show: animated on Standard only, never with reduced motion (Lite: static lights)
  const lite = useStage((s) => s.tier === "lite");
  const motion = useRef(true);
  useEffect(() => void (motion.current = !prefersReducedMotion()), []);
  useEffect(() => onTimePhaseChange(() => invalidateCaptures("reflections")), []);
  // dev-only: the root scene for the QA scripts (qa/e2e/tod-debug.mjs lists the lights of every area)
  const root = useThree((s) => s.scene);
  useEffect(() => {
    if (process.env.NODE_ENV !== "production")
      (window as unknown as Record<string, unknown>).__gkTodRoot = root;
  }, [root]);
  useFrame(() => {
    const now = performance.now();
    stepTimeOfDay(now, inXR);
    // the night show clock and its amplitude (every frame: the animation runs between time-of-day samples)
    todUniforms.uGkShowT.value = (now / 1000) % SHOW_WRAP;
    todUniforms.uGkShowK.value = showAmp(tod.look.lights, motion.current && !lite);
    if (ver.current === tod.version) return;
    ver.current = tod.version;
    const L = tod.look;
    todUniforms.uGkLamp.value = L.lampHead;
    todUniforms.uGkNight.value = L.lights;
    todUniforms.uGkWin.value = L.windows / 0.3;
    todUniforms.uGkHaze.value.set(...L.hazeSrgb);
    todUniforms.uGkFar.value = L.farDim;
    applyDaylightTint(L.unlit);
    // the plaza through a hall door: daylight tint, never quite black (the plaza lamps light it after dusk)
    const g = todUniforms.uGkGlimpse.value;
    g.setRGB(
      Math.max(L.unlit[0], 0.1 * L.lights),
      Math.max(L.unlit[1], 0.075 * L.lights),
      Math.max(L.unlit[2], 0.05 * L.lights),
    );
  }, -10);
  return null;
}
