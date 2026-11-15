/**
 * What the campus looks like for a sun / moon position (P2-WLD-19, docs/TIME-OF-DAY.md §3–§5). Pure: no three.js,
 * colours are LINEAR RGB triplets (the renderer's working space) unless named `…Srgb`.
 *
 * Everything is a function of the sun's altitude (and whether it is rising or setting, and where the moon is), so a
 * transition only has to animate the clock: the sky, the light, the fog and the street lights all follow at once and
 * always agree with each other — no separate cross-fades that could drift apart.
 *
 * Exposure: values are PRE-EXPOSED (an "eye-adapted" camera). Physically, noon is ~400 000× brighter than a full
 * moon night and ~10⁸× brighter than starlight; a display (and a VR headset) cannot show that, and a player must be
 * able to walk at night. The tables below are what an auto-exposure camera would record: midday a touch brighter than
 * the morning (never blown out), twilight about half, night ≈ 10–15 % of day, blue-shifted (the eye's scotopic shift),
 * with the moon adding a cool key light. ACES filmic tone mapping stays fixed (no exposure uniform changes), so the
 * bloom threshold keeps meaning "only real emitters" (LEDs, lamps, the sun and moon discs).
 */

export type Rgb = [number, number, number];

/** sRGB hex → linear RGB */
export function lin(hex: string): Rgb {
  const n = parseInt(hex.replace("#", ""), 16);
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
}
/** sRGB hex → sRGB triplet 0…1 (for shader code that works after the colour-space conversion) */
export function srgb(hex: string): Rgb {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

/* ---------------------------------------------------------------- phases ---------------------------------------------------------------- */

/** The named phases of the day (UI icon, capture cache keys, analytics-free). */
export type Phase = "night" | "dawn" | "sunrise" | "morning" | "midday" | "afternoon" | "golden" | "sunset" | "dusk";
export const PHASES: Phase[] = ["night", "dawn", "sunrise", "morning", "midday", "afternoon", "golden", "sunset", "dusk"];

/**
 * Phase from the sun's altitude (degrees, refracted) and direction of travel. Bands (docs/TIME-OF-DAY.md §3):
 * night < −12° (nautical dusk over: street lights on, stars out); dawn / dusk −12°…−0.83° (nautical + civil
 * twilight); sunrise / sunset −0.83°…4° (the disc at the horizon); golden hour 4°…10° in the evening (the morning
 * equivalent is part of "morning"); midday ≥ 60° (≈ ±2 h around solar noon here, all year).
 */
export function phaseOf(sunEl: number, rising: boolean): Phase {
  if (sunEl < -12) return "night";
  if (sunEl < -0.833) return rising ? "dawn" : "dusk";
  if (sunEl < 4) return rising ? "sunrise" : "sunset";
  if (sunEl >= 60) return "midday";
  if (rising) return "morning";
  return sunEl < 10 ? "golden" : "afternoon";
}

/** Twilight sub-band for the docs / debugging: civil (−6…−0.83), nautical (−12…−6), astronomical (−18…−12). */
export function twilightOf(sunEl: number): "day" | "civil" | "nautical" | "astronomical" | "night" {
  if (sunEl >= -0.833) return "day";
  if (sunEl >= -6) return "civil";
  if (sunEl >= -12) return "nautical";
  if (sunEl >= -18) return "astronomical";
  return "night";
}

/* ---------------------------------------------------------------- sunlight ---------------------------------------------------------------- */

/** Kasten–Young relative air mass for an altitude (degrees); ≈ 38 at the horizon. */
export function airMass(el: number): number {
  const h = Math.max(-0.5, el);
  return 1 / (Math.sin((h * Math.PI) / 180) + 0.50572 * (h + 6.07995) ** -1.6364);
}

/**
 * Direct sunlight transmittance (R, G, B) through the atmosphere at Musanze's altitude: Rayleigh optical depths at
 * ~680 / 550 / 440 nm scaled by the station pressure (≈ 0.81 atm at 1,850 m), plus a light highland aerosol (Ångström
 * β ≈ 0.04, α 1.3). Gives the familiar white noon sun, cream morning sun and deep orange disc at the horizon.
 */
const TAU: Rgb = [0.036 * 0.81 + 0.04 * 0.68 ** -1.3 * 0.55, 0.098 * 0.81 + 0.04 * 0.55 ** -1.3 * 0.55, 0.236 * 0.81 + 0.04 * 0.44 ** -1.3 * 0.55];
export function transmittance(el: number): Rgb {
  const m = airMass(el);
  return [Math.exp(-TAU[0] * m), Math.exp(-TAU[1] * m), Math.exp(-TAU[2] * m)];
}
const lum = (c: Rgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const REF_EL = 17; // the hand-tuned morning the world was built with (P1-WLD-03): its light is the reference
const REF_LUM = lum(transmittance(REF_EL));

/** Normalised sun colour (max channel 1, linear) for an altitude. */
export function sunColour(el: number): Rgb {
  const t = transmittance(el);
  const k = Math.max(t[0], t[1], t[2]);
  return [t[0] / k, t[1] / k, t[2] / k];
}

/* ---------------------------------------------------------------- keyframes ---------------------------------------------------------------- */

interface Key {
  h: number;
  zenith: string;
  horizon: string;
  /** horizon glow towards the sun (twilight / sunset band) */
  glow: string;
  glowK: number;
  fog: string;
  fogK: number;
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
  envI: number;
  cloud: string;
  cloudA: number;
  /** tint for the unlit "daylight-baked" materials: tree impostors, mist banks, fountain spray */
  unlit: string;
}

/**
 * Keyframes over the sun's altitude. 17° is the hand-tuned P1-WLD-03 morning (hemisphere #c9def0 / #4a5236 × 0.45,
 * fog #c4d2dc, env × 0.55): from there the day only gets a little deeper blue and clearer; the evening and night
 * entries follow photographs of the Virunga foothills (short equatorial twilight: deep blue within ~25 min).
 */
const KEYS: Key[] = [
  { h: -90, zenith: "#04070f", horizon: "#0d1422", glow: "#0d1422", glowK: 0, fog: "#111926", fogK: 0.85, hemiSky: "#5b6f97", hemiGround: "#171c1a", hemiI: 0.95, envI: 0.55, cloud: "#1d2431", cloudA: 0.42, unlit: "#323c54" },
  { h: -18, zenith: "#04070f", horizon: "#0d1422", glow: "#0d1422", glowK: 0, fog: "#111926", fogK: 0.85, hemiSky: "#5b6f97", hemiGround: "#171c1a", hemiI: 0.95, envI: 0.55, cloud: "#1d2431", cloudA: 0.42, unlit: "#323c54" },
  { h: -12, zenith: "#081126", horizon: "#1a2640", glow: "#27304c", glowK: 0.25, fog: "#1b2537", fogK: 0.88, hemiSky: "#62779e", hemiGround: "#1a1f1c", hemiI: 0.95, envI: 0.55, cloud: "#272e40", cloudA: 0.45, unlit: "#3b4660" },
  { h: -8, zenith: "#112147", horizon: "#394c72", glow: "#7d6378", glowK: 0.55, fog: "#323f5a", fogK: 0.92, hemiSky: "#7488b2", hemiGround: "#21261f", hemiI: 0.92, envI: 0.55, cloud: "#46475e", cloudA: 0.5, unlit: "#525e7c" },
  { h: -4, zenith: "#1f3b76", horizon: "#76819f", glow: "#d98c68", glowK: 0.95, fog: "#66718d", fogK: 0.95, hemiSky: "#8d9fc6", hemiGround: "#2b3125", hemiI: 0.85, envI: 0.55, cloud: "#8a7a88", cloudA: 0.55, unlit: "#7a839a" },
  { h: -1, zenith: "#2f5c9e", horizon: "#b2a5a6", glow: "#ff965a", glowK: 1.25, fog: "#a09ca4", fogK: 1.0, hemiSky: "#a5b5d4", hemiGround: "#363c2c", hemiI: 0.68, envI: 0.55, cloud: "#d9a28d", cloudA: 0.6, unlit: "#a3a4b1" },
  { h: 2, zenith: "#4677ba", horizon: "#dcbfa3", glow: "#ffad6e", glowK: 1.05, fog: "#cabdb1", fogK: 1.0, hemiSky: "#b6c7de", hemiGround: "#3e4530", hemiI: 0.55, envI: 0.55, cloud: "#f2c6a3", cloudA: 0.62, unlit: "#c9c2bb" },
  { h: 6, zenith: "#5386c6", horizon: "#e2d6c6", glow: "#ffcd98", glowK: 0.7, fog: "#cdcfcb", fogK: 1.0, hemiSky: "#c2d6ea", hemiGround: "#465034", hemiI: 0.48, envI: 0.55, cloud: "#f6dfc6", cloudA: 0.62, unlit: "#e6e0d8" },
  { h: 12, zenith: "#578dcd", horizon: "#c9d6df", glow: "#ffeedb", glowK: 0.45, fog: "#c4d2dc", fogK: 1.0, hemiSky: "#c9def0", hemiGround: "#4a5236", hemiI: 0.45, envI: 0.55, cloud: "#f4f6f8", cloudA: 0.62, unlit: "#ffffff" },
  { h: 17, zenith: "#578dcd", horizon: "#c6d4de", glow: "#fff2e2", glowK: 0.4, fog: "#c4d2dc", fogK: 1.0, hemiSky: "#c9def0", hemiGround: "#4a5236", hemiI: 0.45, envI: 0.55, cloud: "#f4f6f8", cloudA: 0.62, unlit: "#ffffff" },
  { h: 40, zenith: "#4f88cf", horizon: "#c2d3e2", glow: "#fff6ec", glowK: 0.3, fog: "#c5d3de", fogK: 0.95, hemiSky: "#c9def0", hemiGround: "#4c5538", hemiI: 0.48, envI: 0.55, cloud: "#f6f8fa", cloudA: 0.62, unlit: "#ffffff" },
  { h: 90, zenith: "#4a84cf", horizon: "#c0d3e4", glow: "#fff8f0", glowK: 0.25, fog: "#c6d5e0", fogK: 0.92, hemiSky: "#cce0f2", hemiGround: "#4e573a", hemiI: 0.5, envI: 0.55, cloud: "#f8f9fb", cloudA: 0.6, unlit: "#ffffff" },
];

interface LinKey {
  h: number;
  c: Record<"zenith" | "horizon" | "glow" | "fog" | "hemiSky" | "hemiGround" | "cloud" | "unlit", Rgb>;
  fogSrgb: Rgb;
  n: Record<"glowK" | "fogK" | "hemiI" | "envI" | "cloudA", number>;
}
const LIN: LinKey[] = KEYS.map((k) => ({
  h: k.h,
  c: { zenith: lin(k.zenith), horizon: lin(k.horizon), glow: lin(k.glow), fog: lin(k.fog), hemiSky: lin(k.hemiSky), hemiGround: lin(k.hemiGround), cloud: lin(k.cloud), unlit: lin(k.unlit) },
  fogSrgb: srgb(k.fog),
  n: { glowK: k.glowK, fogK: k.fogK, hemiI: k.hemiI, envI: k.envI, cloudA: k.cloudA },
}));

/* ---------------------------------------------------------------- the look ---------------------------------------------------------------- */

export interface Look {
  phase: Phase;
  sunEl: number;
  // sky (linear)
  zenith: Rgb;
  horizon: Rgb;
  glow: Rgb;
  glowK: number;
  /** Belt of Venus / Earth's shadow on the anti-solar horizon during civil twilight */
  beltK: number;
  sunDisc: Rgb;
  /** sun disc brightness (HDR: > 1 blooms) */
  sunDiscI: number;
  stars: number;
  moonDiscI: number;
  // light
  sunCol: Rgb;
  sunI: number;
  moonCol: Rgb;
  moonI: number;
  /** which body is the key (directional) light: 1 = sun, 0 = moon */
  keyIsSun: boolean;
  keyCol: Rgb;
  keyI: number;
  /** shadow strength of the key light (LightShadow.intensity) */
  shadow: number;
  hemiSky: Rgb;
  hemiGround: Rgb;
  hemiI: number;
  envI: number;
  // atmosphere
  fog: Rgb;
  /** fog colour in sRGB for shaders that apply haze after the colour-space conversion (volcanoes) */
  hazeSrgb: Rgb;
  fogK: number;
  cloud: Rgb;
  cloudA: number;
  unlit: Rgb;
  // artificial light
  /** street lights / lamps / signs on (0…1): photocells switch on around sunset, off around sunrise */
  lights: number;
  /** facade window glow (glass emissive intensity) */
  windows: number;
  /** LED sign multiplier (a touch brighter at night) */
  led: number;
  /** lamp diffuser emissive intensity */
  lampHead: number;
}

export interface MoonIn {
  el: number;
  fraction: number;
}

/** Interpolated keyframe values for an altitude (smoothstep between neighbours: no visible kinks). */
function keysAt(h: number) {
  let i = 0;
  while (i < LIN.length - 2 && LIN[i + 1]!.h <= h) i++;
  const a = LIN[i]!;
  const b = LIN[i + 1]!;
  const t = smoothstep(a.h, b.h, h);
  const c = {} as LinKey["c"];
  for (const k of Object.keys(a.c) as (keyof LinKey["c"])[]) c[k] = mixRgb(a.c[k], b.c[k], t);
  const n = {} as LinKey["n"];
  for (const k of Object.keys(a.n) as (keyof LinKey["n"])[]) n[k] = mix(a.n[k], b.n[k], t);
  return { c, n, fogSrgb: mixRgb(a.fogSrgb, b.fogSrgb, t) };
}

/** Artificial lights on (0…1) for a sun altitude: photocells trip at ~10–30 lux (sun ≈ +2° … −3.5°). */
export const lightsOn = (sunEl: number) => 1 - smoothstep(-3.5, 2.5, sunEl);

export function computeLook(sunEl: number, rising: boolean, moon: MoonIn): Look {
  const { c, n, fogSrgb } = keysAt(sunEl);
  // evenings are a little warmer and hazier than mornings (dust and smoke of the day; morning valley mist is cool)
  const eve = rising ? 0 : smoothstep(-9, -2, sunEl) * (1 - smoothstep(4, 14, sunEl));
  const warm = (x: Rgb, k: number): Rgb => [x[0] * (1 + 0.1 * k), x[1] * (1 + 0.02 * k), x[2] * (1 - 0.08 * k)];
  const horizon = warm(c.horizon, eve);
  const glow = warm(c.glow, eve);
  const cloud = warm(c.cloud, eve);

  // sun: physical colour and pre-exposed intensity (the reference morning = 2.6, noon capped so it never blows out)
  const sunCol = sunColour(sunEl);
  const tl = lum(transmittance(sunEl)) / REF_LUM;
  const sunI = Math.min(2.75, 2.6 * Math.pow(Math.max(tl, 0), 0.6)) * smoothstep(-1, 4, sunEl);
  // the disc: bright white high up (blooms), dimmer and orange at the horizon, gone below it (terrain hides it)
  const sunDiscI = (6 + 18 * smoothstep(0, 30, sunEl)) * smoothstep(-1.2, 0.3, sunEl);

  // moon: a cool, dim key light once the sky is dark (≈ 1/400 000 of the sun physically; pre-exposed here)
  const dark = smoothstep(-3, -9, sunEl);
  const moonUp = smoothstep(1, 12, moon.el);
  const moonI = 0.34 * Math.pow(moon.fraction, 1.3) * moonUp * dark;
  const moonCol = lin("#b3c4e2");
  const keyIsSun = sunEl > -2;
  const keyCol = keyIsSun ? sunCol : moonCol;
  const keyI = keyIsSun ? sunI : moonI;
  const shadow = keyIsSun ? smoothstep(0.5, 8, sunEl) : 0.45 * moon.fraction * smoothstep(5, 20, moon.el) * dark;

  // night sky: stars from nautical twilight on, washed out by a bright moon; the moon brightens the night sky a bit
  const stars = smoothstep(-6, -14, sunEl) * (1 - 0.55 * moon.fraction * moonUp);
  const moonSky = 0.6 * moon.fraction * moonUp * dark;
  const zenith = mixRgb(c.zenith, [c.zenith[0] * 2.2, c.zenith[1] * 2.4, c.zenith[2] * 2.6], moonSky);
  const horizonM = mixRgb(horizon, [horizon[0] * 1.6, horizon[1] * 1.7, horizon[2] * 1.8], moonSky);
  const hemiI = n.hemiI * (1 + 0.25 * moonSky);

  const lights = lightsOn(sunEl);
  return {
    phase: phaseOf(sunEl, rising),
    sunEl,
    zenith,
    horizon: horizonM,
    glow,
    glowK: n.glowK * (1 + 0.25 * eve),
    beltK: smoothstep(-7, -2.5, sunEl) * (1 - smoothstep(0, 3, sunEl)),
    sunDisc: sunCol,
    sunDiscI,
    stars,
    moonDiscI: (0.35 + 1.1 * dark) * smoothstep(-1, 1, moon.el),
    sunCol,
    sunI,
    moonCol,
    moonI,
    keyIsSun,
    keyCol,
    keyI,
    shadow,
    hemiSky: c.hemiSky,
    hemiGround: c.hemiGround,
    hemiI,
    envI: n.envI,
    fog: mixRgb(c.fog, [c.fog[0] * 1.5, c.fog[1] * 1.6, c.fog[2] * 1.7], moonSky),
    hazeSrgb: fogSrgb,
    fogK: n.fogK,
    cloud: mixRgb(cloud, [cloud[0] * 1.8, cloud[1] * 1.9, cloud[2] * 2.1], moonSky),
    cloudA: n.cloudA,
    unlit: c.unlit,
    lights,
    windows: 0.3 + 0.95 * lights,
    led: 1 + 0.3 * lights,
    lampHead: 0.15 + 3.6 * lights,
  };
}
