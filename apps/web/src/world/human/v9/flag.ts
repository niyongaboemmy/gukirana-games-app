/**
 * P2-AVA-13 feature flag (docs/design/human-v9/README.md): NEXT_PUBLIC_FF_HUMANS_V9 = "1" puts the v9 people (real
 * 3D-scanned, clothed adults with retargeted CMU motion capture, built by apps/web/scripts/human-v9/run.mjs) on the
 * campus as ambient people instead of the code-built ones. Default OFF: the live game is unchanged, and with the flag
 * off nothing of v9 is loaded.
 *
 * The scans are third-party files (CC BY 4.0) that are not in the repository: the runtime reads them from
 * /assets/characters/_v9humans/ (git-ignored, filled by `run.mjs --publish`). If that folder has no manifest the
 * campus keeps the current people even with the flag on.
 *
 * In development `?humans=v9` (or `window.__gkHumansV9 = true` before the scene loads) turns it on for one page.
 */
const env = process.env.NEXT_PUBLIC_FF_HUMANS_V9 === "1";

function devOverride(): boolean | null {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
  const g = (window as unknown as { __gkHumansV9?: boolean }).__gkHumansV9;
  if (typeof g === "boolean") return g;
  const q = new URLSearchParams(window.location.search).get("humans");
  return q === "v9" ? true : q === "v1" ? false : null;
}

/** The v9 scanned people are on (the env flag, or the development override). */
export function humansV9On(): boolean {
  return devOverride() ?? env;
}

/** Where the published v9 people live (git-ignored; see run.mjs --publish). */
export const V9_BASE = "/assets/characters/_v9humans/";
