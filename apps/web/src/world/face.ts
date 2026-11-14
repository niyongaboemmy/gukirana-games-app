import type { BodyType } from "./outfits";

/**
 * Face choices (P2-AVA-07): shape, eyes, brows, nose, lips, facial hair, skin marks and subtle make-up.
 *
 * Rendered without extra meshes: proportions move the Rocketbox face bones (jaw, cheeks, nose, lips, lids, brows:
 * world/human/face-rig.ts) and the surface details (facial hair, brows, iris colour, freckles, beauty marks,
 * make-up) are painted in the head shader from the bind-pose face position (world/human/materials.ts).
 *
 * Wire format: one extra `|`-separated token in the look code, `F=` + a version digit + one base-36 digit per field
 * (FACE_FIELDS order), e.g. `F=10210300000`. Old codes have no token and decode with the person's seeded face;
 * old clients ignore the token (it is never a valid hex top colour). Unknown digits fall back field by field.
 * Labels live in components/avatar-strings.ts (`FACE_LABELS`).
 */
/** Feature flag for the Face tab of the avatar editor (P2-AVA-07). On by default; NEXT_PUBLIC_FF_FACE_EDITOR=0 hides the tab (faces in look codes still render). */
export const FACE_EDITOR_ON = process.env.NEXT_PUBLIC_FF_FACE_EDITOR !== "0";

export const FACE_SHAPES = ["oval", "round", "square", "heart", "long"] as const;
export const EYE_SHAPES = ["almond", "round", "hooded", "narrow", "deep"] as const;
/** Iris colours, mostly browns (as in Rwanda), all muted: no glowing or neon eyes. */
export const EYE_COLORS = ["#2b170e", "#3d2314", "#553220", "#5e3b1e", "#6b4a26", "#57534a", "#5a5232"] as const;
export const BROW_STYLES = ["natural", "full", "arched", "straight", "thin", "bold"] as const;
export const NOSE_SHAPES = ["broad", "rounded", "straight", "narrow", "wide"] as const;
export const LIP_SHAPES = ["full", "medium", "thin", "wide", "bow"] as const;
export const FACIAL_HAIR = ["none", "stubble", "moustache", "goatee", "chinstrap", "short", "full", "shadow"] as const;
export const SKIN_MARKS = ["none", "lightFreckles", "freckles", "markCheek", "markLip", "markChin"] as const;
export const MAKEUP = ["none", "gloss", "berry", "red", "liner", "linerBerry"] as const;

export type FaceShape = (typeof FACE_SHAPES)[number];
export type EyeShape = (typeof EYE_SHAPES)[number];
export type BrowStyle = (typeof BROW_STYLES)[number];
export type NoseShape = (typeof NOSE_SHAPES)[number];
export type LipShape = (typeof LIP_SHAPES)[number];
export type FacialHair = (typeof FACIAL_HAIR)[number];
export type SkinMark = (typeof SKIN_MARKS)[number];
export type Makeup = (typeof MAKEUP)[number];

export interface FaceLook {
  shape: FaceShape;
  eyes: EyeShape;
  /** one of EYE_COLORS */
  eyeColor: string;
  brows: BrowStyle;
  nose: NoseShape;
  lips: LipShape;
  /** coloured from the hair colour */
  facialHair: FacialHair;
  marks: SkinMark;
  makeup: Makeup;
}

/** Field order of the wire token (append new fields at the end only). */
export const FACE_FIELDS = [
  ["shape", FACE_SHAPES],
  ["eyes", EYE_SHAPES],
  ["eyeColor", EYE_COLORS],
  ["brows", BROW_STYLES],
  ["nose", NOSE_SHAPES],
  ["lips", LIP_SHAPES],
  ["facialHair", FACIAL_HAIR],
  ["marks", SKIN_MARKS],
  ["makeup", MAKEUP],
] as const satisfies readonly (readonly [keyof FaceLook, readonly string[]])[];

export const DEFAULT_FACE: FaceLook = {
  shape: "oval",
  eyes: "almond",
  eyeColor: EYE_COLORS[1],
  brows: "natural",
  nose: "rounded",
  lips: "medium",
  facialHair: "none",
  marks: "none",
  makeup: "none",
};

export const FACE_VERSION = "1";
const TOKEN = /^F=(\d)([0-9a-z]*)$/;

export function encodeFace(f: FaceLook): string {
  let s = `F=${FACE_VERSION}`;
  for (const [k, list] of FACE_FIELDS) {
    const i = (list as readonly string[]).indexOf(f[k]);
    s += Math.max(0, i).toString(36);
  }
  return s;
}

/** The face token of a split look code (any position after the fixed fields), or null. */
export function findFaceToken(parts: string[]): string | null {
  for (let i = 11; i < parts.length; i++) if (parts[i]!.startsWith("F=")) return parts[i]!;
  return null;
}

