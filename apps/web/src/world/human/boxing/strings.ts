/**
 * Boxing lab strings, English catalogue (i18n-ready like rooms/strings.ts; to move to @gukirana/i18n keys `boxing.*`).
 * The lab is a dev-only page; clip names are identifiers and stay untranslated.
 */
export const BX = {
  loading: "Lacing the gloves…",
  lab: "Boxing lab",
  clip: "Clip",
  time: "t",
  paused: "paused",
  playing: "playing",
  drawCalls: "draw calls",
  triangles: "triangles",
  rings: "rings",
  near: "near",
  far: "far",
  culled: "culled",
  notAvailable: "The boxing lab is only available in development builds.",
} as const;
