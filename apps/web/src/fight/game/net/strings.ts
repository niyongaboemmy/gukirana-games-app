import { reasonText } from "@/lib/match-store";

/**
 * Live Boxing client strings (ring refusals, connection notices). English source of the i18n keys `fight.net.*`
 * (same pattern as fight/game/strings.ts). Money / account reasons reuse the match wording (`reasonText`).
 */
export const FN = {
  "deny.UNKNOWN_RING": "That ring doesn't exist.",
  "deny.RING_TAKEN": "Someone already holds that ring. Pick a free (green) one.",
  "deny.RING_CLOSED": "That ring is closed right now.",
  "deny.NOT_IN_RING": "You're not in a ring.",
  "deny.ALREADY_IN_RING": "You already hold a ring. Step out of it first.",
  "deny.TOO_FAR": "Walk up to the ring steps first.",
  "deny.SIGN_IN_REQUIRED": "Sign in to fight people. Practice vs AI is open to everyone.",
  "deny.OWN_RING": "That's your own ring: wait for an opponent to step in.",
  "deny.STAKE_MISMATCH": "The stake of that ring changed. Look again.",
  "deny.HIGH_LATENCY": "Your connection is too slow for a live fight right now. Practice vs AI still works.",
  "deny.HALL_FULL": "The rail at that ring is full.",
  "deny.RATE_LIMITED": "Slow down a little.",
  "deny.SUBHALL_CLOSED": "The Boxing hall is closed right now.",
  "fight.connectFailed": "Couldn't open your fight. If Stars were staked, they come back automatically.",
  "fight.reconnecting": "Reconnecting to your fight…",
  "quick.waiting": "Looking for an opponent at {stake} Stars…",
  "quick.waitingFriendly": "Looking for a friendly opponent…",
} as const;
export type FnKey = keyof typeof FN;

export function fn(key: FnKey, vars?: Record<string, string | number>): string {
  let s: string = FN[key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** a `boxing-denied` reason in plain words: ring reasons here, money / account reasons from the match wording */
export function denialText(reason: string, limit?: number): string {
  const k = `deny.${reason}` as FnKey;
  if (k in FN) return FN[k];
  return reasonText(reason, { game: "boxing", limit });
}
