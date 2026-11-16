/**
 * P2-AVA-12 feature flags (docs/CAMPUS-HUMAN-REALISM.md):
 *  - NEXT_PUBLIC_FF_CAMPUS_HUMANS (default on; "0" = the P2-AVA-11 people as before): the realistic campus people —
 *    real eyeballs, skin detail / roughness breakup / thin-part transmission, fabric weave and sheen, caps that sit
 *    right with the hair pressed under them, expressions for the emotes, leaning into turns, start / stop settling,
 *    reactions (bumps, surprise, disappointment), the jump;
 *  - NEXT_PUBLIC_FF_JUMP (default on; "0" hides it): the Jump control (Space / the Jump button) for your own avatar.
 * In development `?people=v1` (or `window.__gkCampusHumans = false` before the scene loads) shows the old people for a
 * side-by-side comparison.
 */
const env = process.env.NEXT_PUBLIC_FF_CAMPUS_HUMANS !== "0";

function devOverride(): boolean | null {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
  const g = (window as unknown as { __gkCampusHumans?: boolean }).__gkCampusHumans;
  if (typeof g === "boolean") return g;
  const q = new URLSearchParams(window.location.search).get("people");
  return q === "v1" ? false : q === "v2" ? true : null;
}

/** The realistic campus people are on (read at build time of each person, so a dev override applies on reload). */
export function campusHumansOn(): boolean {
  return devOverride() ?? env;
}

/**
 * Development only: switch single parts of the realistic people off to measure their cost (`?rhoff=sheen,motion,eyes,
 * detail`, qa/e2e/human-assess/crowd-perf.mjs). Always true in production.
 */
export function campusPart(part: "sheen" | "motion" | "eyes" | "detail"): boolean {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return true;
  const off = new URLSearchParams(window.location.search).get("rhoff");
  return !off || !off.split(",").includes(part);
}

/** The Jump control is offered (and the jump plays for everyone who has the realistic people on). */
export const JUMP_ON = process.env.NEXT_PUBLIC_FF_JUMP !== "0";
