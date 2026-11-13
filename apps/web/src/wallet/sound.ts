"use client";
import { uiAudio } from "@/lib/audio";
import { useGamePrefs } from "@/games/feedback";

/**
 * Soft, short wallet sounds (WebAudio, no files). Silent until the first user gesture (browser autoplay policy) and
 * when sounds are off in the game settings. Quiet on purpose: feedback, never celebration.
 */
function tone(f: number, d: number, v: number, type: OscillatorType = "sine", at = 0, to?: number) {
  if (!useGamePrefs.getState().sound) return;
  const ctx = uiAudio();
  if (!ctx) return;
  const t = ctx.currentTime + 0.004 + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + d + 0.02);
}

export const wsound = {
  /** a leather / card button press */
  click: () => tone(420, 0.05, 0.05, "triangle", 0, 260),
  /** a keypad key */
  key: () => tone(880, 0.035, 0.035, "sine"),
  /** a card sliding out of / back into a slot */
  slide: () => tone(240, 0.12, 0.03, "sine", 0, 520),
  /** tokens landing in the Stars pocket (three soft taps) */
  tokens: () => {
    tone(1180, 0.07, 0.04, "sine", 0.18);
    tone(1320, 0.07, 0.04, "sine", 0.3);
    tone(1480, 0.09, 0.04, "sine", 0.42);
  },
};
