import * as THREE from "three";
import type { BodyType, HairStyle, HeadwearKind } from "../outfits";
import { EAR_LANDMARKS, SKULL_FITS } from "./skull";
import { campusHumansOn } from "./realism-flag";

/**
 * How hair and headwear sit on a head (P2-AVA-10), in the face frame (metres; origin between the eyes, +x the
 * person's left, +y up, +z forward). Pure numbers / functions, shared by the hair builder (hair.ts) and the headwear
 * builder (headwear.ts), unit-tested in head-fit.test.ts.
 */

/** Azimuth of a face-frame point around the skull centre of `body` (0 = straight ahead, +π/2 = the person's left). */
export function skullAzimuth(body: BodyType, x: number, z: number): number {
  return Math.atan2(x, z - SKULL_FITS[body].c[2]);
}

/**
 * Lower edge of a headwear band (face frame y, m) at azimuth `az`: front (forehead, above the brows), sides (always
 * above the ears: ears stay outside the band) and back (over the occipital bone), joined by a smooth cosine series.
 */
export const BAND: Record<
  Exclude<HeadwearKind, "none">,
  { front: number; aboveEar: number; back: number }
> = {
  // a cap sits ~2.5 cm above the brows, over the ears, low on the back of the head
  cap: { front: 0.046, aboveEar: 0.016, back: -0.016 },
  beanie: { front: 0.043, aboveEar: 0.011, back: -0.03 },
  bucket: { front: 0.047, aboveEar: 0.014, back: -0.008 },
  // a kufi covers the crown only
  kufi: { front: 0.074, aboveEar: 0.055, back: 0.026 },
  // a headwrap covers the hairline and the nape
  wrap: { front: 0.045, aboveEar: 0.011, back: -0.045 },
};

/** P2-AVA-12 cap band height at the front (face frame y, m) with the realistic campus people on. */
export const CAP_FRONT_V2 = 0.041;
export function bandY(kind: Exclude<HeadwearKind, "none">, body: BodyType, az: number): number {
  const b = BAND[kind];
  // smaller heads (fit scale) get proportionally lower bands; the sides clear that body's own ear tops
  const k = SKULL_FITS[body].s[1];
  // P2-AVA-12: a cap is worn lower on the forehead (≈ 1.5–2 cm above the brows, the brim shading the eyes)
  const f = (kind === "cap" && campusHumansOn() ? CAP_FRONT_V2 : b.front) * k;
  const back = b.back * k;
  const s = kind === "kufi" ? b.aboveEar * k : EAR_LANDMARKS[body].earTop + b.aboveEar;
  const a1 = (f - back) / 2;
  const a0 = (f + back) / 4 + s / 2;
  const a2 = (f + back) / 4 - s / 2;
  return a0 + a1 * Math.cos(az) + a2 * Math.cos(2 * az);
}

/**
 * Room a hairstyle needs under headwear (m above the skull template surface, which already includes ~4 mm of
 * close hair): compressed volume for an afro / high-top, the strands of braids and locs, nothing for a bald head
 * (the band then hugs the scalp).
 */
export const HAT_CLEARANCE: Record<HairStyle, number> = {
  bald: -0.0025,
  buzz: 0.0004,
  fade: 0.001,
  waves: 0.0012,
  short: 0.002,
  cornrows: 0.0025,
  headwrap: 0.002,
  bun: 0.006,
  puffs: 0.007,
  afro: 0.009,
  hightop: 0.008,
  twists: 0.0075,
  braids: 0.009,
  shortlocs: 0.009,
  locs: 0.011,
  lowfade: 0.001,
  cornrowbun: 0.0025,
  braidtail: 0.009,
};

/**
 * P2-AVA-15: a kufi is a close, snug cap: it never floats a centimetre over pressed locs / braids (the close-up showed
 * a rigid bowl with a gap under its edge). Under it the strands are pressed flatter, so its clearance is capped.
 */
export const KUFI_SNUG = 0.0055;

/**
 * Floor of the room under any hat with the campus people on (P2-AVA-15): on a bald head the old negative clearance put
 * the kufi and the cap crown inside the scalp (the skin showed through the fabric in patches).
 */
export const HAT_MIN_CLEARANCE = 0.0012;

/** Room (m above the skull template) a hairstyle gets under a given headwear (HAT_CLEARANCE, capped for a kufi). */
export function hatClearance(hat: HeadwearKind, style: HairStyle): number {
  const c = HAT_CLEARANCE[style] ?? 0.002;
  if (!campusHumansOn() || hat === "none") return c;
  return Math.max(HAT_MIN_CLEARANCE, hat === "kufi" ? Math.min(c, KUFI_SNUG) : c);
}

/**
 * P2-AVA-15 loc / braid strand profile: radius factor along the strand (u = 0 root … 1 tip) for a strand with hash
 * `h` (0..1). Locs are felted ropes: a little narrower at the root (the parting pulls them), full through the length,
 * slightly irregular (soft lumps, never a constant-width plank), then a rounded, tapered tip.
 */
