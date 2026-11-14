import type { BodyType } from "./outfits";

/**
 * Age range of an avatar (P2-AVA-11). ADULTS ONLY: the platform is 18+ (SRS SAFE-01 / FR-ACC-05), so there is no
 * child or teen look: an adult account showing up as a child in a social space with chat, voice and calls would be a
 * safeguarding risk. Three ranges, after the adult columns of the art-direction board:
 *   young  18–30 (default) · adult 31–50 · senior 50+
 *
 * Rendered without extra meshes: the head shader paints the lines and greys the hair / beard (materials.ts, hair.ts),
 * the face bones fill the face out a little (face-rig.ts) and a senior carries the neck and shoulders a touch forward
 * (Avatar.tsx). Wire format: an optional `A=` + version digit + age digit token in the look code (e.g. `A=11`),
 * written only for adult / senior; codes without it (all older codes) decode as young. Older clients ignore it (it is
 * never a valid hex top colour nor a face token).
 */
export const AGE_GROUPS = ["young", "adult", "senior"] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];
export const DEFAULT_AGE: AgeGroup = "young";

export const AGE_VERSION = "1";
const TOKEN = /^A=(\d)(\d)$/;

/** Token for the look code, or null for the default (young) so older codes stay byte-identical. */
export function encodeAge(a: AgeGroup | undefined): string | null {
  const i = AGE_GROUPS.indexOf(a ?? DEFAULT_AGE);
  return i > 0 ? `A=${AGE_VERSION}${i}` : null;
}

/** Age of a split look code (the token may sit anywhere after the fixed fields); young when absent or unknown. */
export function decodeAge(parts: readonly string[]): AgeGroup {
  for (let i = 11; i < parts.length; i++) {
    const m = TOKEN.exec(parts[i]!);
    if (m && m[1] === AGE_VERSION) return AGE_GROUPS[Number(m[2])] ?? DEFAULT_AGE;
  }
  return DEFAULT_AGE;
}

export interface AgeParams {
  /** painted expression lines: forehead, laugh lines, under-eye creases, crow's feet (0 … 1) */
  lines: number;
  /** how much of the base photo's own baked creases is smoothed away (1 = young, even skin) */
  smooth: number;
  /** skin texture: a little more visible pores / unevenness with age (0 … 1) */
  texture: number;
  /** share of silver hairs added at the temples and sides (scalp) */
  templeGrey: number;
  /** share of silver hairs added all over the scalp */
  scalpGrey: number;
  /** share of silver hairs added to the beard / moustache / brows */
  beardGrey: number;
  /** receding temples (hair.ts uHStyle.z), close styles only */
  recede: number;
  /** fuller face: cheeks out / jaw a touch wider (0 … 1) */
  fuller: number;
  /** posture: forward lean of the neck and upper back (rad) */
  stoop: number;
}

const BASE: Record<AgeGroup, AgeParams> = {
  young: { lines: 0, smooth: 1, texture: 0, templeGrey: 0, scalpGrey: 0, beardGrey: 0, recede: 0, fuller: 0, stoop: 0 },
  adult: { lines: 0.42, smooth: 0.55, texture: 0.35, templeGrey: 0.34, scalpGrey: 0.06, beardGrey: 0.22, recede: 0.45, fuller: 1, stoop: 0 },
  senior: { lines: 1, smooth: 0.15, texture: 0.7, templeGrey: 0.75, scalpGrey: 0.5, beardGrey: 0.7, recede: 0.85, fuller: 0.6, stoop: 0.07 },
};

/**
 * Ageing parameters for an age range and body. Receding temples are a masculine trait (a little on neutral bodies,
 * none on feminine ones); everything else applies to everyone. Pure: same input, same output (tests).
 */
export function ageParams(age: AgeGroup | undefined, body: BodyType): AgeParams {
  const p = { ...(BASE[age ?? DEFAULT_AGE] ?? BASE.young) };
  p.recede *= body === "masculine" ? 1 : body === "neutral" ? 0.5 : 0;
  // (31–50 on the feminine body: little visible grey yet, as on the board; at 50+ the full amount)
  if (body === "feminine" && age === "adult") {
    p.templeGrey *= 0.35;
    p.scalpGrey *= 0.3;
  }
  return p;
}
