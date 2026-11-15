/**
 * Time of day at runtime (P2-WLD-19): the shown time, sampled once per frame into `tod` (sun / moon direction, the
 * look, the star-field rotation) that every lit part of the world reads, and a small zustand store for the HUD.
 *
 * Consumers:
 *  - per frame (renderer side): read `tod` (never allocate, never trigger shader recompiles — uniforms only);
 *  - React UI: `useTimeOfDay(s => …)` (label, phase, mode; updated at most a few times a second);
 *  - captures (window views, glass reflections): `onTimePhaseChange(cb)` fires when the phase has SETTLED (no
 *    transition running, the same phase for 1 s), so a preset transition passing through four phases re-captures
 *    once, at the end.
 */
import * as THREE from "three";
import { create } from "zustand";
import { clockLabel, loadChoice, saveChoice, shownTime, targetTime, transitionDone, transitionMs, type Preset, type TodMode, type Transition } from "./clock";
import { computeLook, phaseOf, type Look, type Phase } from "./look";
import { moonPosition, skyDir, sunPosition, worldToEquatorial, type MoonState, type SkyPos } from "./solar";

/**
 * Feature flag: NEXT_PUBLIC_FF_TIME_OF_DAY=1 turns it on, =0 off; unset = on in development, off in production
 * builds. Off, the campus keeps the classic hand-tuned morning (sun 17° up in the east-south-east) and no HUD chip.
 */
export const TOD_ON = process.env.NEXT_PUBLIC_FF_TIME_OF_DAY ? process.env.NEXT_PUBLIC_FF_TIME_OF_DAY === "1" : process.env.NODE_ENV !== "production";

/** The classic morning (P1-WLD-03) shown with the flag off: sun at azimuth 104°, 17° up. */
const CLASSIC_SUN: SkyPos = { el: 17, az: 104 };

/** Lowest elevation the shadow-casting light may take: below it the shadows would streak across the whole campus. */
const MIN_KEY_EL = 6;

export interface TodFrame {
  /** shown time (ms since epoch) */
  t: number;
  sun: SkyPos;
  moon: MoonState;
  rising: boolean;
  /** unit directions towards the sun / moon (world: x east, y up, −z north) */
  sunDir: THREE.Vector3;
  moonDir: THREE.Vector3;
  /** unit direction towards the key (shadow-casting) light: sun or moon, never below MIN_KEY_EL */
  keyDir: THREE.Vector3;
  look: Look;
  /** world direction → equatorial (the star field turns with the sidereal time) */
  starMat: THREE.Matrix3;
  transitioning: boolean;
  /** bumps whenever the sample changes (consumers skip work when it did not) */
  version: number;
  /** bumps when the key light direction moved enough to re-render a throttled shadow map */
  keyVersion: number;
}

function sample(t: number, out?: TodFrame): TodFrame {
  const sun = TOD_ON ? sunPosition(t) : CLASSIC_SUN;
  const rising = TOD_ON ? sunPosition(t + 60_000).el > sun.el : true;
  const moon = TOD_ON ? moonPosition(t) : { el: -30, az: 280, fraction: 0.5, waxing: true, ra: 0, decl: 0 };
  const look = computeLook(sun.el, rising, moon);
  const f: TodFrame = out ?? {
    t,
    sun,
    moon,
    rising,
    sunDir: new THREE.Vector3(),
    moonDir: new THREE.Vector3(),
    keyDir: new THREE.Vector3(),
    look,
    starMat: new THREE.Matrix3(),
    transitioning: false,
    version: 0,
    keyVersion: 0,
  };
  f.t = t;
  f.sun = sun;
  f.moon = moon;
  f.rising = rising;
  f.look = look;
  f.sunDir.fromArray(skyDir(sun));
  f.moonDir.fromArray(skyDir(moon));
  const key = look.keyIsSun ? sun : moon;
  f.keyDir.fromArray(skyDir({ el: Math.max(MIN_KEY_EL, key.el), az: key.az }));
  // throttled consumers (the key light's aim, the aerial shadow map) re-aim only when the light really moved ≥ 0.1°
  // since they last did (≈ every 25 s on the real clock: a sub-texel shadow shift, no swimming)
  if (appliedKey.angleTo(f.keyDir) > 0.0017 || f.keyVersion === 0) {
    appliedKey.copy(f.keyDir);
    f.keyVersion++;
  }
  f.starMat.fromArray(worldToEquatorial(t));
  f.version++;
  return f;
}
const appliedKey = new THREE.Vector3(0, 1, 0);

/* ---------------------------------------------------------------- state ---------------------------------------------------------------- */

const storage = (): Storage | null => {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
};

