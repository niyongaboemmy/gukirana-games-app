import { create } from "zustand";
import type { RingId } from "@gukirana/contracts";

/**
 * Focus mode (P3-FGT-05): when you fight in a ring (practice or live) the hall narrows to that ring — the other rings,
 * fighters, signs, spectators and clutter fade into darkness, a spot pool lights your ring, the camera takes the fight
 * view and the HUD shows only the fight. Watching a ring with a watch camera gives a lighter version (the rest of the
 * hall dimmed, nothing hidden). Leaving the ring restores the hall the same way back.
 *
 * Fade first, cull second: the darkness (fog + background) eases in over FADE_IN_S; only once the surroundings are fully
 * dark are they culled (fewer draw calls), and on the way out they are shown again BEFORE the darkness lifts. So nothing
 * ever pops or flickers.
 *
 * Pure state + easing here (tested); the R3F driver is fight/FocusMode.tsx. Other hall layers (training zone, gym
 * life, signs) read `focusNow` every frame or `useFightFocus` in React: `hidden` = cull now, `dim` = 0..1 darkness.
 */

export type FocusMode = "fighter" | "spectator";
export interface FocusTarget {
  ring: RingId | null;
  mode: FocusMode | null;
}

/** seconds to fade the hall out / back in */
export const FADE_IN_S = 0.9;
export const FADE_OUT_S = 0.7;
/** darkness the spectator version stops at (0..1) */
export const SPECTATOR_DIM = 0.55;
/** cull once the fade passed this (the surroundings are black by then) */
export const CULL_AT = 0.985;

/** what the bridge + the world UI ask for right now */
export function focusTarget(input: {
  mine: { ring: RingId; snap: { phase: string } | null } | null;
  watched: { ring: RingId } | null;
  watchCam: string | null;
}): FocusTarget {
  if (input.mine?.snap) return { ring: input.mine.ring, mode: "fighter" };
  if (input.mine) return { ring: input.mine.ring, mode: "fighter" };
  if (input.watched && input.watchCam) return { ring: input.watched.ring, mode: "spectator" };
  return { ring: null, mode: null };
}

export interface FocusState {
  /** the ring in focus (kept while fading out, so the fade-out happens around the same ring) */
  ring: RingId | null;
  mode: FocusMode | null;
  /** 0 = the normal hall … 1 = fully focused (fighter) / SPECTATOR_DIM (spectator) */
  k: number;
  /** the surroundings are culled (only while fully dark) */
  hidden: boolean;
}
export const FOCUS_IDLE: FocusState = { ring: null, mode: null, k: 0, hidden: false };

const goalOf = (mode: FocusMode | null): number => (mode === "fighter" ? 1 : mode === "spectator" ? SPECTATOR_DIM : 0);

/**
 * One frame of the focus fade. A ring change goes out first (fade to the hall), then in around the new ring.
 * Linear ramps (the driver applies a smoothstep on top); culling only at the dark end.
 */
export function stepFocus(s: FocusState, t: FocusTarget, dt: number): FocusState {
  let { ring, mode, k } = s;
  // a different ring (or mode) wanted while something is in focus: fade out first
  const switching = ring !== null && (t.ring !== ring || t.mode !== mode) && k > 0;
  const goal = switching ? 0 : goalOf(t.mode);
  if (!switching && t.ring) {
    ring = t.ring;
    mode = t.mode;
  }
  if (k < goal) k = Math.min(goal, k + dt / FADE_IN_S);
  else if (k > goal) k = Math.max(goal, k - dt / FADE_OUT_S);
  if (k === 0 && (switching || !t.ring)) {
    ring = t.ring;
    mode = t.mode;
  }
  // cull only at the end of the fade (fighter: all but the ring; spectator: what the fog has fully swallowed);
  // un-cull as soon as the fade turns back (still dark: nothing shows yet)
  const hidden = goal > 0 && k >= goal * CULL_AT;
  if (ring === s.ring && mode === s.mode && k === s.k && hidden === s.hidden) return s;
  return { ring, mode, k, hidden };
}

/** smoothstep of the linear ramp: what the visuals use (eases in and out, no visible start / stop) */
export const eased = (k: number): number => {
  const x = k <= 0 ? 0 : k >= 1 ? 1 : k;
  return x * x * (3 - 2 * x);
};

/** per-frame focus (written by the driver every frame; read it in useFrame, never re-render on it) */
export const focusNow: FocusState & { e: number } = { ...FOCUS_IDLE, e: 0 };

/** React side: changes only when the ring / mode / culling / dim band changes (not every frame) */
interface FightFocusStore {
  ring: RingId | null;
  mode: FocusMode | null;
  /** cull now (the surroundings are black): other hall layers may unmount / hide their heavy parts */
  hidden: boolean;
  /** some darkness is on (k > 0): HUDs switch to the fight */
  dim: boolean;
}
export const useFightFocus = create<FightFocusStore>()(() => ({ ring: null, mode: null, hidden: false, dim: false }));

/** publish a frame's state: the mutable `focusNow` always, the store only when something React cares about changed */
export function publishFocus(s: FocusState): void {
  focusNow.ring = s.ring;
  focusNow.mode = s.mode;
  focusNow.k = s.k;
  focusNow.hidden = s.hidden;
  focusNow.e = eased(s.k);
  const cur = useFightFocus.getState();
  const dim = s.k > 0;
  if (cur.ring !== s.ring || cur.mode !== s.mode || cur.hidden !== s.hidden || cur.dim !== dim)
    useFightFocus.setState({ ring: s.ring, mode: s.mode, hidden: s.hidden, dim });
}

/** is this ring culled right now (another ring than the focus ring, while fully focused)? */
export const ringCulled = (id: RingId, f: Pick<FocusState, "ring" | "hidden" | "mode"> = focusNow): boolean => f.hidden && f.mode === "fighter" && f.ring !== null && f.ring !== id;
/** how far from the focus ring centre things stay drawn once culled (m): the ring itself, or the fog's reach */
export const keepRadius = (mode: FocusMode | null, half: number): number => (mode === "spectator" ? half + SPECTATOR_FOG.far + 1 : half + 1.6);
/** spectator fog (m past the camera's distance to the ring): the neighbours stay, the far hall sinks */
export const SPECTATOR_FOG = { near: 2, far: 16 };
