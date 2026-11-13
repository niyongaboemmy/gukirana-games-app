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

/** Skin tones, deep to light (wide range of African tones first, DESIGN-SPEC §7.1). */
export const SKIN_TONES = ["#3B2219", "#4A2C21", "#5C3A26", "#6E4530", "#8D5524", "#A0662F", "#B97A4A", "#C68642", "#D9A577", "#E8C3A0", "#F1D5BE"];

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
}

export const DEFAULT_OUTFIT: Outfit = { top: "hoodie", bottom: "joggers", shoes: "sneakers", accessory: "none", headwear: "no-hat" };
export const DEFAULT_LOOK: AvatarLook = {
  bodyType: "neutral",
  skinTone: SKIN_TONES[4]!,
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
  return ["1", BODY_CODE[l.bodyType], l.skinTone.slice(1), l.hairStyle, l.hairColor.slice(1), o.top, o.bottom, o.shoes, o.accessory, o.headwear, l.accent.slice(1)].join("|");
}

/** Decodes and validates a look string; anything unknown falls back to defaults (never throws). */
export function decodeLook(s: string | undefined | null, accentFallback: string): AvatarLook {
  const base: AvatarLook = { ...DEFAULT_LOOK, outfit: { ...DEFAULT_OUTFIT }, accent: HEX.test(accentFallback) ? accentFallback : DEFAULT_LOOK.accent };
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
  };
}
