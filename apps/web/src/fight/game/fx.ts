"use client";
import type { FightEvent } from "@gukirana/contracts";
import { uiAudio } from "@/lib/audio";
import { useFightPrefs } from "./prefs";

/**
 * Fight sounds + haptics, played on (server or local-engine) events only — never on a predicted hit (plan §3.3).
 * Short synthesized sounds (no audio assets); vibration ≤ 3 pulses/s.
 *
 * Calm by design (P3-FGT-04): hits are soft low thumps (a sine that drops in pitch), not square-wave beeps; every kind
 * of sound has a minimum gap (a flurry of blocks is one tap, the referee's count is one tick per second) and the whole
 * mix stays quiet under the hall's own sound. The bell is the only bright sound.
 */
function tone(freq: number, ms: number, opts: { type?: OscillatorType; gain?: number; drop?: number } = {}): void {
  const ctx = uiAudio();
  if (!ctx) return;
  const { type = "sine", gain = 0.08, drop = 1 } = opts;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  const t = ctx.currentTime;
  const end = t + ms / 1000;
  o.frequency.setValueAtTime(freq, t);
  if (drop !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * drop), end);
  // a 6 ms attack (no click) and an exponential tail
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(end + 0.02);
}

/** minimum gap between two sounds of the same kind (ms) */
const GAP: Partial<Record<FightEvent["k"], number>> = { hit: 110, block: 160, count: 700, warning: 900, knockdown: 1500, bell: 1200, roundEnd: 1200, over: 2000 };
const lastAt: Partial<Record<FightEvent["k"], number>> = {};
const due = (k: FightEvent["k"]) => {
  const now = typeof performance !== "undefined" ? performance.now() : 0;
  if (now - (lastAt[k] ?? -1e9) < (GAP[k] ?? 0)) return false;
  lastAt[k] = now;
  return true;
};

let lastBuzz = 0;
function buzz(ms: number): void {
  const now = typeof performance !== "undefined" ? performance.now() : 0;
  if (now - lastBuzz < 340 || typeof navigator === "undefined" || !navigator.vibrate) return;
  lastBuzz = now;
  navigator.vibrate(ms);
}

/** play the feedback of one event for the local fighter `me` */
export function eventFx(e: FightEvent, me: 0 | 1): void {
  const { sound, vibration } = useFightPrefs.getState();
  const mine = "by" in e ? e.by === me : "to" in e ? e.to === me : false;
  if (!due(e.k)) return;
  switch (e.k) {
    case "bell":
    case "roundEnd":
      if (sound) {
        tone(1320, 600, { gain: 0.12 });
        tone(1980, 420, { gain: 0.04 });
      }
      break;
    case "hit":
      if (sound) tone(mine ? 150 : 110, 140, { gain: mine ? 0.1 : 0.13, drop: 0.55 });
      if (vibration) buzz(mine ? 18 : 35);
      break;
    case "block":
      if (sound) tone(260, 70, { type: "triangle", gain: 0.05, drop: 0.7 });
      if (vibration && !mine) buzz(12);
      break;
    case "knockdown":
      if (sound) tone(90, 450, { gain: 0.12, drop: 0.6 });
      if (vibration) buzz(60);
      break;
    case "count":
      if (sound) tone(620, 80, { gain: 0.05 });
      break;
    case "warning":
      if (sound && mine) tone(330, 220, { gain: 0.07 });
      break;
    case "over":
      if (sound) tone(990, 800, { gain: 0.1 });
      break;
    default:
      break;
  }
}
