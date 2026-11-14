import { z } from "zod";
import { stableStringify, type GameModule, type GameRng, type MatchResult, type PlayerRef } from "@gukirana/game-kit";

/**
 * Ludo — classic rules (SRS §4.2 G2). Skill variants (Sprint, Timed, Dice Draft) build on this engine.
 * Token progress: -1 = base, 0–50 = main track (relative to the seat's start), 51–55 = home column, 56 = home.
 * Dice ALWAYS come from the injected fair RNG (plan §4.4).
 */
export const TRACK = 52;
export const HOME = 56;
export const LAST_TRACK = 50;
export const SAFE_SQUARES = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

export interface LudoPlayer {
  id: string;
  seat: 0 | 1 | 2 | 3;
  tokens: [number, number, number, number];
}

export interface LudoState {
  players: LudoPlayer[];
  turn: number; // index into players
  phase: "roll" | "move";
  dice: number | null;
  sixesInRow: number;
  rolls: number; // fair-roll counter (audit / verification)
  winner: string | null;
  lastEvent: LudoEvent | null;
}

export type LudoEvent =
  | { kind: "roll"; player: string; dice: number; movable: number[] }
  | { kind: "move"; player: string; token: number; from: number; to: number; captured: { player: string; token: number }[] }
  | { kind: "pass"; player: string; reason: "no-moves" | "three-sixes" };

export const LudoIntentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("roll") }),
  z.object({ type: z.literal("move"), token: z.number().int().min(0).max(3) }),
]);
export type LudoIntent = z.infer<typeof LudoIntentSchema>;

export const absoluteSquare = (seat: number, progress: number) => (seat * 13 + progress) % TRACK;

export function movableTokens(p: LudoPlayer, dice: number): number[] {
  const out: number[] = [];
  p.tokens.forEach((pos, i) => {
    if (pos === -1 ? dice === 6 : pos !== HOME && pos + dice <= HOME) out.push(i);
  });
  return out;
}

export function initLudo(players: { id: string; seat: 0 | 1 | 2 | 3 }[]): LudoState {
  return {
    players: players.map((p) => ({ ...p, tokens: [-1, -1, -1, -1] })),
    turn: 0,
    phase: "roll",
    dice: null,
    sixesInRow: 0,
    rolls: 0,
    winner: null,
    lastEvent: null,
  };
}

const clone = (s: LudoState): LudoState => ({
  ...s,
  players: s.players.map((p) => ({ ...p, tokens: [...p.tokens] as LudoPlayer["tokens"] })),
});

function nextTurn(s: LudoState): void {
  s.turn = (s.turn + 1) % s.players.length;
  s.phase = "roll";
  s.dice = null;
  s.sixesInRow = 0;
}

export function rollDice(state: LudoState, rng: GameRng): LudoState {
  const s = clone(state);
  const p = s.players[s.turn]!;
  const dice = rng.int(1, 6);
  s.rolls += 1;
  s.dice = dice;
  s.sixesInRow = dice === 6 ? s.sixesInRow + 1 : 0;
  if (s.sixesInRow === 3) {
    s.lastEvent = { kind: "pass", player: p.id, reason: "three-sixes" };
    nextTurn(s);
    return s;
  }
  const movable = movableTokens(p, dice);
  s.lastEvent = { kind: "roll", player: p.id, dice, movable };
  if (movable.length === 0) {
    nextTurn(s);
    s.lastEvent = { kind: "roll", player: p.id, dice, movable };
  } else {
    s.phase = "move";
  }
  return s;
}

