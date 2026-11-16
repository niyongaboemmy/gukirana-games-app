/**
 * Night light show timing (P2-WLD-21, docs/NIGHT-LIGHTING.md §4): the pure maths behind every animated night light —
 * the Tournament Arena's rising waves and lozenge sequence, the breathing roof line, the Fight Games red / blue pulse,
 * the construction beacons — and the photocell thresholds that switch the campus on at dusk.
 *
 * The same functions run on the GPU: `SHOW_GLSL` is generated from the constants below, so the shaders and the unit
 * tests agree. Everything animated is slow and eased (sine-shaped, never a step): the fastest light on the campus
 * changes at 0.5 Hz, far below the 3 flashes per second limit of WCAG 2.3.1 / Harding; the amplitude never swings the
 * whole field of view. Reduced motion and the Lite tier hold the static warm state (amplitude 0).
 */

/** WCAG 2.3.1 general flash threshold: no more than three flashes in any one second. */
export const PHOTO_SAFE_HZ = 3;

/** Periods (seconds) of every animated light. All divide SHOW_WRAP: the show clock wraps without a visible jump. */
export const SHOW = {
  /** arena: warm light rising through the perforated bronze screen */
  arenaWave: 12,
  /** arena: the Imigongo lozenges lighting one after another round the drum */
  lozenges: 20,
  /** arena: the roof-edge amber line breathing */
  breathe: 7,
  /** Fight Games: red and blue light lines trading places */
  fightPulse: 8,
  /** construction sites: soft safety beacons */
  beacon: 2,
  /** cafe string lights: a very faint shimmer */
  shimmer: 10,
} as const;
export type ShowKey = keyof typeof SHOW;
/** the show clock wraps here (seconds): a common multiple of every period (keeps shader float time precise) */
export const SHOW_WRAP = 840;

/** Animation modes of the instanced night fixtures (pools, halos, washes): the `anim` attribute. */
export const ANIM = { static: 0, breathe: 1, wave: 2, pulse: 3, beacon: 4, shimmer: 5 } as const;
export type Anim = (typeof ANIM)[keyof typeof ANIM];

const TAU = Math.PI * 2;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const fract = (x: number) => x - Math.floor(x);

/** 0 → 1 → 0 once per period, sine-eased (zero slope at both ends) */
export const breath = (t: number, period: number) => 0.5 - 0.5 * Math.cos((TAU * t) / period);
/** a soft band travelling along x (0…1 = one period of space), once per `period` at any fixed point */
export const wave = (t: number, x: number, period: number) => {
  const c = 0.5 + 0.5 * Math.cos(TAU * (t / period - x));
  return c * c;
};
/** one gentle swell per period: 25 % rise, 35 % fall, rest — the lozenge sequence and the beacons */
export const swell = (f: number) => {
  const x = fract(f);
  return smoothstep(0, 0.25, x) * (1 - smoothstep(0.25, 0.6, x));
};

/**
 * Brightness multiplier of an instanced fixture (`anim`, `phase` 0…1) at show time t; `k` is the motion amplitude
 * (0 = the static warm state: reduced motion, Lite, or not yet fully dark).
 */
export function animLevel(anim: number, t: number, phase: number, k: number): number {
  let m = 1;
  switch (anim) {
    case ANIM.breathe:
      m = 0.72 + 0.28 * breath(t + phase * SHOW.breathe, SHOW.breathe);
      break;
    case ANIM.wave:
      m = 0.45 + 0.55 * wave(t, phase, SHOW.arenaWave);
      break;
    case ANIM.pulse:
      m = 0.35 + 0.65 * breath(t + phase * SHOW.fightPulse, SHOW.fightPulse);
      break;
    case ANIM.beacon:
      m = 0.35 + 0.65 * swell(t / SHOW.beacon + phase);
      break;
    case ANIM.shimmer:
      m = 0.88 + 0.12 * breath(t + phase * SHOW.shimmer, SHOW.shimmer);
      break;
  }
  return 1 + (m - 1) * k;
}

/** the largest frequency (Hz) any animated light reaches */
export const maxShowHz = () => Math.max(...Object.values(SHOW).map((p) => 1 / p));

/**
 * Count the "flashes" of a brightness signal sampled at `fps` over its length: a flash is a pair of opposing
 * changes of at least `delta` (relative to the running extreme), as in the Harding / WCAG definition.
 */
