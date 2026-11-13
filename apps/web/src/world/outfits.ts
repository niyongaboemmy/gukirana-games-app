import type { PrintId } from "./textures";

/**
 * Avatar look + outfit catalogue (DESIGN-SPEC §7.1–7.2).
 * The body type is ALWAYS chosen by the player and never inferred from a name, phone number or anything else.
 * Items carry `suggestedFor` tags only to order and filter the picker; any player may wear any item.
 */
export type BodyType = "feminine" | "masculine" | "neutral";
export const BODY_TYPES: { id: BodyType; label: string }[] = [
  { id: "feminine", label: "Feminine" },
  { id: "neutral", label: "Neutral" },
  { id: "masculine", label: "Masculine" },
];
export const BODY_TYPE_HINT: Record<BodyType, string> = {
  feminine: "Narrower shoulders, curvier hips",
  neutral: "Balanced proportions",
  masculine: "Broader shoulders, straighter hips",
};

/** Skin tones, deep to light (wide range of African tones first, DESIGN-SPEC §7.1). The mid tones are ~15% less saturated than the old "spray-tan" values. */
export const SKIN_TONES = ["#3B2219", "#4A2C21", "#5C3A26", "#6E4530", "#85562C", "#986637", "#B97A4A", "#BC864C", "#D9A577", "#E8C3A0", "#F1D5BE"];
/** Saved looks may still carry the old over-saturated tones: map them to their replacements when rendering. */
export const LEGACY_SKIN: Record<string, string> = { "#8D5524": "#85562C", "#A0662F": "#986637", "#C68642": "#BC864C" };

export type HairStyle = "short" | "fade" | "afro" | "puffs" | "braids" | "locs" | "bun" | "cornrows" | "headwrap" | "bald";
export const HAIR_STYLES: { id: HairStyle; label: string }[] = [
  { id: "short", label: "Short" },
  { id: "fade", label: "Fade" },
  { id: "afro", label: "Afro" },
  { id: "puffs", label: "Afro puffs" },
  { id: "braids", label: "Box braids" },
  { id: "locs", label: "Locs" },
  { id: "bun", label: "Bun" },
  { id: "cornrows", label: "Cornrows" },
  { id: "headwrap", label: "Headwrap (igitambaro)" },
  { id: "bald", label: "Bald" },
];
export const HAIR_COLORS = ["#141010", "#2a1a12", "#4a2d1c", "#7a4a26", "#b07a3e", "#d9c27a", "#8a8a8a", "#5a2a6e"];

export type Slot = "top" | "bottom" | "shoes" | "accessory" | "headwear";
export type ItemStyle = "casual" | "sport" | "smart" | "traditional" | "street";

export type TopKind = "tee" | "longsleeve" | "hoodie" | "jersey" | "blazer" | "shirt" | "sash";
export type BottomKind = "trousers" | "joggers" | "shorts" | "skirt" | "longwrap";
export type ShoeKind = "sneakers" | "boots" | "sandals" | "loafers";
export type AccessoryKind = "none" | "headset" | "glasses" | "sunglasses" | "earrings" | "watch";
export type HeadwearKind = "none" | "cap" | "beanie" | "bucket";

export interface OutfitItem {
  id: string;
  slot: Slot;
  label: string;
  style: ItemStyle;
  suggestedFor: BodyType[];
  kind: TopKind | BottomKind | ShoeKind | AccessoryKind | HeadwearKind;
  /** "accent" = the player's chosen colour. */
  color: string;
  color2?: string;
  print?: PrintId;
}

const ALL: BodyType[] = ["feminine", "masculine", "neutral"];