export function moveToken(state: LudoState, token: number): LudoState {
  const s = clone(state);
  const p = s.players[s.turn]!;
  const dice = s.dice!;
  const from = p.tokens[token]!;
  const to = from === -1 ? 0 : from + dice;
  p.tokens[token] = to;

  const captured: { player: string; token: number }[] = [];
  if (to <= LAST_TRACK) {
    const sq = absoluteSquare(p.seat, to);
    if (!SAFE_SQUARES.has(sq)) {
      for (const other of s.players) {
        if (other.id === p.id) continue;
        other.tokens.forEach((pos, i) => {
          if (pos >= 0 && pos <= LAST_TRACK && absoluteSquare(other.seat, pos) === sq) {
            other.tokens[i] = -1;
            captured.push({ player: other.id, token: i });
          }
        });
      }
    }
  }
  s.lastEvent = { kind: "move", player: p.id, token, from, to, captured };

  if (p.tokens.every((t) => t === HOME)) {
    s.winner = p.id;
    s.phase = "roll";
    return s;
  }
  const bonus = dice === 6 || captured.length > 0 || to === HOME;
  if (bonus) {
    s.phase = "roll";
    s.dice = null;
  } else {
    nextTurn(s);
  }
  return s;
}

/** Race score for the finishing order: tokens home first, then squares travelled (a token in base counts 0). */
export const raceScore = (p: LudoPlayer) => p.tokens.reduce((a, t) => a + (t === HOME ? 1000 : t < 0 ? 0 : t + 1), 0);

/**
 * Ranks when the game ends (the first player home wins). The others are placed by how far their race went
 * (tokens home, then squares travelled); equal races share a place. Two players: winner 1, loser 2.
 */
export function finishingOrder(s: LudoState): Record<string, number> {
  const ranks: Record<string, number> = {};
  const rest = s.players.filter((p) => p.id !== s.winner).sort((a, b) => raceScore(b) - raceScore(a));
  if (s.winner) ranks[s.winner] = 1;
  const base = s.winner ? 2 : 1;
  rest.forEach((p, i) => {
    const prev = rest[i - 1];
    ranks[p.id] = prev && raceScore(prev) === raceScore(p) ? ranks[prev.id]! : base + i;
  });
  return ranks;
}

export const ludoModule: GameModule<LudoState, LudoIntent, Record<string, never>> = {
  meta: {
    id: "ludo",
    version: "0.1.0",
    minPlayers: 2,
    maxPlayers: 4,
    usesRandomness: true,
    skillClassification: "mixed",
    realtime: "turn-based",
  },
  intentSchema: LudoIntentSchema,
  init: (_c, players: readonly PlayerRef[]) =>
    initLudo(players.map((p) => ({ id: p.id, seat: p.seat as 0 | 1 | 2 | 3 }))),
  validate(s, player, intent) {
    if (s.winner) return { ok: false, reason: "GAME_OVER" };
    if (s.players[s.turn]!.id !== player) return { ok: false, reason: "NOT_YOUR_TURN" };
    if (intent.type === "roll") return s.phase === "roll" ? { ok: true } : { ok: false, reason: "MUST_MOVE" };
    if (s.phase !== "move") return { ok: false, reason: "MUST_ROLL" };
    return movableTokens(s.players[s.turn]!, s.dice!).includes(intent.token)
      ? { ok: true }
      : { ok: false, reason: "TOKEN_NOT_MOVABLE" };
  },
  apply: (s, _p, intent, rng) => (intent.type === "roll" ? rollDice(s, rng) : moveToken(s, intent.token)),
  onTimeout(s) {
    if (s.phase === "move") return moveToken(s, movableTokens(s.players[s.turn]!, s.dice!)[0]!);
    const c = clone(s);
    nextTurn(c);
    return c;
  },
  currentTurn: (s) => (s.winner ? null : s.players[s.turn]!.id),
  isTerminal: (s) => s.winner !== null,
  result: (s): MatchResult => ({ ranks: finishingOrder(s), reason: "normal" }),
  viewFor: (s) => s,
  hash: (s) => stableStringify({ p: s.players.map((p) => p.tokens), t: s.turn, ph: s.phase, d: s.dice, r: s.rolls }),
};
