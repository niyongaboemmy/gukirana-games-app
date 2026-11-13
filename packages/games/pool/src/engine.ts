import { z } from "zod";
import { stableStringify, type GameModule, type GameRng, type MatchResult, type PlayerRef } from "@gukirana/game-kit";
import { cloneBalls, rack, respotCue, simulateShot, type Ball, type ShotEvents } from "./physics.js";

/** 8-ball rules (SRS §4.2 G1, simplified v0): groups, fouls, ball-in-hand respot, 8-ball last. */
export type Group = "solids" | "stripes" | null;
const isSolid = (n: number) => n >= 1 && n <= 7;
const isStripe = (n: number) => n >= 9 && n <= 15;
export const inGroup = (n: number, g: Group) => (g === "solids" ? isSolid(n) : g === "stripes" ? isStripe(n) : n !== 0 && n !== 8);

export interface PoolState {
  players: [string, string];
  turn: 0 | 1;
  balls: Ball[];
  groups: [Group, Group];
  winner: 0 | 1 | null;
  shots: number;
  /** last shot, for client playback (frames in 0.1 mm units) */
  lastShot: { by: 0 | 1; frames: number[][]; events: ShotEvents; foul: string | null; message: string } | null;
}

export const PoolIntentSchema = z.object({
  dx: z.number().int().min(-1_000_000).max(1_000_000),
  dy: z.number().int().min(-1_000_000).max(1_000_000),
  power: z.number().int().min(1).max(1000),
  spin: z.number().int().min(-100).max(100).default(0),
});
export type PoolIntent = z.infer<typeof PoolIntentSchema>;

export const remaining = (s: Pick<PoolState, "balls">, g: Group) => (g ? s.balls.filter((b) => !b.in && inGroup(b.n, g)).length : 7);

/** Fair rack: the 8 in the centre, a solid and a stripe in the back corners, the rest shuffled by the fair RNG (FR-G1-07). */
export function fairRackOrder(rng: GameRng): number[] {
  const others = [2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15];
  for (let i = others.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [others[i], others[j]] = [others[j]!, others[i]!];
  }
  const order = [...others.slice(0, 4), 8, ...others.slice(4)]; // index 4 = centre of row 3
  // back row corners (indices 10 and 14) get one solid and one stripe
  order.splice(10, 0, 1);
  order.splice(14, 0, 9);
  return order.slice(0, 15);
}

export function initPool(players: [string, string], rng: GameRng): PoolState {
  return { players, turn: 0, balls: rack(fairRackOrder(rng)), groups: [null, null], winner: null, shots: 0, lastShot: null };
}

export function playShot(state: PoolState, intent: PoolIntent): PoolState {
  const shooter = state.turn;
  const other = (1 - shooter) as 0 | 1;
  const shot = simulateShot(state.balls, intent.dx, intent.dy, intent.power, intent.spin ?? 0);
  const balls = shot.balls;
  const { firstHit, pocketed } = shot.events;
  let groups = [...state.groups] as [Group, Group];
  const mine = groups[shooter];
  const scratch = pocketed.includes(0);
  const potted = pocketed.filter((n) => n !== 0);
  let foul: string | null = scratch ? "scratch" : firstHit === null ? "no ball hit" : null;
  const clearedBefore = mine !== null && remaining({ balls: state.balls }, mine) === 0;
  if (!foul && mine && firstHit !== null && !inGroup(firstHit, mine) && !(firstHit === 8 && clearedBefore)) foul = "wrong ball first";
  if (!foul && !mine && firstHit === 8) foul = "8-ball hit first";

  const next: PoolState = { ...state, balls, groups, shots: state.shots + 1, lastShot: null };

  if (potted.includes(8)) {
    const won = clearedBefore && !scratch && !foul;
    next.winner = won ? shooter : other;
    next.lastShot = { by: shooter, frames: shot.frames, events: shot.events, foul, message: won ? "8-ball sunk: game!" : "8-ball potted early: game lost" };
    return next;
  }
  if (!mine && !foul) {
    const first = potted.find((n) => n !== 8);
    if (first !== undefined) {
      const g: Group = isSolid(first) ? "solids" : "stripes";
      groups = shooter === 0 ? [g, g === "solids" ? "stripes" : "solids"] : [g === "solids" ? "stripes" : "solids", g];
      next.groups = groups;
    }
  }
  if (scratch) respotCue(balls);
  const keep = !foul && potted.some((n) => (groups[shooter] ? inGroup(n, groups[shooter]) : n !== 8));
  next.turn = keep ? shooter : other;
  next.lastShot = {
    by: shooter,
    frames: shot.frames,
    events: shot.events,
    foul,
    message: foul ? `Foul: ${foul}` : keep ? "Potted. Shoot again" : potted.length ? "Potted the opponent's ball" : "No pot",
  };
  return next;
}

