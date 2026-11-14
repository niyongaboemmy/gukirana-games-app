/**
 * World (plaza) UI strings, English catalogue (i18n-ready like admin-block/strings.ts and arena/strings.ts; to move to
 * @gukirana/i18n with the rest).
 */
export const W = {
  /** door of a building that is closed for you */
  closedTitle: (place: string) => `${place} is closed`,
  closedFallback: "Please come back later.",
  closedSign: "CLOSED",
  closedAction: "Closed",
  closedPrompt: (place: string, msg: string) => `${place} is closed${msg ? ` · ${msg}` : ""}`,
  dismiss: "Close",
  enterAction: "Enter",
  enterPrompt: (place: string) => `Enter ${place}`,
} as const;
