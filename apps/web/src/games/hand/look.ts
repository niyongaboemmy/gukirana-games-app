import { decodeLook, itemById, LEGACY_SKIN, seededLook, type AvatarLook, type TopKind } from "@/world/outfits";
import type { PrintId } from "@/world/textures";

/**
 * What the game hand wears (P2-GAME-07): the player's own skin tone and the sleeve of their avatar's top, so the hand
 * on the board is recognisably theirs. Opponents use their look code when known, else the same deterministic seeded
 * look the world gives them (outfits.seededLook — no randomness).
 */
export interface HandLook {
  /** skin tone, sRGB hex */
  skin: string;
  /** sleeve cut at the forearm: ribbed cuff, shirt cuff, roomy blazer, short sleeve (hem above the elbow), bare */
  sleeve: "rib" | "cuff" | "blazer" | "short" | "none";
  sleeveColor: string;
  print?: PrintId;
}

const SLEEVE: Record<TopKind, HandLook["sleeve"]> = { hoodie: "rib", longsleeve: "rib", tee: "short", jersey: "short", blazer: "blazer", shirt: "cuff", sash: "none" };

export function handLookOf(look: AvatarLook): HandLook {
  const top = itemById(look.outfit.top);
  const kind = (top?.kind ?? "hoodie") as TopKind;
  const c = top?.color ?? "#3a3a3a";
  const color = c === "accent" ? (look.topColor ?? look.accent) : c;
  return {
    skin: LEGACY_SKIN[look.skinTone.toUpperCase()] ?? look.skinTone,
    sleeve: SLEEVE[kind] ?? "rib",
    sleeveColor: color,
    ...(top?.print ? { print: top.print } : {}),
  };
}

/** An opponent's hand: their look code if the game knows it, else their seeded default look. */
export function opponentHandLook(id: string, lookCode?: string | null, accent = "#5B4636"): HandLook {
  return handLookOf(lookCode ? decodeLook(lookCode, accent, id) : seededLook(id, accent));
}