export const poolModule: GameModule<PoolState, PoolIntent, Record<string, never>> = {
  meta: { id: "pool", version: "0.1.0", minPlayers: 2, maxPlayers: 2, usesRandomness: true, skillClassification: "skill-dominant", realtime: "turn-based" },
  intentSchema: PoolIntentSchema as unknown as z.ZodType<PoolIntent>,
  init: (_c, players: readonly PlayerRef[], rng) => initPool([players[0]!.id, players[1]!.id], rng),
  validate(s, player, intent) {
    if (s.winner !== null) return { ok: false, reason: "GAME_OVER" };
    if (s.players[s.turn] !== player) return { ok: false, reason: "NOT_YOUR_TURN" };
    if (intent.dx === 0 && intent.dy === 0) return { ok: false, reason: "NO_DIRECTION" };
    return { ok: true };
  },
  apply: (s, _p, intent) => playShot(s, intent),
  onTimeout: (s) => ({ ...s, turn: (1 - s.turn) as 0 | 1, lastShot: { by: s.turn, frames: [], events: { firstHit: null, pocketed: [], cushionAfterContact: false }, foul: "timeout", message: "Shot clock expired" } }),
  currentTurn: (s) => (s.winner === null ? s.players[s.turn] : null),
  isTerminal: (s) => s.winner !== null,
  result(s): MatchResult {
    const w = s.winner ?? 0;
    return { ranks: { [s.players[w]]: 1, [s.players[1 - w]!]: 2 }, reason: "normal" };
  },
  viewFor: (s) => s,
  hash: (s) => stableStringify({ b: s.balls.map((b) => [b.n, b.x, b.y, b.in]), t: s.turn, g: s.groups, w: s.winner, n: s.shots }),
};

/** Ghost-ball AI (practice only): picks the straightest unobstructed pot, simulates it, keeps the best. */
export function poolBotShot(s: PoolState, level = 3): PoolIntent {
  const cue = s.balls.find((b) => b.n === 0)!;
  const g = s.groups[s.turn];
  const targets = s.balls.filter((b) => !b.in && b.n !== 0 && (g ? (remaining(s, g) === 0 ? b.n === 8 : inGroup(b.n, g)) : b.n !== 8));
  const candidates: PoolIntent[] = [];
  const pockets: [number, number][] = [
    [0, 0],
    [12700000, -180000],
    [25400000, 0],
    [0, 12700000],
    [12700000, 12880000],
    [25400000, 12700000],
  ];
  for (const t of targets)
    for (const [px, py] of pockets) {
      const ddx = px - t.x;
      const ddy = py - t.y;
      const len = Math.trunc(Math.sqrt(ddx * ddx + ddy * ddy)) || 1;
      const gx = t.x - Math.trunc((ddx * 572000) / len);
      const gy = t.y - Math.trunc((ddy * 572000) / len);
      candidates.push({ dx: Math.trunc((gx - cue.x) / 1000), dy: Math.trunc((gy - cue.y) / 1000), power: 520 + level * 60, spin: 0 });
    }
  let best: PoolIntent = candidates[0] ?? { dx: 1000, dy: 0, power: 700, spin: 0 };
  let bestScore = -Infinity;
  for (const c of candidates.slice(0, 24)) {
    const r = playShot({ ...s, balls: cloneBalls(s.balls) }, c);
    const mineAfter = r.groups[s.turn];
    const potsMine = r.lastShot!.events.pocketed.filter((n) => n !== 0 && (mineAfter ? inGroup(n, mineAfter) : n !== 8)).length;
    const score = (r.winner === s.turn ? 100 : r.winner !== null ? -100 : 0) + potsMine * 10 - (r.lastShot!.foul ? 15 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}
