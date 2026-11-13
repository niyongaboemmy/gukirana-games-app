import { z } from "zod";
import { stableStringify, type GameModule, type MatchResult, type PlayerRef } from "@gukirana/game-kit";

/**
 * Igisoro — Rwandan 4×8 mancala (SRS §4.2 G3).
 *
 * ⚠️ Rule set v0 (pending validation by cultural advisers, task P1-IGI-01 / dependency X8):
 * - Each player owns 16 pits: inner row (loop index 0–7, left→right from the player's view)
 *   and outer row (index 8–15, right→left). Sowing goes round this loop, one seed per pit.
 * - A move starts from an own pit with ≥ 2 seeds.
 * - Last seed in an occupied pit: if that pit is in the inner row and BOTH facing opponent pits
 *   (inner + outer of the same column) hold seeds, those seeds are captured and sown on from
 *   the next pit. Otherwise the pit is picked up and sowing continues (relay sowing).
 * - Last seed in an empty pit ends the turn.
 * - A player with no legal move on their turn loses.
 * - Move cap (termination guarantee for live play): after MAX_MOVES moves the side holding more seeds wins;
 *   equal seeds is a draw (the API splits the pot).
 */
export const PITS_PER_PLAYER = 16;
export const ROW = 8;
export const MAX_SOW_STEPS = 4000; // termination guard for pathological relay loops
export const MAX_MOVES = 300;

export interface IgisoroConfig {
  seedsPerPit?: number;
}

export type SowEvent =
  | { kind: "pickup"; player: 0 | 1; pit: number; seeds: number }
  | { kind: "sow"; player: 0 | 1; pit: number }
  | { kind: "capture"; from: 0 | 1; pits: number[]; seeds: number };

export interface IgisoroState {
  players: [string, string];
  pits: [number[], number[]];
  turn: 0 | 1;
  winner: 0 | 1 | null;
  /** the move cap was reached with equal seeds */
  draw?: boolean;
  moveCount: number;
  lastEvents: SowEvent[];
}

export const IgisoroIntentSchema = z.object({ pit: z.number().int().min(0).max(PITS_PER_PLAYER - 1) });
export type IgisoroIntent = z.infer<typeof IgisoroIntentSchema>;

/** Opponent pits facing my inner-row pit `idx` (0–7). */
export function facingPits(idx: number): { inner: number; outer: number } {
  const column = idx; // inner index equals the column from my left
  return { inner: ROW - 1 - column, outer: ROW + column };
}

export function legalPits(state: IgisoroState, side: 0 | 1 = state.turn): number[] {
  const out: number[] = [];
  state.pits[side].forEach((n, i) => {
    if (n >= 2) out.push(i);
  });
  return out;
}

export function initIgisoro(playerIds: [string, string], config: IgisoroConfig = {}): IgisoroState {
  const seeds = config.seedsPerPit ?? 2;
  return {
    players: playerIds,
    pits: [Array(PITS_PER_PLAYER).fill(seeds), Array(PITS_PER_PLAYER).fill(seeds)],
    turn: 0,
    winner: null,
    moveCount: 0,
    lastEvents: [],
  };
}

/** Pure move application. Returns a new state. Caller must check legality first. */
export function playIgisoro(state: IgisoroState, pit: number): IgisoroState {
  const me = state.turn;
  const opp = (1 - me) as 0 | 1;
  const pits: [number[], number[]] = [[...state.pits[0]], [...state.pits[1]]];
  const mine = pits[me];
  const theirs = pits[opp];
  const events: SowEvent[] = [];

  let idx = pit;
  let hand = mine[idx]!;
  mine[idx] = 0;
  events.push({ kind: "pickup", player: me, pit: idx, seeds: hand });

  let steps = 0;
  while (hand > 0 && steps < MAX_SOW_STEPS) {
    idx = (idx + 1) % PITS_PER_PLAYER;
    mine[idx]! += 1;
    hand -= 1;
    steps += 1;
    events.push({ kind: "sow", player: me, pit: idx });
    if (hand > 0 || mine[idx]! <= 1) continue;

    if (idx < ROW) {
      const f = facingPits(idx);
      const a = theirs[f.inner]!;
      const b = theirs[f.outer]!;
      if (a > 0 && b > 0) {
        theirs[f.inner] = 0;
        theirs[f.outer] = 0;
        hand = a + b;
        events.push({ kind: "capture", from: opp, pits: [f.inner, f.outer], seeds: hand });
        continue;
      }
    }
    hand = mine[idx]!;
    mine[idx] = 0;
    events.push({ kind: "pickup", player: me, pit: idx, seeds: hand });
  }
  // Guard hit: drop remaining seeds back into the current pit (conservation).
  if (hand > 0) mine[idx]! += hand;

  const next: IgisoroState = {
    players: state.players,
    pits,
    turn: opp,
    winner: null,
    moveCount: state.moveCount + 1,
    lastEvents: events,
  };
  if (legalPits(next, opp).length === 0) next.winner = me;
  else if (next.moveCount >= MAX_MOVES) {
    const mineSeeds = pits[me].reduce((a, b) => a + b, 0);
    const theirSeeds = pits[opp].reduce((a, b) => a + b, 0);
    if (mineSeeds === theirSeeds) next.draw = true;
    else next.winner = mineSeeds > theirSeeds ? me : opp;
  }
  return next;
}

export const igisoroModule: GameModule<IgisoroState, IgisoroIntent, IgisoroConfig> = {
  meta: {
    id: "igisoro",
    version: "0.1.0",
    minPlayers: 2,
    maxPlayers: 2,
    usesRandomness: false,
    skillClassification: "pure-skill",
    realtime: "turn-based",
  },
  intentSchema: IgisoroIntentSchema,
  init: (config, players: readonly PlayerRef[]) => initIgisoro([players[0]!.id, players[1]!.id], config),
  validate(state, player, intent) {
    if (state.winner !== null || state.draw) return { ok: false, reason: "GAME_OVER" };
    if (state.players[state.turn] !== player) return { ok: false, reason: "NOT_YOUR_TURN" };
    if ((state.pits[state.turn][intent.pit] ?? 0) < 2) return { ok: false, reason: "PIT_NEEDS_2_SEEDS" };
    return { ok: true };
  },
  apply: (state, _player, intent) => playIgisoro(state, intent.pit),
  onTimeout(state) {
    const pits = legalPits(state);
    return pits.length ? playIgisoro(state, pits[0]!) : { ...state, winner: (1 - state.turn) as 0 | 1 };
  },
  currentTurn: (s) => (s.winner === null && !s.draw ? s.players[s.turn] : null),
  isTerminal: (s) => s.winner !== null || s.draw === true,
  result(s): MatchResult {
    if (s.draw) return { ranks: { [s.players[0]]: 1, [s.players[1]]: 1 }, reason: "normal" };
    const w = s.winner ?? 0;
    return { ranks: { [s.players[w]]: 1, [s.players[1 - w]!]: 2 }, reason: "normal" };
  },
  viewFor: (s) => s,
  hash: (s) => stableStringify({ p: s.pits, t: s.turn, w: s.winner, d: s.draw ?? false, m: s.moveCount }),
};

export const totalSeeds = (s: IgisoroState) => [...s.pits[0], ...s.pits[1]].reduce((a, b) => a + b, 0);