export const OUTFITS: OutfitItem[] = [
  // tops
  { id: "hoodie", slot: "top", label: "Hoodie", style: "casual", suggestedFor: ALL, kind: "hoodie", color: "accent" },
  { id: "tee", slot: "top", label: "T-shirt", style: "casual", suggestedFor: ALL, kind: "tee", color: "accent" },
  { id: "tee-white", slot: "top", label: "White tee", style: "casual", suggestedFor: ALL, kind: "tee", color: "#f2f2f0" },
  { id: "jersey", slot: "top", label: "Sport jersey", style: "sport", suggestedFor: ALL, kind: "jersey", color: "accent", color2: "#ffffff" },
  { id: "track", slot: "top", label: "Track top", style: "sport", suggestedFor: ALL, kind: "longsleeve", color: "#1c1f2e", color2: "accent" },
  { id: "blazer", slot: "top", label: "Blazer", style: "smart", suggestedFor: ["masculine", "neutral"], kind: "blazer", color: "#22266E", color2: "#f4f4f4" },
  { id: "blazer-cream", slot: "top", label: "Cream blazer", style: "smart", suggestedFor: ["feminine", "neutral"], kind: "blazer", color: "#e8dcc6", color2: "#1b1b1b" },
  { id: "kitenge-sun", slot: "top", label: "Kitenge shirt (sun)", style: "traditional", suggestedFor: ALL, kind: "shirt", color: "#ffffff", print: "kitenge-sun" },
  { id: "kitenge-leaf", slot: "top", label: "Kitenge shirt (leaf)", style: "traditional", suggestedFor: ALL, kind: "shirt", color: "#ffffff", print: "kitenge-leaf" },
  { id: "imigongo-top", slot: "top", label: "Imigongo print top", style: "traditional", suggestedFor: ALL, kind: "tee", color: "#ffffff", print: "imigongo-cloth" },
  { id: "mushanana", slot: "top", label: "Umushanana-inspired sash", style: "traditional", suggestedFor: ["feminine", "neutral"], kind: "sash", color: "#f3e3c3", color2: "#C8952F", print: "mushanana-gold" },
  { id: "sash-wave", slot: "top", label: "Kitenge sash (wave)", style: "traditional", suggestedFor: ALL, kind: "sash", color: "#f4efe6", color2: "#1F3C88", print: "kitenge-wave" },
  // bottoms
  { id: "jeans", slot: "bottom", label: "Jeans", style: "casual", suggestedFor: ALL, kind: "trousers", color: "#2b3a5c" },
  { id: "joggers", slot: "bottom", label: "Joggers", style: "sport", suggestedFor: ALL, kind: "joggers", color: "#2b2f45" },
  { id: "shorts", slot: "bottom", label: "Sport shorts", style: "sport", suggestedFor: ALL, kind: "shorts", color: "#1c1f2e" },
  { id: "chinos", slot: "bottom", label: "Chinos", style: "smart", suggestedFor: ALL, kind: "trousers", color: "#b49a74" },
  { id: "skirt", slot: "bottom", label: "A-line skirt", style: "smart", suggestedFor: ["feminine", "neutral"], kind: "skirt", color: "#22266E" },
  { id: "skirt-kitenge", slot: "bottom", label: "Kitenge skirt", style: "traditional", suggestedFor: ["feminine", "neutral"], kind: "skirt", color: "#ffffff", print: "kitenge-sun" },
  { id: "wrap-mushanana", slot: "bottom", label: "Umushanana-inspired wrap", style: "traditional", suggestedFor: ["feminine", "neutral"], kind: "longwrap", color: "#ffffff", print: "mushanana-gold" },
  { id: "wrap-leaf", slot: "bottom", label: "Kitenge long wrap", style: "traditional", suggestedFor: ALL, kind: "longwrap", color: "#ffffff", print: "kitenge-leaf" },
  // shoes
  { id: "sneakers", slot: "shoes", label: "Sneakers", style: "casual", suggestedFor: ALL, kind: "sneakers", color: "#f4f4f4", color2: "accent" },
  { id: "runners", slot: "shoes", label: "Runners", style: "sport", suggestedFor: ALL, kind: "sneakers", color: "#1b1b1b", color2: "#FFC83D" },
  { id: "boots", slot: "shoes", label: "Boots", style: "street", suggestedFor: ALL, kind: "boots", color: "#4a3122" },
  { id: "loafers", slot: "shoes", label: "Loafers", style: "smart", suggestedFor: ALL, kind: "loafers", color: "#2a1a12" },
  { id: "sandals", slot: "shoes", label: "Sandals", style: "traditional", suggestedFor: ALL, kind: "sandals", color: "#7a4a26" },
  // accessories
  { id: "none", slot: "accessory", label: "None", style: "casual", suggestedFor: ALL, kind: "none", color: "#000000" },
  { id: "glasses", slot: "accessory", label: "Glasses", style: "smart", suggestedFor: ALL, kind: "glasses", color: "#1b1b1b" },
  { id: "sunglasses", slot: "accessory", label: "Sunglasses", style: "street", suggestedFor: ALL, kind: "sunglasses", color: "#111111" },
  { id: "earrings", slot: "accessory", label: "Gold earrings", style: "smart", suggestedFor: ["feminine", "neutral"], kind: "earrings", color: "#FFC83D" },
  { id: "watch", slot: "accessory", label: "Smart watch", style: "sport", suggestedFor: ALL, kind: "watch", color: "#1b1b1b", color2: "accent" },
  // headwear
  { id: "no-hat", slot: "headwear", label: "None", style: "casual", suggestedFor: ALL, kind: "none", color: "#000000" },
  { id: "cap", slot: "headwear", label: "Cap", style: "sport", suggestedFor: ALL, kind: "cap", color: "accent" },
  { id: "beanie", slot: "headwear", label: "Beanie", style: "street", suggestedFor: ALL, kind: "beanie", color: "#B5532A" },
  { id: "bucket", slot: "headwear", label: "Bucket hat", style: "street", suggestedFor: ALL, kind: "bucket", color: "#e8dcc6" },
];

