/**
 * The time-of-day clock (P2-WLD-19): which time the campus shows, and the eased transition between two times.
 * Pure logic (unit tested); world/time-of-day/store.ts wires it to React / storage and the renderer.
 *
 * Per player, client side only: it changes nothing on the server, in any game or in the economy.
 *  - "now"     the real Kigali clock (Africa/Kigali, UTC+2), advancing in real time (the default);
 *  - presets   Morning 08:00, Midday 12:30, Sunset (today's sunset, ≈ 17:50–18:20 through the year), Night 21:00 —
 *              frozen at that time while chosen;
 *  - "custom"  any minute (the testing scrubber: dev builds, or ?tod=1).
 * A change of mode never cuts: the shown time runs from where it is to the new time (the short way round the clock)
 * over ~3.5 s with a quintic ease, so the sky, the sun, the shadows and the lights pass through the real
 * intermediate states (midday → night goes through golden hour, sunset and twilight).
 */
import { kigaliMinutes, kigaliTime, sunCrossing } from "./solar";

export type Preset = "morning" | "midday" | "sunset" | "night";
export type TodMode = "now" | Preset | "custom";
export const PRESETS: Preset[] = ["morning", "midday", "sunset", "night"];
export const MODES: TodMode[] = ["now", ...PRESETS];

/** Fixed preset clock times (Kigali minutes); Sunset is computed per date (see presetMinutes). */
export const PRESET_MIN: Record<Exclude<Preset, "sunset">, number> = {
  morning: 8 * 60,
  midday: 12 * 60 + 30,
  night: 21 * 60,
};
/** the Sunset preset: the sun's disc just touching the horizon (upper limb ≈ +0.3° above it), a few minutes before sunset */
export const SUNSET_LEAD_MIN = 3;

const DAY = 86_400_000;
const HALF = DAY / 2;

/** Kigali clock minute of a preset on the Kigali day of `dayOf`. */
export function presetMinutes(p: Preset, dayOf: number): number {
  if (p !== "sunset") return PRESET_MIN[p];
  const s = sunCrossing(dayOf, false);
  return (s ?? 18 * 60 + 5) - SUNSET_LEAD_MIN;
}

/** The time a mode shows, as a timestamp, for the real clock `now`. Fixed times land on the day nearest to `near`. */
export function targetTime(mode: TodMode, now: number, near: number, customMin = 12 * 60): number {
  if (mode === "now") return now;
  const min = mode === "custom" ? customMin : presetMinutes(mode, near);
  return nearestDay(kigaliTime(near, min), near);
}

/** The same clock time, moved by whole days to within ±12 h of `near` (the short way round the clock). */
export function nearestDay(t: number, near: number): number {
  let d = t - near;
  d = ((((d + HALF) % DAY) + DAY) % DAY) - HALF;
  return near + d;
}

/** Quintic smootherstep: zero velocity AND acceleration at both ends (gentle start / stop, no visible snap). */
export const ease = (k: number) => {
  const t = Math.min(1, Math.max(0, k));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** Transition length (ms): 3.5 s on a screen, 5 s in a headset (brightness changes must be slow there). */
export const transitionMs = (xr: boolean) => (xr ? 5000 : 3500);

export interface Transition {
  from: number;
  /** fixed target timestamp, or null to follow the real clock (mode "now") */
  to: number | null;
  start: number;
  dur: number;
}

/** Shown timestamp at real time `now` (`perf` = the monotonic clock the transition started on). */
export function shownTime(tr: Transition | null, now: number, perf: number, steady: number): number {
  if (!tr) return steady;
  const k = (perf - tr.start) / tr.dur;
  const to = tr.to ?? now;
  // following the clock: the target keeps moving, so pick the near day each time (crossing midnight stays smooth)
  const end = tr.to == null ? nearestDay(to, tr.from) : to;
  return tr.from + (end - tr.from) * ease(k);
}

export const transitionDone = (tr: Transition | null, perf: number) => !tr || perf - tr.start >= tr.dur;

/* ---------------------------------------------------------------- storage ---------------------------------------------------------------- */

export const STORAGE_KEY = "gk.timeOfDay";
export interface Saved {
  mode: TodMode;
  minutes?: number;
}

/** Read the device's choice; any failure (private mode, blocked storage, bad JSON) → "now". */
export function loadChoice(storage: Pick<Storage, "getItem"> | null | undefined): Saved {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return { mode: "now" };
    const v = JSON.parse(raw) as Partial<Saved>;
    if (v && typeof v.mode === "string" && ([...MODES, "custom"] as string[]).includes(v.mode)) {
      const minutes =
        typeof v.minutes === "number" && Number.isFinite(v.minutes)
          ? ((v.minutes % 1440) + 1440) % 1440
          : undefined;
      return v.mode === "custom" ? { mode: "custom", minutes: minutes ?? 12 * 60 } : { mode: v.mode };
    }
  } catch {
    /* storage unavailable: the default */
  }
  return { mode: "now" };
}

/** Remember the choice; storage failures are ignored (the choice still applies for this visit). */
export function saveChoice(storage: Pick<Storage, "setItem"> | null | undefined, s: Saved): boolean {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(s));
    return !!storage;
  } catch {
    return false;
  }
}

/** "21:00" for a timestamp on the Kigali clock. */
export function clockLabel(t: number): string {
  const m = Math.floor(kigaliMinutes(t));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
