import { create } from "zustand";
import { ZOOM_MIN } from "./aerial";

/**
 * Eye view (P2-WLD-16): first person from your own eyes, besides the follow camera behind you. Toggled from the HUD
 * (WorldControls), with the P key, or by zooming all the way in (one more zoom-in step at the closest follow distance
 * enters it, a zoom-out step leaves it). In the eye view a drag looks around (it turns you; pitch clamped), W/S walk
 * where you look, A/D turn (the same eased turning as ever), the joystick walks camera-relative, a tap walks there.
 * No head bob (motion-sickness safe); the switch glides over ~0.45 s, instantly with reduced motion. Your own body is
 * hidden while the camera is at your eyes. Works on the plaza / campus and in the halls' walking areas (seated views
 * keep the hall's own camera). WebXR is not affected (the XR rig owns the camera there).
 *
 * The maths is pure (unit tested in eye-view.test.ts); the cameras (Player.tsx, rooms/RoomPlayer.tsx) apply it.
 */

/** NEXT_PUBLIC_FF_EYE_VIEW=0 hides the eye view (the follow camera only, as before). */
export const EYE_VIEW_ON = process.env.NEXT_PUBLIC_FF_EYE_VIEW !== "0";

/** Eye height (m) above the feet (adult avatars ≈ 1.70–1.80 m tall). */
export const EYE_H = 1.62;
/** The camera sits this far in front of the head's centre (m): nothing of the head in view, never inside a wall. */
export const EYE_FWD = 0.12;
/** Look pitch limits (rad, + = up). */
export const EYE_PITCH_MIN = -1.15;
export const EYE_PITCH_MAX = 1.05;
/** Near plane in the eye view (m): close enough not to clip into a wall you stand at. */
export const EYE_NEAR = 0.05;
/** Seconds of the glide between the follow camera and the eye view. */
export const EYE_BLEND_S = 0.45;
/** The keyboard toggle (V is push-to-talk). */
export const EYE_KEY = "KeyP";

export type CamMode = "follow" | "eye";
export const useCamMode = create<{ mode: CamMode; set: (m: CamMode) => void; toggle: () => void }>()((set, get) => ({
  mode: "follow",
  set: (mode) => set({ mode: EYE_VIEW_ON ? mode : "follow" }),
  toggle: () => get().set(get().mode === "eye" ? "follow" : "eye"),
}));

/** Live state the camera rigs share: the look pitch and the 0 → 1 blend into the eye view. */
export const eye = { pitch: -0.08, blend: 0 };

/** Ease the blend towards the mode (smoothstepped by the caller); `reduced`: prefers-reduced-motion = instant. */
export function stepBlend(blend: number, on: boolean, dt: number, reduced = false): number {
  if (reduced) return on ? 1 : 0;
  const v = blend + (on ? dt : -dt) / EYE_BLEND_S;
  return Math.min(1, Math.max(0, v));
}
export const smooth01 = (t: number) => t * t * (3 - 2 * t);

/** A drag in the eye view: dx turns you (rad of facing), dy looks up / down. */
export function eyeDrag(facing: number, pitch: number, dx: number, dy: number): { facing: number; pitch: number } {
  return { facing: facing - dx * 0.005, pitch: Math.min(EYE_PITCH_MAX, Math.max(EYE_PITCH_MIN, pitch - dy * 0.004)) };
}

/** Camera position and look point for the eye view of a person at (x, y, z) facing `facing` (rad, +z = 0). */
export function eyePose(x: number, y: number, z: number, facing: number, pitch: number, eyeH = EYE_H) {
  const fx = Math.sin(facing);
  const fz = Math.cos(facing);
  const p = { x: x + fx * EYE_FWD, y: y + eyeH, z: z + fz * EYE_FWD };
  const cp = Math.cos(pitch);
  return { p, look: { x: p.x + fx * cp * 4, y: p.y + Math.sin(pitch) * 4, z: p.z + fz * cp * 4 } };
}

/**
 * Zooming with the eye view: `dir` < 0 zooms in, > 0 out. At the closest follow distance one more zoom-in enters
 * the eye view; any zoom-out in the eye view leaves it (back at the closest follow distance). Returns the new
 * distance and the mode, or null when the eye view is not involved (the caller zooms as before).
 */
export function zoomEye(mode: CamMode, distance: number, dir: number): { distance: number; mode: CamMode } | null {
  if (!EYE_VIEW_ON) return null;
  if (mode === "eye") return dir > 0 ? { distance: Math.max(distance, ZOOM_MIN), mode: "follow" } : { distance, mode: "eye" };
  if (dir < 0 && distance <= ZOOM_MIN + 0.01) return { distance: ZOOM_MIN, mode: "eye" };
  return null;
}

let mq: MediaQueryList | null | undefined;
/** prefers-reduced-motion (the media query is created once and read live) */
export const reducedMotion = () => {
  if (mq === undefined) mq = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  return !!mq?.matches;
};
