/**
 * P2-AVA-18 campus people realism v2 (docs/QA/human-realism-v2/README.md): small, separately gated fixes, each one
 * shipped only after a side-by-side against main at the same camera and light (face close-up, full body, walking, an
 * action) showed it clearly better with no new defect. Items that did not win stay in the code with their switch off.
 *
 * All of them sit on top of the realistic campus people (realism-flag.ts `campusHumansOn`); with that flag off nothing
 * here applies. Development only: `?hv2=none` (main's people), `?hv2=all` (every item, shipped or held) or
 * `?hv2=hairEdge,marks` (exactly those items) for the comparisons (qa/e2e/human-assess/realism-v2.mjs).
 */
import { campusHumansOn } from "./realism-flag";

export type V2Item =
  /** hair, lashes and hair cards: alpha-to-coverage edges instead of the hashed (speckled) alpha while not fading */
  | "hairEdge"
  /** feminine base blazer: the pocket flaps are the jacket's (they took the trousers' colour), the shirt under it is a
   *  blouse in the top's second colour instead of the jacket colour brightened */
  | "blazer"
  /** beauty marks: small, soft-edged, slightly irregular, warm brown (a crisp black disc read like a sticker) */
  | "marks"
  /** feminine base head: the photo's own pale, blocky brow is cleared; only the drawn strand brow shows */
  | "brows"
  /** women's tee items (tee, white tee, imigongo print top) wear the rebuilt tee garment instead of the baked blazer */
  | "womenTee";

/** Items switched on for everyone (production). Edited only after the quality gate. */
export const V2_SHIPPED: Record<V2Item, boolean> = {
  // held: the speckle goes, but a pale ring shows round afros / short hair and the braid / bun scalp layer blotches
  hairEdge: false,
  blazer: true,
  marks: true,
  brows: true,
  // held: clean edges and underarm now, but the head mesh's jagged lower edge meets the garment's chest skin at the
  // base of the neck (seen in face / torso close-ups from the front, most on the darkest skin tones)
  womenTee: false,
};

const ALL = Object.keys(V2_SHIPPED) as V2Item[];

function devList(): V2Item[] | null {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
  const g = (window as unknown as { __gkHv2?: string }).__gkHv2;
  const q = typeof g === "string" ? g : new URLSearchParams(window.location.search).get("hv2");
  if (q == null) return null;
  if (q === "all") return ALL;
  if (q === "none" || q === "0") return [];
  return q.split(",").filter((x): x is V2Item => (ALL as string[]).includes(x));
}

/** Whether a v2 item applies to people built now (read per person, so a dev override applies on reload). */
export function v2On(item: V2Item): boolean {
  if (!campusHumansOn()) return false;
  const dev = devList();
  return dev ? dev.includes(item) : V2_SHIPPED[item];
}
