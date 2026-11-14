/**
 * Matchmaking strings, English catalogue (i18n-ready like admin-block/strings.ts; to move to @gukirana/i18n keys `match.*`).
 * `{game}` / `{n}` / `{limit}` are filled in by `fill()`.
 */
export const M = {
  player: "Player",
  stakeEach: "Stake each",
  cancel: "Cancel",
  friendly: "Friendly",
  friendlyLeft: "Friendly games left today: {n} of {limit}",
  friendlyNone: "No friendly {game} games left today. Practice vs AI is unlimited.",
  friendlyNote: "No stake: just for fun and rating.",
  stakeNote: "Winner gets {pot} Stars. Stakes are held in escrow by the server.",
  stakeFeeNote: "You pay {total} ({stake} stake + {fee} fee). Winner gets {pot}.",
  onlyFriendly: "Not enough Stars to stake. Friendly games are open.",
  cantAccept: "You can't accept this one",
} as const;

/** server refusal codes → plain words (challenge sheet, quick match, seat panel, incoming challenge) */
export const REASON_WORDS: Record<string, string> = {
  INSUFFICIENT_FUNDS: "Not enough Stars for that stake. Pick a smaller stake or play a friendly game.",
  LOGIN_REQUIRED: "Sign in to challenge players.",
  PLAYER_UNAVAILABLE: "That player can't be challenged right now.",
  TOO_MANY_OPEN: "You already have 3 open challenges.",
  DECLINED: "Challenge declined.",
  EXPIRED: "Challenge expired.",
  PLAYER_LEFT: "The other player left.",
  INVALID_PROPOSAL: "That challenge isn't valid. Pick a game and a stake again.",
  INVALID: "That isn't a valid game or stake.",
  // about your own account / limits (only ever sent to you)
  ON_A_BREAK: "You're on a break, so staked games are paused. Friendly games are still on.",
  DAILY_LIMIT_REACHED: "That stake is over your daily limit. Try a smaller stake or a friendly game.",
  ACCOUNT_INACTIVE: "This account is suspended. Contact support.",
  FRIENDLY_LIMIT_REACHED: "You've played your {limit} friendly games of {game} today — come back tomorrow or play practice vs AI.",
  ALREADY_IN_MATCH: "You're still in another match. Finish or leave it first.",
  // about the table (both players may hear these)
  GAME_DISABLED: "Live {game} matches are paused right now. Practice vs AI is open.",
  STAKE_NOT_ALLOWED: "That stake isn't offered for {game}. Pick another one.",
  // about the other player (never says why)
  OPPONENT_CANT_PLAY: "They can't play right now.",
};

export const fill = (s: string, vars: Record<string, string | number | undefined>) => s.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] === undefined ? `{${k}}` : String(vars[k])));
