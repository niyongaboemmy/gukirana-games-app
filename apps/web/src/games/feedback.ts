"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { uiAudio } from "@/lib/audio";

/** Game-screen preferences (per device): sounds, vibration, auto-move, aim guide, AI level, seen tips. */
interface GamePrefs {
  sound: boolean;
  haptics: boolean;
  autoMove: boolean;
  fullGuide: boolean;
  aiLevel: 1 | 3 | 5;
  seen: Record<string, boolean>;
  set: (p: Partial<Omit<GamePrefs, "set" | "markSeen">>) => void;
  markSeen: (game: string) => void;
}

export const useGamePrefs = create<GamePrefs>()(
  persist(
    (set) => ({
      sound: true,
      haptics: true,
      autoMove: true,
      fullGuide: true,
      aiLevel: 3,
      seen: {},
      set: (p) => set(p),
      markSeen: (game) => set((s) => ({ seen: { ...s.seen, [game]: true } })),
    }),
    { name: "gk-game-prefs" },
  ),
);

export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Short vibration on phones (ignored where unsupported, or when the player turned it off). */
export function haptic(pattern: number | number[]) {
  if (!useGamePrefs.getState().haptics || typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  // touch devices only, and only after the first tap (Chrome blocks and logs vibrate() before a gesture)
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if ((activation && !activation.hasBeenActive) || !window.matchMedia("(pointer: coarse)").matches) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* not allowed before a gesture */
  }
}

type Tone = { f: number; to?: number; d: number; type?: OscillatorType; v?: number; at?: number };

function play(tones: Tone[]) {
  if (!useGamePrefs.getState().sound) return;
  const ctx = uiAudio(); // null until the first user gesture (browser autoplay policy)
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.005;
  for (const tn of tones) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = tn.type ?? "sine";
    const start = t0 + (tn.at ?? 0);
    o.frequency.setValueAtTime(tn.f, start);
    if (tn.to) o.frequency.exponentialRampToValueAtTime(tn.to, start + tn.d);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(tn.v ?? 0.08, start + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, start + tn.d);
    o.connect(g).connect(ctx.destination);
    o.start(start);
    o.stop(start + tn.d + 0.02);
  }
}

/** Filtered noise burst (dice rattle, ball clack, seeds). */
function noise(d: number, freq: number, v = 0.12, at = 0) {
  if (!useGamePrefs.getState().sound) return;
  const ctx = uiAudio();
  if (!ctx) return;
  const len = Math.max(1, Math.floor(ctx.sampleRate * d));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  // cosmetic noise from a fixed LCG (no Math.random anywhere near game code)
  let x = 12345;
  for (let i = 0; i < len; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    data[i] = ((x / 0x7fffffff) * 2 - 1) * (1 - i / len);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = freq;
  bp.Q.value = 1.4;
  const g = ctx.createGain();
  g.gain.value = v;
  src.connect(bp).connect(g).connect(ctx.destination);
  src.start(ctx.currentTime + at);
}

/** Subtle synthesized game sounds (WebAudio, only after a user gesture, muted in the game menu). */
export const sfx = {
  tap: () => play([{ f: 660, d: 0.05, type: "triangle", v: 0.04 }]),
  yourTurn: () => play([{ f: 523, d: 0.12, v: 0.05 }, { f: 784, d: 0.18, v: 0.05, at: 0.1 }]),
  cue: (power: number) => noise(0.06, 900 + power * 1400, 0.1 + power * 0.18),
  clack: (v = 0.5) => noise(0.03, 2600, 0.05 + v * 0.12),
  pocket: () => {
    noise(0.12, 380, 0.16);
    play([{ f: 180, to: 90, d: 0.16, v: 0.06 }]);
  },
  foul: () => play([{ f: 330, to: 220, d: 0.28, type: "sawtooth", v: 0.035 }]),
  dice: () => {
    for (let i = 0; i < 6; i++) noise(0.035, 1500 + i * 120, 0.08, i * 0.07);
  },
  step: () => play([{ f: 440, d: 0.04, type: "triangle", v: 0.035 }]),
  capture: () => play([{ f: 880, to: 440, d: 0.22, type: "square", v: 0.03 }, { f: 220, d: 0.2, v: 0.05, at: 0.05 }]),
  seed: () => noise(0.025, 3200, 0.05),
  win: () => play([{ f: 523, d: 0.14, v: 0.06 }, { f: 659, d: 0.14, v: 0.06, at: 0.12 }, { f: 784, d: 0.3, v: 0.06, at: 0.24 }]),
  lose: () => play([{ f: 392, d: 0.18, v: 0.05 }, { f: 330, d: 0.3, v: 0.05, at: 0.16 }]),
};
