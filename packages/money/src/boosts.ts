/**
 * Practice boosts (P3-FGT-09): the "corner refresh" in a practice fight against the AI — water, towel and the coach,
 * restoring some stamina once per round, paid in Stars (the practice currency, no cash value).
 *
 * Fairness: a boost is NEVER allowed in a fight against another player (friendly or staked): there the only recovery
 * is the real corner between rounds, the same for both. The engine stays the only judge of every punch; the boost is
 * applied to the local practice engine only after the API confirmed the spend.
 *
 * The price lives here only (plan §4.3: fees and prices come from packages/money). Proposed default, to be confirmed.
 */
export const CORNER_REFRESH_PRICE_STARS = 20;
/** stamina restored (engine scale 0…1000) */
export const CORNER_REFRESH_STAMINA = 300;
/** refreshes per round of one practice fight */
export const CORNER_REFRESH_PER_ROUND = 1;

export type BoostFightMode = "practice" | "live";

export type BoostRefusal = "NOT_PRACTICE" | "NO_ROUND" | "USED_THIS_ROUND" | "NOT_ENOUGH_STARS";

/** may a corner refresh be bought right now? (pure; the API checks it again before posting) */
export function cornerRefreshRefusal(input: { mode: BoostFightMode; round: number; usedThisRound: number; stars: number }): BoostRefusal | null {
  if (input.mode !== "practice") return "NOT_PRACTICE";
  if (!Number.isSafeInteger(input.round) || input.round < 1) return "NO_ROUND";
  if (input.usedThisRound >= CORNER_REFRESH_PER_ROUND) return "USED_THIS_ROUND";
  if (!Number.isSafeInteger(input.stars) || input.stars < CORNER_REFRESH_PRICE_STARS) return "NOT_ENOUGH_STARS";
  return null;
}

/** the stamina after a refresh (capped at full) */
export const refreshedStamina = (stamina: number): number => Math.min(1000, Math.max(0, Math.trunc(stamina)) + CORNER_REFRESH_STAMINA);

/** the ledger idempotency key of one refresh: one per practice fight and round, whatever the client sends twice */
export const cornerRefreshKey = (userId: string, practiceId: string, round: number): string => `boost:corner:${userId}:${practiceId}:${round}`;
