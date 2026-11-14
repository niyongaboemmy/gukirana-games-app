/**
 * Default avatar look for accounts that never saved one (P1-WLD-03): a deterministic hash of the user id picks
 * skin tone, hair, outfit and a muted top colour, so new players are not all the same clone.
 *
 * The result uses the web client's compact look encoding (apps/web/src/world/outfits.ts `encodeLook`) and MUST stay
 * identical to `seededLook()` there — apps/web/src/world/outfits.test.ts checks both produce the same string.
 * Cosmetic only (not game or money randomness): no RNG, just FNV-1a + mulberry32 over the id.
 */
type Body = "feminine" | "masculine" | "neutral";
type W<T> = readonly (readonly [T, number])[];

export const SEED_SKIN: W<string> = [
  ["3B2219", 1],
  ["4A2C21", 3],
  ["5C3A26", 4],
  ["6E4530", 4],
  ["85562C", 3],
  ["986637", 3],
  ["B97A4A", 1],
  ["BC864C", 1],
];
export const SEED_TOP_COLORS = [
  "2E3A46",
  "5B4636",
  "7A2E2E",
  "2F5D50",
  "C9B79C",
  "3B3B3B",
  "8C6A2F",
  "4A4E69",
  "F0EDE6",
  "6B705C",
  "A44A3F",
  "1F4E79",
] as const;
const BODY: W<Body> = [
  ["feminine", 45],
  ["masculine", 45],
  ["neutral", 10],
];
const HAIR: Record<Body, W<string>> = {
  feminine: [
    ["braids", 18],
    ["puffs", 10],
    ["afro", 12],
    ["bun", 12],
    ["locs", 10],
    ["cornrows", 10],
    ["headwrap", 10],
    ["short", 12],
    ["fade", 3],
    ["bald", 3],
    ["cornrowbun", 10],
    ["braidtail", 10],
    ["twists", 6],
    ["shortlocs", 3],
  ],
  masculine: [
    ["short", 30],
    ["fade", 25],
    ["bald", 10],
    ["afro", 8],
    ["locs", 10],
    ["cornrows", 10],
    ["braids", 4],
    ["bun", 1],
    ["puffs", 1],
    ["headwrap", 1],
    ["lowfade", 18],
    ["buzz", 6],
    ["waves", 5],
    ["twists", 4],
    ["shortlocs", 4],
    ["hightop", 2],
  ],
  neutral: [
    ["short", 16],
    ["fade", 12],
    ["afro", 12],
    ["locs", 12],
    ["cornrows", 10],
    ["braids", 10],
    ["bun", 8],
    ["puffs", 6],
    ["headwrap", 6],
    ["bald", 8],
    ["lowfade", 6],
    ["buzz", 4],
    ["waves", 3],
    ["twists", 4],
    ["shortlocs", 3],
    ["hightop", 2],
    ["cornrowbun", 3],
    ["braidtail", 3],
  ],
};
const HAIR_COLOR: W<string> = [
  ["141010", 45],
  ["2a1a12", 30],
  ["4a2d1c", 12],
  ["7a4a26", 5],
  ["b07a3e", 2],
  ["d9c27a", 1],
  ["8a8a8a", 4],
  ["5a2a6e", 1],
];
const TOP: Record<Body, W<string>> = {
  feminine: [
    ["tee", 24],
    ["hoodie", 16],
    ["track", 7],
    ["kitenge-sun", 8],
    ["kitenge-leaf", 8],
    ["tee-white", 8],
    ["jersey", 6],
    ["blazer-cream", 6],
    ["imigongo-top", 4],
    ["mushanana", 3],
  ],
  masculine: [
    ["tee", 26],
    ["hoodie", 18],
    ["track", 8],
    ["kitenge-sun", 7],
    ["kitenge-leaf", 7],
    ["tee-white", 8],
    ["jersey", 9],
    ["blazer", 6],
    ["imigongo-top", 4],
  ],
  neutral: [
    ["tee", 26],
    ["hoodie", 18],
    ["track", 8],
    ["kitenge-sun", 7],
    ["kitenge-leaf", 7],
    ["tee-white", 8],
    ["jersey", 8],
    ["blazer", 3],
    ["blazer-cream", 3],
    ["imigongo-top", 4],
  ],
};
const BOTTOM: Record<Body, W<string>> = {
  feminine: [
    ["jeans", 30],
    ["chinos", 20],
    ["skirt-kitenge", 25],
    ["skirt", 15],
    ["wrap-mushanana", 5],
    ["joggers", 5],
  ],
  masculine: [
    ["jeans", 50],
    ["chinos", 35],
    ["joggers", 10],
    ["shorts", 5],
  ],
  neutral: [
    ["jeans", 45],
    ["chinos", 35],
    ["joggers", 10],
    ["skirt-kitenge", 10],
  ],
};
const SHOES: W<string> = [
  ["sneakers", 40],
  ["runners", 15],
  ["boots", 15],
  ["loafers", 15],
  ["sandals", 15],
];
const ACC: Record<Body, W<string>> = {
  feminine: [
    ["none", 58],
    ["glasses", 12],
    ["sunglasses", 6],
    ["watch", 10],
    ["earrings", 14],
  ],
  masculine: [
    ["none", 66],
    ["glasses", 14],
    ["sunglasses", 6],
    ["watch", 14],
  ],
  neutral: [
    ["none", 62],
    ["glasses", 14],
    ["sunglasses", 6],
    ["watch", 12],
    ["earrings", 6],
  ],
};
const HAT: W<string> = [
  ["no-hat", 75],
  ["cap", 11],
  ["beanie", 7],
  ["bucket", 7],
];
const BODY_CODE: Record<Body, string> = { feminine: "f", masculine: "m", neutral: "n" };
/** Age range (P2-AVA-11, adults only: 18–30 · 31–50 · 50+); most people are young adults. */
type Age = "young" | "adult" | "senior";
const AGE: W<Age> = [
  ["young", 62],
  ["adult", 26],
  ["senior", 12],
];
const AGE_DIGIT: Record<Age, string> = { young: "0", adult: "1", senior: "2" };
/** Hair styles by age (the adult columns of the art-direction board): close crops and updos at 31–50, a short grey crop or a headwrap at 50+. */
const AGED_HAIR: Record<Exclude<Age, "young">, Record<Body, W<string>>> = {
  adult: {
    feminine: [
      ["bun", 30],
      ["cornrowbun", 26],
      ["twists", 14],
      ["braids", 12],
      ["braidtail", 10],
      ["headwrap", 8],
    ],
    masculine: [
      ["short", 34],
      ["lowfade", 22],
      ["buzz", 22],
      ["bald", 12],
      ["fade", 10],
    ],
    neutral: [
      ["short", 30],
      ["buzz", 20],
      ["bun", 15],
      ["cornrowbun", 15],
      ["bald", 10],
      ["twists", 10],
    ],
  },
  senior: {
    feminine: [
      ["headwrap", 56],
      ["short", 16],
      ["bun", 16],
      ["cornrowbun", 12],
    ],
    masculine: [
      ["short", 44],
      ["buzz", 30],
      ["bald", 26],
    ],
    neutral: [
      ["short", 40],
      ["buzz", 25],
      ["headwrap", 20],
      ["bald", 15],
    ],
  },
};
/** Grey / white hair at 50+ (drawn as silver strands). */
const SENIOR_HAIR_COLOR: W<string> = [
  ["b4b0aa", 46],
  ["e6e4e0", 30],
  ["8a8a8a", 24],
];

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

