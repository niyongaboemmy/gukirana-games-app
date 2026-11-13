"use client";
import { uiAudio } from "@/lib/audio";

/**
 * Footstep sounds, synthesised (no samples): a short filtered noise burst per foot plant — a heel "tock" (low
 * band-passed thump) plus a soft scuff (higher band) — shaped per surface, quieter and brushed for steps while
 * turning on the spot, heavier for running. Slight seeded level / pitch variation per step so a walk never sounds
 * like a loop. Distance-attenuated; at most MAX_VOICES people make steps at a time (the nearest, see `claim`).
 */
export type Surface = "stone" | "plank" | "herringbone" | "terracotta";

const SURFACE: Record<Surface, { thump: number; scuff: number; q: number; decay: number; gain: number }> = {
  // lava-stone / concrete paving: dry, bright click with little body
  stone: { thump: 210, scuff: 2600, q: 1.1, decay: 0.07, gain: 0.9 },
  // pool hall timber planks: hollow, warmer knock
  plank: { thump: 150, scuff: 1500, q: 2.2, decay: 0.11, gain: 1.0 },
  // ludo lounge herringbone parquet: tighter wood tap
  herringbone: { thump: 180, scuff: 1900, q: 1.8, decay: 0.09, gain: 0.95 },
  // igisoro court terracotta tiles: hard, mid click
  terracotta: { thump: 240, scuff: 2200, q: 1.4, decay: 0.08, gain: 0.85 },
};

let surfaceOverride: Surface | null = null;
/** Force a floor (otherwise: plaza stone; each hall its own floor, from the route). */
export function setFootSurface(s: Surface | null) {
  surfaceOverride = s;
}
export function footSurfaceFor(path: string | null | undefined): Surface {
  if (!path?.startsWith("/room/")) return "stone";
  if (path.includes("pool")) return "plank";
  if (path.includes("ludo")) return "herringbone";
  if (path.includes("igisoro")) return "terracotta";
  return "stone";
}

let noise: AudioBuffer | null = null;
let master: GainNode | null = null;
function bus(ctx: AudioContext) {
  if (!noise || noise.sampleRate !== ctx.sampleRate) {
    const n = Math.floor(ctx.sampleRate * 0.25);
    noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noise.getChannelData(0);
    // deterministic white noise (LCG): no Math.random needed, sounds the same
    let x = 1234567;
    for (let i = 0; i < n; i++) {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      d[i] = (x / 4294967296) * 2 - 1;
    }
  }
  if (!master || master.context !== ctx) {
    master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);
  }
  return { noise, master };
}

/** Voice budget per frame window: the nearest people only. */
export const MAX_VOICES = 8;
let windowStart = 0;
let used = 0;
const RANGE = 14;

let seq = 0;
/**
 * One foot plant. `dist` = metres from the listener (camera / own avatar), `pan` = −1 left … 1 right,
 * `kind` 0 walk · 1 run · 2 brushed turn step, `level` 0..1, `seed` per person.
 */
export function footstep(dist: number, pan: number, kind: 0 | 1 | 2, level: number, seed: number) {
  if (dist > RANGE) return;
  const now = performance.now();
  if (now - windowStart > 250) {
    windowStart = now;
    used = 0;
  }
  if (used >= MAX_VOICES) return;
  const ctx = uiAudio();
  if (!ctx || ctx.state !== "running") return;
  used++;
  // dev-only counter for automated QA (footsteps can't be heard in a headless browser)
  if (process.env.NODE_ENV !== "production") (window as unknown as { __gkSteps?: number }).__gkSteps = ((window as unknown as { __gkSteps?: number }).__gkSteps ?? 0) + 1;
  const { noise: buf, master: out } = bus(ctx);
  const s = SURFACE[surfaceOverride ?? footSurfaceFor(window.location.pathname)];
  const h = ((seed ^ Math.imul(++seq, 2654435761)) >>> 0) / 4294967296; // per-step variation 0..1
  const att = Math.max(0, 1 - dist / RANGE) ** 1.6 / (1 + dist * 0.25);
  const lvl = att * s.gain * (kind === 1 ? 1.25 : kind === 2 ? 0.35 : 0.75) * (0.85 + h * 0.3) * Math.min(1, 0.4 + level);
  if (lvl < 0.004) return;
  const t0 = ctx.currentTime + 0.005;
  const pitch = 0.92 + h * 0.16;
  const panner = ctx.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, pan)) * 0.7;
  panner.connect(out);
  // heel thump
  if (kind !== 2) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = pitch;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = s.thump * pitch * (kind === 1 ? 0.9 : 1);
    bp.Q.value = s.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(lvl * 1.6, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + s.decay * (kind === 1 ? 1.2 : 1));
    src.connect(bp).connect(g).connect(panner);
    src.start(t0, h * 0.1, s.decay + 0.05);
  }
  // sole scuff (the only part of a brushed turn step)
  const sc = ctx.createBufferSource();
  sc.buffer = buf;
  const hp = ctx.createBiquadFilter();
  hp.type = "bandpass";
  hp.frequency.value = s.scuff * pitch;
  hp.Q.value = 0.8;
  const g2 = ctx.createGain();
  const start = t0 + (kind === 2 ? 0 : 0.012);
  const len = kind === 2 ? 0.12 : 0.06;
  g2.gain.setValueAtTime(0, start);
  g2.gain.linearRampToValueAtTime(lvl * (kind === 2 ? 0.7 : 0.35), start + (kind === 2 ? 0.04 : 0.006));
  g2.gain.exponentialRampToValueAtTime(0.0004, start + len);
  sc.connect(hp).connect(g2).connect(panner);
  sc.start(start, 0.1 + h * 0.1, len + 0.03);
  sc.onended = () => panner.disconnect();
}