/** Decodes a face token over `base` (missing / unknown fields keep the base value; never throws). */
export function decodeFace(token: string | null | undefined, base: FaceLook): FaceLook {
  const m = token ? TOKEN.exec(token) : null;
  if (!m || m[1] !== FACE_VERSION) return { ...base };
  const out: FaceLook = { ...base };
  const digits = m[2]!;
  FACE_FIELDS.forEach(([k, list], i) => {
    const d = digits[i];
    if (d === undefined) return;
    const v = (list as readonly string[])[parseInt(d, 36)];
    if (v !== undefined) (out as unknown as Record<string, string>)[k] = v;
  });
  return out;
}

/* ---------- deterministic default face per person ---------- */
type W<T> = readonly (readonly [T, number])[];
const SEED_SHAPE: W<FaceShape> = [
  ["oval", 34],
  ["round", 18],
  ["square", 16],
  ["heart", 14],
  ["long", 18],
];
const SEED_EYES: W<EyeShape> = [
  ["almond", 38],
  ["round", 18],
  ["hooded", 16],
  ["narrow", 12],
  ["deep", 16],
];
const SEED_EYE_COLOR: W<string> = [
  [EYE_COLORS[0], 34],
  [EYE_COLORS[1], 34],
  [EYE_COLORS[2], 18],
  [EYE_COLORS[3], 8],
  [EYE_COLORS[4], 3],
  [EYE_COLORS[5], 2],
  [EYE_COLORS[6], 1],
];
const SEED_BROWS: Record<BodyType, W<BrowStyle>> = {
  feminine: [
    ["natural", 30],
    ["arched", 26],
    ["thin", 14],
    ["full", 14],
    ["straight", 10],
    ["bold", 6],
  ],
  masculine: [
    ["natural", 34],
    ["full", 24],
    ["straight", 20],
    ["bold", 16],
    ["arched", 4],
    ["thin", 2],
  ],
  neutral: [
    ["natural", 34],
    ["full", 18],
    ["straight", 18],
    ["arched", 12],
    ["bold", 10],
    ["thin", 8],
  ],
};
const SEED_NOSE: W<NoseShape> = [
  ["broad", 26],
  ["rounded", 26],
  ["wide", 16],
  ["straight", 18],
  ["narrow", 14],
];
const SEED_LIPS: W<LipShape> = [
  ["full", 32],
  ["medium", 28],
  ["wide", 18],
  ["bow", 14],
  ["thin", 8],
];
const SEED_HAIR: Record<BodyType, W<FacialHair>> = {
  feminine: [["none", 1]],
  masculine: [
    ["none", 32],
    ["stubble", 20],
    ["moustache", 8],
    ["goatee", 12],
    ["chinstrap", 6],
    ["short", 12],
    ["full", 4],
    ["shadow", 6],
  ],
  neutral: [
    ["none", 76],
    ["stubble", 12],
    ["shadow", 6],
    ["goatee", 6],
  ],
};
const SEED_MARKS: W<SkinMark> = [
  ["none", 80],
  ["lightFreckles", 6],
  ["freckles", 3],
  ["markCheek", 5],
  ["markLip", 3],
  ["markChin", 3],
];
const SEED_MAKEUP: Record<BodyType, W<Makeup>> = {
  feminine: [
    ["none", 52],
    ["gloss", 22],
    ["berry", 10],
    ["red", 4],
    ["liner", 8],
    ["linerBerry", 4],
  ],
  masculine: [["none", 1]],
  neutral: [
    ["none", 86],
    ["gloss", 10],
    ["liner", 4],
  ],
};

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(list: W<T>, r: number): T {
  const total = list.reduce((s, [, w]) => s + w, 0);
  let x = r * total;
  for (const [v, w] of list) {
    if (x < w) return v;
    x -= w;
  }
  return list[list.length - 1]![0];
}

/**
 * A pleasant, varied default face from a hash of `seed` (the account id, else a stable key of the look), so people
 * who never opened the Face tab still differ. Cosmetic only: a hash, never Math.random.
 */
export function seededFace(seed: string, body: BodyType): FaceLook {
  const r = mulberry32(fnv1a(`face:${seed}`));
  return {
    shape: pick(SEED_SHAPE, r()),
    eyes: pick(SEED_EYES, r()),
    eyeColor: pick(SEED_EYE_COLOR, r()),
    brows: pick(SEED_BROWS[body], r()),
    nose: pick(SEED_NOSE, r()),
    lips: pick(SEED_LIPS, r()),
    facialHair: pick(SEED_HAIR[body], r()),
    marks: pick(SEED_MARKS, r()),
    makeup: pick(SEED_MAKEUP[body], r()),
  };
}