/** Encoded default look for `seed` (the user id). `body` = the player's chosen body type, if any. */
export function defaultLookCode(seed: string, accent: string, body?: Body | null): string {
  const r = mulberry32(fnv1a(`look:${seed}`));
  const rolledBody = pick(BODY, r());
  const b: Body = body ?? rolledBody;
  const skin = pick(SEED_SKIN, r());
  let hair = pick(HAIR[b], r());
  let hairColor = pick(HAIR_COLOR, r());
  const top = pick(TOP[b], r());
  const topColor = SEED_TOP_COLORS[Math.floor(r() * SEED_TOP_COLORS.length)]!;
  const bottom = pick(BOTTOM[b], r());
  const shoes = pick(SHOES, r());
  let acc = pick(ACC[b], r());
  let hat = pick(HAT, r());
  if (hair === "headwrap") hat = "no-hat";
  // age (P2-AVA-11): rolled after everything else, so young people keep exactly the look they had before
  const age = pick(AGE, r());
  const ageR = [r(), r(), r()] as const;
  if (age !== "young") {
    hair = pick(AGED_HAIR[age][b], ageR[0]);
    if (age === "senior") {
      hairColor = pick(SENIOR_HAIR_COLOR, ageR[1]);
      if (b !== "masculine" && ageR[2] < 0.55) acc = "glasses";
    }
    if (hair === "headwrap") hat = "no-hat";
  }
  const a = /^#[0-9a-fA-F]{6}$/.test(accent) ? accent.slice(1) : "2F80ED";
  const f = ["1", BODY_CODE[b], skin, hair, hairColor, top, bottom, shoes, acc, hat, a, topColor];
  if (age !== "young") f.push(`A=1${AGE_DIGIT[age]}`);
  return f.join("|");
}

/** Saved look, or (accounts created before looks were assigned) the deterministic default for this id. */
export function lookOf(u: { id: string; look: string | null; color: string; bodyType: string }): string {
  if (u.look) return u.look;
  const body = u.bodyType === "feminine" || u.bodyType === "masculine" ? u.bodyType : null;
  return defaultLookCode(u.id, u.color, body);
}
