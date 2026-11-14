"use client";
import { uiAudio } from "@/lib/audio";

/**
 * Arena sound (P2-ARN-04): a soft crowd bed whose level follows the REAL number of people inside, a swell when
 * people really react (cheer / clap / wave), and a two-tone PA chime before announcements. Generated noise (no
 * recorded crowd), so an empty arena is quiet. Starts only after the first user gesture (browser rule).
 */
let crowd: { gain: GainNode; swell: GainNode } | null = null;

function noise(ctx: AudioContext) {
  // deterministic noise (no Math.random): a cheap hash per sample
  const len = ctx.sampleRate * 3;
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  let s = 1234567;
  for (let i = 0; i < len; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    d[i] = (s / 0x7fffffff) * 2 - 1;
  }
  return b;
}

function ensureCrowd() {
  if (crowd) return crowd;
  const ctx = uiAudio();
  if (!ctx) return null;
  const buf = noise(ctx);
  const make = (lo: number, hi: number) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = (lo + hi) / 2;
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(bp).connect(g).connect(ctx.destination);
    src.start();
    return g;
  };
  crowd = { gain: make(250, 900), swell: make(600, 2400) };
  return crowd;
}

/** Set the crowd levels (0 … 1); `on` false fades out (arena off screen). */
export function setCrowd(bed: number, swell: number, on: boolean) {
  const c = on ? ensureCrowd() : crowd;
  const ctx = uiAudio();
  if (!c || !ctx) return;
  c.gain.gain.setTargetAtTime(on ? bed * 0.18 : 0, ctx.currentTime, 0.8);
  c.swell.gain.setTargetAtTime(on ? swell * 0.22 : 0, ctx.currentTime, swell > 0.05 ? 0.25 : 1.2);
}

/** Two-tone PA chime (E5 → C5), soft. */
export function paChime() {
  const ctx = uiAudio();
  if (!ctx) return;
  const t = ctx.currentTime;
  for (const [f, at] of [
    [659.25, 0],
    [523.25, 0.42],
  ] as [number, number][]) {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t + at);
    g.gain.linearRampToValueAtTime(0.08, t + at + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0008, t + at + 1.2);
    o.connect(g).connect(ctx.destination);
    o.start(t + at);
    o.stop(t + at + 1.3);
  }
}
