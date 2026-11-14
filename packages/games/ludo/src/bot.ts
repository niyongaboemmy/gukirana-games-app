import { absoluteSquare, HOME, LAST_TRACK, movableTokens, SAFE_SQUARES, type LudoPlayer, type LudoState } from "./engine.js";

/** Bot levels for practice rooms (never in cash rooms): 1 Easy, 2 Medium, 3 Hard, 4–5 Expert. */
export type LudoBotLevel = 1 | 2 | 3 | 4 | 5;

const onTrack = (p: number) => p >= 0 && p <= LAST_TRACK;

/** Chance (in sixths) that an opponent token can land on absolute square `sq` next turn: 1–6 squares behind it. */
function threatOn(s: LudoState, me: LudoPlayer, sq: number): number {
  if (SAFE_SQUARES.has(sq)) return 0;
  let threat = 0;
  for (const o of s.players) {
    if (o.id === me.id) continue;
    for (const t of o.tokens) {
      if (!onTrack(t)) {
        // a token in base comes out on its start square with a 6
        if (t === -1 && absoluteSquare(o.seat, 0) === sq) threat += 1;
        continue;
      }
      const from = absoluteSquare(o.seat, t);
      const d = (sq - from + 52) % 52;
      // it must still be on the main track when it gets there (not turned into its home column)
      if (d >= 1 && d <= 6 && t + d <= LAST_TRACK) threat += 1;
    }
  }
  return threat;
}

/** Opponent tokens 1–6 squares ahead of `sq` (targets for next turn). */
function targetsFrom(s: LudoState, me: LudoPlayer, progress: number): number {
  if (!onTrack(progress)) return 0;
  const sq = absoluteSquare(me.seat, progress);
  let n = 0;
  for (const o of s.players) {
    if (o.id === me.id) continue;
    for (const t of o.tokens) {
      if (!onTrack(t)) continue;
      const at = absoluteSquare(o.seat, t);
      const d = (at - sq + 52) % 52;
      if (d >= 1 && d <= 6 && progress + d <= LAST_TRACK && !SAFE_SQUARES.has(at)) n += 1;
    }
  }
  return n;
}

/**
 * Deterministic heuristic bot (practice rooms only). Returns a token index that is always legal.
 * Easy races the furthest-back token without looking at the board; Medium likes captures, safe squares and getting
 * out of base; Hard also weighs the danger of where it lands and where it leaves; Expert adds attack set-ups and
 * protects tokens close to home.
 */
export function ludoBotMove(s: LudoState, level: number = 2): number {
  const lv = Math.max(1, Math.min(5, Math.trunc(level))) as LudoBotLevel;
  const me = s.players[s.turn]!;
  const dice = s.dice!;
  const options = movableTokens(me, dice);
  let best = options[0]!;
  let bestScore = -Infinity;
  for (const t of options) {
    const from = me.tokens[t]!;
    const to = from === -1 ? 0 : from + dice;
    let score: number;
    if (lv === 1) {
      // Easy: bring tokens out, otherwise move the one furthest back (no tactics)
      score = from === -1 ? 60 : 56 - from;
    } else {
      score = to; // progress
      if (to === HOME) score += 100;
      if (from === -1) score += 40;
      const sq = onTrack(to) ? absoluteSquare(me.seat, to) : -1;
      if (sq >= 0) {
        const captures = s.players.some((o) => o.id !== me.id && o.tokens.some((p) => onTrack(p) && absoluteSquare(o.seat, p) === sq));
        if (captures && !SAFE_SQUARES.has(sq)) score += lv >= 4 ? 110 : 80;
        if (SAFE_SQUARES.has(sq)) score += 15;
      }
      if (to > LAST_TRACK) score += 20; // safe in the home column
      if (lv >= 3) {
        // danger where it lands vs. danger where it stands now
        const risk = sq >= 0 ? threatOn(s, me, sq) : 0;
        const was = onTrack(from) ? threatOn(s, me, absoluteSquare(me.seat, from)) : 0;
        const value = lv >= 4 ? 8 + Math.max(0, from) : 25; // Expert protects advanced tokens harder
        score -= risk * value;
        score += was * value * 0.8;
      }
      if (lv >= 4) score += targetsFrom(s, me, to) * 6;
    }
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}
