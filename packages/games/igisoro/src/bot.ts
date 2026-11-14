import { legalPits, playIgisoro, type IgisoroState } from "./engine.js";

const seedsOf = (s: IgisoroState, side: 0 | 1) => s.pits[side].reduce((a, b) => a + b, 0);

function evaluate(s: IgisoroState, me: 0 | 1): number {
  if (s.winner === me) return 10_000;
  if (s.winner !== null) return -10_000;
  const opp = (1 - me) as 0 | 1;
  return (seedsOf(s, me) - seedsOf(s, opp)) * 10 + (legalPits(s, me).length - legalPits(s, opp).length);
}

function minimax(s: IgisoroState, depth: number, me: 0 | 1, alpha: number, beta: number): number {
  if (depth === 0 || s.winner !== null || s.draw) return evaluate(s, me);
  const moves = legalPits(s);
  if (s.turn === me) {
    let best = -Infinity;
    for (const m of moves) {
      best = Math.max(best, minimax(playIgisoro(s, m), depth - 1, me, alpha, beta));
      alpha = Math.max(alpha, best);
      if (alpha >= beta) break;
    }
    return best;
  }
  let best = Infinity;
  for (const m of moves) {
    best = Math.min(best, minimax(playIgisoro(s, m), depth - 1, me, alpha, beta));
    beta = Math.min(beta, best);
    if (alpha >= beta) break;
  }
  return best;
}

/**
 * Deterministic bot (practice rooms only — plan §4.4 rule 3). Level 1–5 → search depth
 * (1 Easy, 2 Medium, 3 Hard, 5 Expert). Easy also plays its second-best move every third turn, chosen by the move
 * number (no Math.random in game code), so beginners can win.
 */
export function igisoroBotMove(s: IgisoroState, level = 3): number {
  const depth = Math.max(1, Math.min(5, Math.trunc(level)));
  const me = s.turn;
  const scored: { pit: number; score: number }[] = [];
  for (const m of legalPits(s)) scored.push({ pit: m, score: minimax(playIgisoro(s, m), depth - 1, me, -Infinity, Infinity) });
  if (scored.length === 0) return -1;
  // stable: best score first, lower pit index on ties
  scored.sort((a, b) => b.score - a.score || a.pit - b.pit);
  if (depth === 1 && scored.length > 1 && s.moveCount % 3 === 2 && scored[1]!.score > -10_000) return scored[1]!.pit;
  return scored[0]!.pit;
}