export function strandRadius(u: number, h: number, kind: "loc" | "braid" | "twist"): number {
  const root = THREE.MathUtils.lerp(0.72, 1, smoothRange(u, 0, 0.06));
  const tipStart = kind === "loc" ? 0.86 : 0.9;
  const tip = 1 - 0.55 * Math.pow(smoothRange(u, tipStart, 1), 1.4);
  const lumps =
    kind === "loc"
      ? 1 + 0.085 * Math.sin(u * 23 + h * 17) + 0.05 * Math.sin(u * 51 + h * 31)
      : 1 + 0.02 * Math.sin(u * 40 + h * 9);
  return root * tip * lumps;
}

/** Secondary sway weight of a hanging strand (0 at the root, growing with the free length squared). */
export function swayWeight(u: number): number {
  const free = smoothRange(u, 0.12, 1);
  return free * free;
}

function smoothRange(x: number, a: number, b: number): number {
  return THREE.MathUtils.smoothstep(x, a, b);
}

/**
 * Close-hair shell (hair cut close to the scalp, drawn as stacked layers): layer count and hair length (m) at a
 * face-frame point. A fade runs from skin-short at the temples, over the ears and on the nape up to full length on
 * the top; the front hairline keeps its length. Returns 0 where the style has no shell.
 */
export interface ShellSpec {
  layers: number;
  /** pattern id in the hair shader: 0 plain, 1 cornrows, 2 waves, 3 centre parting, 4 pulled back, 5 box partings */
  pattern: number;
  /** shaved-side fade (scalp shows through) */
  fade: boolean;
}
export const SHELL: Record<HairStyle, ShellSpec | null> = {
  short: { layers: 4, pattern: 0, fade: false },
  fade: { layers: 4, pattern: 0, fade: true },
  buzz: { layers: 2, pattern: 0, fade: false },
  waves: { layers: 3, pattern: 2, fade: true },
  cornrows: { layers: 3, pattern: 1, fade: false },
  hightop: { layers: 3, pattern: 0, fade: true },
  afro: { layers: 2, pattern: 0, fade: false },
  puffs: { layers: 2, pattern: 3, fade: false },
  bun: { layers: 2, pattern: 4, fade: false },
  braids: { layers: 2, pattern: 5, fade: false },
  locs: { layers: 2, pattern: 5, fade: false },
  twists: { layers: 2, pattern: 5, fade: false },
  shortlocs: { layers: 2, pattern: 5, fade: false },
  lowfade: { layers: 4, pattern: 0, fade: true },
  cornrowbun: { layers: 3, pattern: 1, fade: false },
  braidtail: { layers: 2, pattern: 1, fade: false },
  headwrap: null,
  bald: null,
};

const smooth = THREE.MathUtils.smoothstep;

/** How much of a fade applies at a point (0 = full length, 1 = skin-short): sides and back only, low on the head. */
export function fadeAmount(x: number, y: number, z: number, low = 0): number {
  // behind the temples (the front hairline keeps its length)
  const side = smooth(-z, 0.035, 0.07);
  // the fade line is lower at the back of the head (over the occipital bone) than at the temples
  const back = smooth(-z, 0.1, 0.17);
  // a low fade keeps its line ~2 cm lower (just over the ears, low on the nape)
  const y0 = THREE.MathUtils.lerp(0.014, -0.034, back) - 0.022 * low;
  const y1 = y0 + 0.056 - 0.012 * low;
  void x;
  return side * (1 - smooth(y, y0, y1));
}

/** Close-hair length (m) of `style` at a face-frame point (before any headwear clipping). */
export function shellLength(style: HairStyle, x: number, y: number, z: number): number {
  const top = smooth(y, 0.0, 0.08);
  switch (style) {
    case "short":
      return THREE.MathUtils.lerp(0.0042, 0.0068, top);
    case "fade":
      return THREE.MathUtils.lerp(0.0072, 0.0004, fadeAmount(x, y, z));
    case "lowfade":
      return THREE.MathUtils.lerp(0.0062, 0.0004, fadeAmount(x, y, z, 1));
    case "hightop":
      return THREE.MathUtils.lerp(0.0045, 0.0004, fadeAmount(x, y, z));
    case "waves":
      return THREE.MathUtils.lerp(0.0036, 0.0008, fadeAmount(x, y, z));
    case "buzz":
      return 0.0022;
    case "cornrows":
    case "cornrowbun":
    case "braidtail":
      return 0.0048;
    case "headwrap":
    case "bald":
      return 0;
    default:
      // tight, pulled-back base under volumes and strands
      return 0.0028;
  }
}

/** Hair length (m) after headwear: anything inside the band is pressed down to the hat's clearance. */
export function clippedLength(
  style: HairStyle,
  hat: HeadwearKind,
  body: BodyType,
  x: number,
  y: number,
  z: number,
): number {
  const l = shellLength(style, x, y, z);
  if (hat === "none" || l <= 0) return l;
  const under = smooth(
    y,
    bandY(hat, body, skullAzimuth(body, x, z)) - 0.006,
    bandY(hat, body, skullAzimuth(body, x, z)) + 0.002,
  );
  const room = Math.max(0.0004, hatClearance(hat, style) - 0.0012);
  return THREE.MathUtils.lerp(l, Math.min(l, room), under);
}
