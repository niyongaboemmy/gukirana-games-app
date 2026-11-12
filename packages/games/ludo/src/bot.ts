import { absoluteSquare, HOME, LAST_TRACK, movableTokens, SAFE_SQUARES, type LudoState } from "./engine.js";

/** Deterministic heuristic bot (practice rooms only). Returns a token index. */
export function ludoBotMove(s: LudoState): number {
  const me = s.players[s.turn]!;
  const dice = s.dice!;
  const options = movableTokens(me, dice);
  let best = options[0]!;
  let bestScore = -Infinity;
  for (const t of options) {
    const from = me.tokens[t]!;
    const to = from === -1 ? 0 : from + dice;
    let score = to; // progress
    if (to === HOME) score += 100;
    if (from === -1) score += 40;
    if (to <= LAST_TRACK) {
      const sq = absoluteSquare(me.seat, to);
      const captures = s.players.some(
        (o) => o.id !== me.id && o.tokens.some((p) => p >= 0 && p <= LAST_TRACK && absoluteSquare(o.seat, p) === sq),
      );
      if (captures && !SAFE_SQUARES.has(sq)) score += 80;
      if (SAFE_SQUARES.has(sq)) score += 15;
    }
    if (to > LAST_TRACK) score += 20; // safe in the home column
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}