export const itemById = (id: string): OutfitItem | undefined => OUTFITS.find((o) => o.id === id);

export interface Outfit {
  top: string;
  bottom: string;
  shoes: string;
  accessory: string;
  headwear: string;
}

export interface AvatarLook {
  bodyType: BodyType;
  skinTone: string;
  hairStyle: HairStyle;
  hairColor: string;
  outfit: Outfit;
  /** Player's accent colour (the existing profile `color`). */
  accent: string;
  /** Optional colour for "accent"-coloured tops and caps (default looks use a muted palette); unset = accent. */
  topColor?: string;
}

export const DEFAULT_OUTFIT: Outfit = { top: "hoodie", bottom: "joggers", shoes: "sneakers", accessory: "none", headwear: "no-hat" };
export const DEFAULT_LOOK: AvatarLook = {
  bodyType: "neutral",
  skinTone: SKIN_TONES[3]!,
  hairStyle: "short",
  hairColor: HAIR_COLORS[0]!,
  outfit: DEFAULT_OUTFIT,
  accent: "#2F80ED",
};

/** Items for a slot, suggested ones first; with `showAll` false only suggested items (+ the current one) are listed. */
export function itemsFor(slot: Slot, body: BodyType, showAll: boolean, current?: string): { item: OutfitItem; suggested: boolean }[] {
  return OUTFITS.filter((o) => o.slot === slot)
    .map((item) => ({ item, suggested: item.suggestedFor.includes(body) }))
    .filter((x) => showAll || x.suggested || x.item.id === current)
    .sort((a, b) => Number(b.suggested) - Number(a.suggested));
}

/* ---------- compact wire encoding for the realtime `look` field (≤ 90 chars, "|"-separated: the API allows [\w.:;,|#=-]) ---------- */
const BODY_CODE: Record<BodyType, string> = { feminine: "f", masculine: "m", neutral: "n" };
const HEX = /^#[0-9a-fA-F]{6}$/;

export function encodeLook(l: AvatarLook): string {
  const o = l.outfit;
  const f = ["1", BODY_CODE[l.bodyType], l.skinTone.slice(1), l.hairStyle, l.hairColor.slice(1), o.top, o.bottom, o.shoes, o.accessory, o.headwear, l.accent.slice(1)];
  if (l.topColor && HEX.test(l.topColor)) f.push(l.topColor.slice(1));
  return f.join("|");
}

/**
 * Decodes and validates a look string; anything unknown falls back to defaults (never throws).
 * With `seed` (a user or session id) a missing / invalid look becomes that person's deterministic default look.
 */
export function decodeLook(s: string | undefined | null, accentFallback: string, seed?: string): AvatarLook {
  const accent = HEX.test(accentFallback) ? accentFallback : DEFAULT_LOOK.accent;
  const base: AvatarLook = seed ? seededLook(seed, accent) : { ...DEFAULT_LOOK, outfit: { ...DEFAULT_OUTFIT }, accent };
  if (!s || s.length > 160) return base;
  const p = s.split(/[|~]/);
  if (p[0] !== "1" || p.length < 11) return base;
  const body = (Object.keys(BODY_CODE) as BodyType[]).find((k) => BODY_CODE[k] === p[1]);
  const hex = (v: string | undefined, d: string) => (v && HEX.test(`#${v}`) ? `#${v}` : d);
  const slotItem = (slot: Slot, id: string | undefined, d: string) => (id && itemById(id)?.slot === slot ? id : d);
  return {
    bodyType: body ?? base.bodyType,
    skinTone: hex(p[2], base.skinTone),
    hairStyle: HAIR_STYLES.some((h) => h.id === p[3]) ? (p[3] as HairStyle) : base.hairStyle,
    hairColor: hex(p[4], base.hairColor),
    outfit: {
      top: slotItem("top", p[5], DEFAULT_OUTFIT.top),
      bottom: slotItem("bottom", p[6], DEFAULT_OUTFIT.bottom),
      shoes: slotItem("shoes", p[7], DEFAULT_OUTFIT.shoes),
      accessory: slotItem("accessory", p[8], DEFAULT_OUTFIT.accessory),
      headwear: slotItem("headwear", p[9], DEFAULT_OUTFIT.headwear),
    },
    accent: hex(p[10], base.accent),
    ...(p[11] && HEX.test(`#${p[11]}`) ? { topColor: `#${p[11]}` } : {}),
  };
}