const saved = typeof window !== "undefined" && TOD_ON ? loadChoice(storage()) : { mode: "now" as TodMode };
let mode: TodMode = saved.mode;
let customMin = saved.minutes ?? 12 * 60;
/** fixed shown time while a preset / custom time is chosen (null: following the real clock) */
let fixed: number | null = mode === "now" ? null : targetTime(mode, Date.now(), Date.now(), customMin);
let tr: Transition | null = null;
let xr = false;

/** The per-frame sample (read it in useFrame; it is updated by `stepTimeOfDay`). */
export const tod: TodFrame = sample(fixed ?? Date.now());

interface TodUi {
  mode: TodMode;
  /** "21:00" */
  label: string;
  phase: Phase;
  /** the phase once settled (captures follow this one) */
  settledPhase: Phase;
  transitioning: boolean;
}
export const useTimeOfDay = create<TodUi>(() => ({
  mode,
  label: clockLabel(tod.t),
  phase: tod.look.phase,
  settledPhase: tod.look.phase,
  transitioning: false,
}));

/** Choose a mode (HUD menu): animates from the shown time unless `instant`. Remembered on this device. */
export function chooseTime(next: TodMode, opts: { instant?: boolean; minutes?: number } = {}) {
  if (!TOD_ON) return;
  const now = Date.now();
  if (next === "custom" && opts.minutes != null) customMin = ((opts.minutes % 1440) + 1440) % 1440;
  const to = next === "now" ? null : targetTime(next, now, tod.t, customMin);
  mode = next;
  fixed = to;
  tr = opts.instant ? null : { from: tod.t, to, start: performance.now(), dur: transitionMs(xr) };
  if (opts.instant) sample(to ?? now, tod);
  saveChoice(storage(), next === "custom" ? { mode: next, minutes: customMin } : { mode: next });
  useTimeOfDay.setState({ mode: next });
}

let lastUi = 0;
let lastSample = 0;
let phaseSince = 0;

/**
 * Advance the clock (once per rendered frame, world/time-of-day/TimeOfDay.tsx). Re-samples every frame while a
 * transition runs, otherwise once a second (the real clock moves 0.004° of sun per second).
 */
export function stepTimeOfDay(perf: number, inXR: boolean) {
  xr = inXR;
  if (!TOD_ON) return;
  const now = Date.now();
  const running = !!tr && !transitionDone(tr, perf);
  if (tr && !running) {
    tr = null; // arrived: hold the preset, or follow the clock
  }
  if (running || perf - lastSample > 1000 || tod.transitioning !== running) {
    lastSample = perf;
    sample(running ? shownTime(tr, now, perf, 0) : (fixed ?? now), tod);
    tod.transitioning = running;
  }
  if (perf - lastUi > 250) {
    lastUi = perf;
    const s = useTimeOfDay.getState();
    const label = clockLabel(tod.t);
    const phase = tod.look.phase;
    if (phase !== s.phase) phaseSince = perf;
    const settle = !running && phase !== s.settledPhase && perf - phaseSince > 1000;
    if (label !== s.label || phase !== s.phase || running !== s.transitioning || settle)
      useTimeOfDay.setState({ label, phase, transitioning: running, ...(settle ? { settledPhase: phase } : {}) });
  }
}

/** Called with the new phase whenever the settled phase changes (returns the unsubscribe function). */
export function onTimePhaseChange(cb: (phase: Phase) => void): () => void {
  return useTimeOfDay.subscribe((s, p) => {
    if (s.settledPhase !== p.settledPhase) cb(s.settledPhase);
  });
}

/** Phase of an arbitrary shown time (tests, captures). */
export const phaseAt = (t: number) => {
  const s = sunPosition(t);
  return phaseOf(s.el, sunPosition(t + 60_000).el > s.el);
};

/** The scrubber (testing): shown in development builds, or with ?tod=1 in the address. */
export const scrubberOn = () => {
  if (!TOD_ON || typeof window === "undefined") return false;
  if (process.env.NODE_ENV !== "production") return true;
  try {
    return new URLSearchParams(location.search).get("tod") === "1";
  } catch {
    return false;
  }
};

// dev-only hook for visual QA (like __gkCam): pin a time, run a preset, read the state
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production" && TOD_ON)
  (window as unknown as Record<string, unknown>).__gkTod = {
    pin: (minutes: number, instant = true) => chooseTime("custom", { minutes, instant }),
    preset: (p: Preset | "now", instant = false) => chooseTime(p, { instant }),
    state: () => ({ mode, label: clockLabel(tod.t), phase: tod.look.phase, sunEl: +tod.sun.el.toFixed(2), moon: +tod.moon.fraction.toFixed(2), lights: +tod.look.lights.toFixed(2), transitioning: tod.transitioning }),
  };
