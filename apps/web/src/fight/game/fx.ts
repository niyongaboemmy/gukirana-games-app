"use client";
import type { FightEvent } from "@gukirana/contracts";
import { uiAudio } from "@/lib/audio";
import { useFightPrefs } from "./prefs";

/**
 * Fight sounds + haptics, played on (server or local-engine) events only — never on a predicted hit (plan §3.3).
 * Short synthesized blips (no audio assets); vibration ≤ 3 pulses/s.
 */
function blip(freq: number, ms: number, type: OscillatorType = "triangle", gain = 0.18): void {
  const ctx = uiAudio();
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = ctx.currentTime;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + ms / 1000 + 0.02);
}

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
  switch (e.k) {
    case "bell":
    case "roundEnd":
      if (sound) {
        blip(1320, 500, "sine", 0.22);
        blip(1980, 380, "sine", 0.08);
      }
      break;
    case "hit":
      if (sound) blip(mine ? 160 : 110, 120, "square", 0.12);
      if (vibration) buzz(mine ? 18 : 35);
      break;
    case "block":
      if (sound) blip(420, 60, "triangle", 0.1);
      if (vibration && !mine) buzz(12);
      break;
    case "knockdown":
      if (sound) blip(90, 400, "sawtooth", 0.1);
      if (vibration) buzz(60);
      break;
    case "count":
      if (sound) blip(700, 90, "sine", 0.1);
      break;
    case "warning":
      if (sound && mine) blip(300, 200, "sine", 0.12);
      break;
    case "over":
      if (sound) blip(990, 700, "sine", 0.2);
      break;
    default:
      break;
  }
}