/* ---------- deterministic default look per person (P1-WLD-03) ---------- */
/**
 * A varied default look from a hash of `seed` (the user id): skin, hair, outfit and a muted top colour, so new
 * players are not all the same clone. Mirrors apps/api/src/modules/identity/default-look.ts (which assigns the
 * same look server-side at sign-up); outfits.test.ts keeps the two identical. Cosmetic only: no Math.random.
 * `body` = the player's own body-type choice when known (body type is never inferred from anything else).
 */
export function seededLook(seed: string, accent: string, body?: BodyType | null): AvatarLook {
  return decodeLook(defaultLookCode(seed, accent, body), accent);
}

type W<T> = readonly (readonly [T, number])[];
const SEED_SKIN: W<string> = [
  ["3B2219", 1],
  ["4A2C21", 3],
  ["5C3A26", 4],
  ["6E4530", 4],
  ["85562C", 3],
  ["986637", 3],
  ["B97A4A", 1],
  ["BC864C", 1],
];
export const SEED_TOP_COLORS = ["2E3A46", "5B4636", "7A2E2E", "2F5D50", "C9B79C", "3B3B3B", "8C6A2F", "4A4E69", "F0EDE6", "6B705C", "A44A3F", "1F4E79"] as const;
const SEED_BODY: W<BodyType> = [
  ["feminine", 45],
  ["masculine", 45],
  ["neutral", 10],
];
const SEED_HAIR: Record<BodyType, W<HairStyle>> = {
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
  ],
};
const SEED_HAIR_COLOR: W<string> = [
  ["141010", 45],
  ["2a1a12", 30],
  ["4a2d1c", 12],
  ["7a4a26", 5],
  ["b07a3e", 2],
  ["d9c27a", 1],
  ["8a8a8a", 4],
  ["5a2a6e", 1],
];
const SEED_TOP: Record<BodyType, W<string>> = {
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
const SEED_BOTTOM: Record<BodyType, W<string>> = {
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
const SEED_SHOES: W<string> = [
  ["sneakers", 40],
  ["runners", 15],
  ["boots", 15],
  ["loafers", 15],
  ["sandals", 15],
];
const SEED_ACC: Record<BodyType, W<string>> = {
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
const SEED_HAT: W<string> = [
  ["no-hat", 75],
  ["cap", 11],
  ["beanie", 7],
  ["bucket", 7],
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

/** Encoded default look (same string as the API's `defaultLookCode`). */
export function defaultLookCode(seed: string, accent: string, body?: BodyType | null): string {
  const r = mulberry32(fnv1a(`look:${seed}`));
  const rolledBody = pick(SEED_BODY, r());
  const b: BodyType = body ?? rolledBody;
  const skin = pick(SEED_SKIN, r());
  const hair = pick(SEED_HAIR[b], r());
  const hairColor = pick(SEED_HAIR_COLOR, r());
  const top = pick(SEED_TOP[b], r());
  const topColor = SEED_TOP_COLORS[Math.floor(r() * SEED_TOP_COLORS.length)]!;
  const bottom = pick(SEED_BOTTOM[b], r());
  const shoes = pick(SEED_SHOES, r());
  const acc = pick(SEED_ACC[b], r());
  let hat = pick(SEED_HAT, r());
  if (hair === "headwrap") hat = "no-hat";
  const a = HEX.test(accent) ? accent.slice(1) : "2F80ED";
  return ["1", BODY_CODE[b], skin, hair, hairColor, top, bottom, shoes, acc, hat, a, topColor].join("|");
}
