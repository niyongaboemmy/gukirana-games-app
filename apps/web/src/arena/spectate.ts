"use client";
import { create } from "zustand";
import { COMMENTATORS, FEATURE_TABLES, FLOOR_Y, STAGE } from "./bowl";

/**
 * Spectator view while seated in the arena: "eye" puts the camera at your own eyes, aimed at the stage (your avatar
 * is hidden so nothing blocks the view); drag looks around, pinch / wheel zooms. P2-HAL-11: a stage zoom with targets
 * — the whole stage, or one feature table (Pool, Ludo, Igisoro) or the commentary desk: tapping one glides the look
 * point onto it and narrows the lens until it fills the view from YOUR seat (a real lens change: always sharp), with
 * zoom steps on top. VIP box seats start framed on the stage ("VIP view"). Off = the usual over-the-shoulder view.
 */
export type ViewTarget = "stage" | "pool" | "ludo" | "igisoro" | "desk";
export const VIEW_TARGETS: ViewTarget[] = ["stage", "pool", "ludo", "igisoro", "desk"];
/** zoom steps on top of a framing (or the plain eye lens) */
export const ZOOM_STEPS = [1, 1.5, 2, 3] as const;

interface SpectateState {
  eye: boolean;
  /** framed on a target (null = the natural 48° eye lens, centred on the stage) */
  target: ViewTarget | null;
  /** index into ZOOM_STEPS */
  zoom: number;
  /** bumps on every target / zoom tap: the camera re-centres on the target (drag offsets reset) */
  nonce: number;
  /** share of the screen height covered by the seat card at the bottom: the target is centred in the view above it */
  inset: number;
  set: (p: Partial<Omit<SpectateState, "set" | "nonce">>) => void;
  frame: (t: ViewTarget | null) => void;
}
export const useSpectate = create<SpectateState>()((set) => ({
  eye: true,
  target: null,
  zoom: 0,
  nonce: 0,
  inset: 0,
  set,
  frame: (t) => set((s) => ({ target: t, zoom: 0, nonce: s.nonce + 1, eye: true })),
}));

/** what each target is: a point to look at and the radius (m) of what must fit in the view */
export function targetSphere(t: ViewTarget): { x: number; y: number; z: number; r: number } {
  const deck = FLOOR_Y + STAGE.h;
  switch (t) {
    case "stage":
      return { x: 0, y: deck + 0.6, z: STAGE.z, r: Math.hypot(STAGE.hw, STAGE.hd) * 0.92 };
    case "pool":
      return { x: FEATURE_TABLES.pool.x, y: deck + FEATURE_TABLES.pool.h, z: FEATURE_TABLES.pool.z, r: 2.0 };
    case "ludo":
      return { x: FEATURE_TABLES.ludo.x, y: deck + FEATURE_TABLES.ludo.h, z: FEATURE_TABLES.ludo.z, r: 1.35 };
    case "igisoro":
      return { x: FEATURE_TABLES.igisoro.x, y: deck + FEATURE_TABLES.igisoro.h, z: FEATURE_TABLES.igisoro.z, r: 1.4 };
    case "desk":
      return { x: COMMENTATORS.x, y: FLOOR_Y + 1.15, z: COMMENTATORS.z, r: 1.9 };
  }
}

/** the natural eye lens (vertical FOV, deg) and the limits of the zoom */
export const EYE_FOV = 48;
export const FOV_MIN = 8;
export const FOV_MAX = 58;

/**
 * Vertical FOV (deg) that fits a sphere of radius r at distance d into the view (with a little margin), for a viewport
 * of `aspect` (w / h: on a portrait screen the width is the tighter side). Clamped to the lens limits.
 */
export function fitFov(r: number, d: number, aspect = 16 / 9, margin = 1.12): number {
  const half = Math.atan((r * margin) / Math.max(d, r * margin + 0.01));
  // horizontal fit → vertical: tan(v/2) = tan(h/2) / aspect
  const v = aspect < 1 ? 2 * Math.atan(Math.tan(half) / aspect) : 2 * half;
  return Math.min(FOV_MAX, Math.max(FOV_MIN, (v * 180) / Math.PI));
}

/** Look point + lens for a seated eye framed on `t` with zoom step `zoom` (null target = the natural lens). */
export function framing(eye: { x: number; y: number; z: number }, t: ViewTarget | null, zoom: number, aspect = 16 / 9) {
  const s = targetSphere(t ?? "stage");
  const k = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, zoom))] ?? 1;
  const base = t ? fitFov(s.r, Math.hypot(s.x - eye.x, s.y - eye.y, s.z - eye.z), aspect) : EYE_FOV;
  // zoom steps narrow the lens (tan scales with the magnification), never past the limits
  const fov = Math.max(FOV_MIN, Math.min(FOV_MAX, ((2 * Math.atan(Math.tan((base * Math.PI) / 360) / k)) * 180) / Math.PI));
  return { look: { x: s.x, y: t ? s.y : FLOOR_Y + STAGE.h + 0.85, z: s.z }, fov, framed: !!t || k > 1 };
}