export function countFlashes(samples: number[], delta = 0.1): number {
  let dir = 0;
  let lo = samples[0] ?? 0;
  let hi = lo;
  let ext = lo;
  let transitions = 0;
  for (const v of samples) {
    if (dir === 0) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      if (hi - lo >= delta) {
        dir = v === hi ? 1 : -1;
        ext = v;
        transitions++;
      }
    } else if (dir > 0) {
      if (v > ext) ext = v;
      else if (ext - v >= delta) {
        transitions++;
        dir = -1;
        ext = v;
      }
    } else if (v < ext) ext = v;
    else if (v - ext >= delta) {
      transitions++;
      dir = 1;
      ext = v;
    }
  }
  return Math.floor(transitions / 2);
}

/* ----------------------------------------------------------- photocells ----------------------------------------------------------- */

/**
 * Switch-on groups over the time-of-day `lights` value (0 by day → 1 once dark; world/time-of-day/look.ts lightsOn):
 * each fixture has a threshold inside its group's window and fades in over FADE (a lamp warming up, ~10–20 s of real
 * dusk), so the campus lights up in a staggered wave instead of all at once — and switches off in reverse at dawn.
 */
export const PHOTOCELL = {
  /** signs and the arena's lines: first (they are on by day too, they only get brighter) */
  signs: [0.02, 0.12],
  /** street lights, walk and plaza lamps */
  lamps: [0.04, 0.38],
  /** architectural washes and uplights (on a building's timer, a little after the street lights) */
  facades: [0.18, 0.5],
  /** low accents: benches, planters, bollards */
  accents: [0.3, 0.6],
} as const;
export type PhotoGroup = keyof typeof PHOTOCELL;
export const FADE = 0.2;
/** threshold of fixture `i` in its group (deterministic per fixture: a stable hash, no randomness at runtime) */
export function threshold(group: PhotoGroup, i: number): number {
  const [a, b] = PHOTOCELL[group];
  return a + (b - a) * hash01(i * 7 + group.length * 131);
}
/** how far on a fixture with threshold `thr` is for a `lights` value (smoothstep over FADE) */
export const switchOn = (lights: number, thr: number) => smoothstep(thr, thr + FADE, lights);
/** the show's motion amplitude: only once the sky is dark (lights ≥ 0.8), 0 for reduced motion / Lite */
export const showAmp = (lights: number, motion: boolean) => (motion ? smoothstep(0.8, 1, lights) : 0);

/** stable 0…1 hash of an integer (fixture staggering; deterministic on every client) */
export function hash01(n: number): number {
  let h = (n | 0) * 374761393 + 668265263;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/* ----------------------------------------------------------- GLSL ----------------------------------------------------------- */

const f = (x: number) => x.toFixed(4);
/** the same functions for the shaders (uniforms uGkShowT: show time s, uGkShowK: motion amplitude) */
export const SHOW_GLSL = /* glsl */ `
#ifndef GK_SHOW
#define GK_SHOW
const float GK_TAU = 6.2831853;
float gkBreath(float t, float p) { return 0.5 - 0.5 * cos(GK_TAU * t / p); }
float gkWave(float t, float x, float p) { float c = 0.5 + 0.5 * cos(GK_TAU * (t / p - x)); return c * c; }
float gkSwell(float f) { float x = fract(f); return smoothstep(0.0, 0.25, x) * (1.0 - smoothstep(0.25, 0.6, x)); }
float gkAnim(float anim, float t, float ph, float k) {
  float m = 1.0;
  if (anim > 0.5 && anim < 1.5) m = 0.72 + 0.28 * gkBreath(t + ph * ${f(SHOW.breathe)}, ${f(SHOW.breathe)});
  else if (anim < 2.5 && anim > 1.5) m = 0.45 + 0.55 * gkWave(t, ph, ${f(SHOW.arenaWave)});
  else if (anim < 3.5 && anim > 2.5) m = 0.35 + 0.65 * gkBreath(t + ph * ${f(SHOW.fightPulse)}, ${f(SHOW.fightPulse)});
  else if (anim < 4.5 && anim > 3.5) m = 0.35 + 0.65 * gkSwell(t / ${f(SHOW.beacon)} + ph);
  else if (anim > 4.5) m = 0.88 + 0.12 * gkBreath(t + ph * ${f(SHOW.shimmer)}, ${f(SHOW.shimmer)});
  return 1.0 + (m - 1.0) * k;
}
#endif
`;
export const SHOW_PERIODS_GLSL = {
  arenaWave: f(SHOW.arenaWave),
  lozenges: f(SHOW.lozenges),
  breathe: f(SHOW.breathe),
  fightPulse: f(SHOW.fightPulse),
};
