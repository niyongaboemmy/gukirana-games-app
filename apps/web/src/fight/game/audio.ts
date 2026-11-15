"use client";
import { uiAudio } from "@/lib/audio";
import { useFightPrefs } from "./prefs";

/**
 * Fight sound (P3-FGT-05): synthesized, no assets, varied but never random (variation comes from the event's tick):
 *  - punches: a low body thump + filtered noise slap, pitch / brightness by punch and power; blocks are a drier glove
 *    slap; whiffs a soft whoosh;
 *  - the bell: an inharmonic struck-metal partial set with a long decay (one ring to box, three to end a round);
 *  - the crowd: a quiet murmur bed that swells on big hits, an "ooh" on a knockdown, a cheer at the end;
 *  - voices: the referee's count and calls and the corner's advice through speech synthesis (captions always shown).
 * Volume is kept low and nothing repeats like a beep.
 */
let noiseBuf: AudioBuffer | null = null;
function noise(ctx: AudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const len = ctx.sampleRate * 2;
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  // deterministic white noise (LCG): no Math.random anywhere near a fight
  let x = 22695477;
  for (let i = 0; i < len; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    d[i] = (x / 4294967296) * 2 - 1;
  }
  noiseBuf = b;
  return b;
}

const ok = () => useFightPrefs.getState().sound;
let master: GainNode | null = null;
function out(ctx: AudioContext): GainNode {
  if (master && master.context === ctx) return master;
  master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);
  return master;
}

/** 0..1 variation from a tick (stable per event) */
const vary = (seed: number, k = 1) => (((Math.imul(seed + 7919 * k, 2654435761) >>> 0) % 1000) / 1000);

export function punchSound(kind: "jab" | "cross" | "hook" | "uppercut", landed: "hit" | "block" | "whiff", seed: number, near = true): void {
  const ctx = uiAudio();
  if (!ctx || !ok()) return;
  const t = ctx.currentTime;
  const power = kind === "jab" ? 0.5 : kind === "cross" ? 0.75 : 1;
  const v = vary(seed);
  const gain = (near ? 1 : 0.6) * (landed === "whiff" ? 0.05 : landed === "block" ? 0.12 : 0.1 + 0.12 * power);
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const f = ctx.createBiquadFilter();
  const g = ctx.createGain();
  if (landed === "whiff") {
    f.type = "bandpass";
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(500 + 300 * v, t);
    f.frequency.exponentialRampToValueAtTime(1500 + 500 * v, t + 0.16);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  } else {
    f.type = landed === "block" ? "bandpass" : "lowpass";
    f.Q.value = landed === "block" ? 2.2 : 0.8;
    f.frequency.value = landed === "block" ? 1300 + 500 * v : 700 + 900 * (1 - power) + 400 * v;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (landed === "block" ? 0.07 : 0.12 + 0.05 * power));
  }
  src.connect(f).connect(g).connect(out(ctx));
  src.start(t, v * 1.5, 0.3);
  if (landed === "hit") {
    // the body of the impact: a short falling sine
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(120 - 30 * power + 15 * v, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.14);
    og.gain.setValueAtTime(0.16 * power * (near ? 1 : 0.6), t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(og).connect(out(ctx));
    o.start(t);
    o.stop(t + 0.2);
  }
}

/** a struck boxing bell: `n` rings (1 = box, 3 = end of the round) */
export function bell(n = 1): void {
  const ctx = uiAudio();
  if (!ctx || !ok()) return;
  const base = 820;
  const partials: [number, number][] = [
    [1, 0.16],
    [2.76, 0.07],
    [5.4, 0.035],
    [8.93, 0.02],
  ];
  for (let k = 0; k < n; k++) {
    const t = ctx.currentTime + k * 0.32;
    for (const [m, a] of partials) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = base * m;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(a, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (n > 1 ? 0.9 : 2.2) / Math.sqrt(m));
      o.connect(g).connect(out(ctx));
      o.start(t);
      o.stop(t + 2.4);
    }
  }
}

/* ------------------------------------------------------------ crowd ------------------------------------------------------------ */

let crowd: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
const CROWD_BED = 0.022;
export function crowdStart(): void {
  const ctx = uiAudio();
  if (!ctx || crowd || !ok() || !useFightPrefs.getState().crowd) return;
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 650;
  filter.Q.value = 0.7;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(CROWD_BED, ctx.currentTime + 1.5);
  src.connect(filter).connect(gain).connect(out(ctx));
  src.start();
  crowd = { src, gain, filter };
}
export function crowdStop(): void {
  const ctx = uiAudio();
  if (!crowd || !ctx) return;
  const c = crowd;
  crowd = null;
  c.gain.gain.cancelScheduledValues(ctx.currentTime);
  c.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3);
  c.src.stop(ctx.currentTime + 1.2);
}
/** a swell of the crowd: "ooh" (a falling vowel-ish band), "roar" (big hit), "cheer" (the end) */
export function crowdReact(kind: "roar" | "ooh" | "cheer"): void {
  const ctx = uiAudio();
  if (!ctx || !crowd) return;
  const t = ctx.currentTime;
  const peak = kind === "cheer" ? 0.11 : kind === "ooh" ? 0.09 : 0.06;
  const dur = kind === "cheer" ? 3.5 : kind === "ooh" ? 1.6 : 1.1;
  const g = crowd.gain.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(Math.max(0.0001, g.value), t);
  g.exponentialRampToValueAtTime(peak, t + 0.18);
  g.exponentialRampToValueAtTime(CROWD_BED, t + dur);
  const f = crowd.filter.frequency;
  f.cancelScheduledValues(t);
  f.setValueAtTime(kind === "ooh" ? 900 : 650, t);
  f.exponentialRampToValueAtTime(kind === "ooh" ? 380 : kind === "cheer" ? 1100 : 800, t + dur * 0.6);
  f.exponentialRampToValueAtTime(650, t + dur);
}

/* ------------------------------------------------------------ voices ------------------------------------------------------------ */

/** speak a line (referee / corner) when voices are on; captions are the HUD's job (always shown) */
export function say(text: string, who: "referee" | "corner"): void {
  if (!ok() || !useFightPrefs.getState().voice || typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = who === "referee" ? 1.05 : 1.12;
    u.pitch = who === "referee" ? 0.8 : 1.05;
    u.volume = who === "referee" ? 0.9 : 0.6;
    if (who === "referee") window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    /* speech is optional */
  }
}
export function hushVoices(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

/* ------------------------------------------------------------ haptics ------------------------------------------------------------ */

let lastBuzz = 0;
/** phone vibration (≤ 3 pulses / s) + gamepad rumble where supported */
export function buzz(ms: number, strength = 0.6): void {
  if (!useFightPrefs.getState().vibration || typeof navigator === "undefined") return;
  const now = performance.now();
  if (now - lastBuzz < 300) return;
  lastBuzz = now;
  if (navigator.vibrate) navigator.vibrate(ms);
  for (const p of navigator.getGamepads?.() ?? []) {
    const act = (p as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } }) | null)?.vibrationActuator;
    act?.playEffect?.("dual-rumble", { duration: ms * 2, strongMagnitude: strength, weakMagnitude: strength * 0.6 })?.catch(() => {});
  }
}
