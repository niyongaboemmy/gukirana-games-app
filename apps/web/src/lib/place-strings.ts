/**
 * Holding your place strings (P2-NET-06), English catalogue (i18n-ready like match/strings.ts; to move to
 * @gukirana/i18n keys `place.*`). `{place}` / `{s}` / `{t}` are filled in by `pfill()`.
 */
export const PS = {
  "place.table": "Table {n}",
  "place.ring": "Ring {n}",
  "place.released": "Your place at {place} was released after {s} s away.",
  "place.releasedLimit": "Your place at {place} was released right away: too many reloads in a short time.",
  "place.restored": "Welcome back: you still have {place}.",
  "place.held": "Held",
  "place.heldReturning": "Held · returning ({t})",
  "place.heldShort": "Held {t}",
  "place.heldNote": "Kept for a player who lost their connection. It frees in {t}.",
  "place.waited": "waiting {t}",
} as const;
export type PsKey = keyof typeof PS;

export function pfill(key: PsKey, vars: Record<string, string | number> = {}): string {
  let s: string = PS[key];
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** 0:42 / 1:05 */
export const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
