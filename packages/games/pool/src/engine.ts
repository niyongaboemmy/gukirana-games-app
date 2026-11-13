import { z } from "zod";
import { stableStringify, type GameModule, type GameRng, type MatchResult, type PlayerRef } from "@gukirana/game-kit";
import { cloneBalls, isClearSpot, POCKETS, rack, respotCue, respotEight, simulateShot, TABLE_H, TABLE_W, U, type Ball, type ShotEvents } from "./physics.js";

/**
 * 8-ball rules (SRS §4.2 G1, WPA-style v1):
 * - open table until the first legal pot decides the groups (the break may decide them);
 * - fouls: scratch, no ball hit, wrong ball first, 8-ball first on an open table, no rail after contact;
 * - after any foul (and a shot-clock timeout) the incoming player has ball in hand anywhere on the cloth;
 * - the 8-ball must be called (pocket index) once the shooter's group is cleared;
 * - potting the 8 early, with a foul, or in another pocket loses; the 8 on the break is re-spotted.
 */
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
  /** after a foul the incoming player may place the cue ball anywhere on the cloth */
  ballInHand: boolean;
  /** last shot, for client playback (frames in 0.1 mm units) */
  lastShot: { by: 0 | 1; frames: number[][]; events: ShotEvents; foul: string | null; message: string; called?: number | null } | null;
}

export const PoolIntentSchema = z.object({
  dx: z.number().int().min(-1_000_000).max(1_000_000),
  dy: z.number().int().min(-1_000_000).max(1_000_000),
  power: z.number().int().min(1).max(1000),
  spin: z.number().int().min(-100).max(100).default(0),
  /** ball in hand only: where the cue ball is placed, in units (0.1 mm) */
  cue: z.object({ x: z.number().int().min(0).max(TABLE_W / U), y: z.number().int().min(0).max(TABLE_H / U) }).optional(),
  /** called pocket (index into POCKETS), required when shooting at the 8-ball */
  pocket: z.number().int().min(0).max(5).optional(),
});
export type PoolIntent = z.infer<typeof PoolIntentSchema>;

export const remaining = (s: Pick<PoolState, "balls">, g: Group) => (g ? s.balls.filter((b) => !b.in && inGroup(b.n, g)).length : 7);

/** The shooter's group is cleared, so the 8-ball is the legal target and a pocket must be called. */
export const onTheEight = (s: Pick<PoolState, "balls" | "groups" | "turn">, side: 0 | 1 = s.turn) => {
  const g = s.groups[side];
  return g !== null && remaining(s, g) === 0;
};

/** Balls the side may legally hit first (aim guides and the bot). */
export function legalTargets(s: Pick<PoolState, "balls" | "groups" | "turn">, side: 0 | 1 = s.turn): number[] {
  if (onTheEight(s, side)) return [8];
  const g = s.groups[side];
  return s.balls.filter((b) => !b.in && b.n !== 0 && (g ? inGroup(b.n, g) : b.n !== 8)).map((b) => b.n);
}

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
  return { players, turn: 0, balls: rack(fairRackOrder(rng)), groups: [null, null], winner: null, shots: 0, ballInHand: false, lastShot: null };
}

/** A legal ball-in-hand spot (units, 0.1 mm): on the cloth, clear of the pockets and of every other ball. */
export function canPlaceCue(s: Pick<PoolState, "balls">, x: number, y: number): boolean {
  return isClearSpot(s.balls, x * U, y * U, 0);
}

export function playShot(state: PoolState, intent: PoolIntent): PoolState {
  const shooter = state.turn;
  const other = (1 - shooter) as 0 | 1;
  const isBreak = state.shots === 0;
  let start: readonly Ball[] = state.balls;
  if (intent.cue && state.ballInHand && canPlaceCue(state, intent.cue.x, intent.cue.y)) {
    const placed = cloneBalls(state.balls);
    const cue = placed.find((b) => b.n === 0)!;
    cue.x = intent.cue.x * U;
    cue.y = intent.cue.y * U;
    cue.in = false;
    start = placed;
  }
  const shot = simulateShot(start, intent.dx, intent.dy, intent.power, intent.spin ?? 0);
  const balls = shot.balls;
  const { firstHit, pocketed, pockets, cushionAfterContact } = shot.events;
  let groups = [...state.groups] as [Group, Group];
  const mine = groups[shooter];
  const scratch = pocketed.includes(0);
  const clearedBefore = mine !== null && remaining({ balls: [...start] }, mine) === 0;
  const called = clearedBefore ? (intent.pocket ?? null) : null;
  let potted = pocketed.filter((n) => n !== 0);
  let foul: string | null = scratch ? "scratch" : firstHit === null ? "no ball hit" : null;
  if (!foul && mine && firstHit !== null && !inGroup(firstHit, mine) && !(firstHit === 8 && clearedBefore)) foul = "wrong ball first";
  if (!foul && !mine && firstHit === 8 && !isBreak) foul = "8-ball hit first";
  if (!foul && potted.length === 0 && !cushionAfterContact) foul = "no rail after contact";

  const next: PoolState = { ...state, balls, groups, shots: state.shots + 1, ballInHand: false, lastShot: null };
  const playback = { by: shooter, frames: shot.frames, events: shot.events, called };

  // the 8-ball on the break is re-spotted, never a loss; the rest of the shot counts as normal
  let respotted = false;
  if (isBreak && potted.includes(8)) {
    respotEight(balls);
    potted = potted.filter((n) => n !== 8);
    respotted = true;
  }
  if (potted.includes(8)) {
    const eightPocket = pockets[pocketed.indexOf(8)];
    const rightPocket = called === null || called === eightPocket;
    const won = clearedBefore && !foul && rightPocket;
    next.winner = won ? shooter : other;
    const why = won
      ? "8-ball sunk: game!"
      : !clearedBefore
        ? "8-ball potted early: game lost"
        : foul
          ? `8-ball with a foul (${foul}): game lost`
          : "8-ball in the wrong pocket: game lost";
    next.lastShot = { ...playback, foul, message: why };
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
  next.ballInHand = foul !== null;
  next.lastShot = {
    ...playback,
    foul,
    message: foul
      ? `Foul: ${foul}. Ball in hand`
      : keep
        ? "Potted. Shoot again"
        : respotted
          ? "8-ball on the break: re-spotted"
          : potted.length
            ? "Potted the opponent's ball"
            : "No pot",
  };
  return next;
}

export const poolModule: GameModule<PoolState, PoolIntent, Record<string, never>> = {
  meta: { id: "pool", version: "0.2.0", minPlayers: 2, maxPlayers: 2, usesRandomness: true, skillClassification: "skill-dominant", realtime: "turn-based" },
  intentSchema: PoolIntentSchema as unknown as z.ZodType<PoolIntent>,
  init: (_c, players: readonly PlayerRef[], rng) => initPool([players[0]!.id, players[1]!.id], rng),
  validate(s, player, intent) {
    if (s.winner !== null) return { ok: false, reason: "GAME_OVER" };
    if (s.players[s.turn] !== player) return { ok: false, reason: "NOT_YOUR_TURN" };
    if (intent.dx === 0 && intent.dy === 0) return { ok: false, reason: "NO_DIRECTION" };
    if (intent.cue && !s.ballInHand) return { ok: false, reason: "NO_BALL_IN_HAND" };
    if (intent.cue && !canPlaceCue(s, intent.cue.x, intent.cue.y)) return { ok: false, reason: "BAD_CUE_PLACEMENT" };
    if (onTheEight(s) && intent.pocket === undefined) return { ok: false, reason: "CALL_POCKET" };
    return { ok: true };
  },
  apply: (s, _p, intent) => playShot(s, intent),
  onTimeout: (s) => ({
    ...s,
    turn: (1 - s.turn) as 0 | 1,
    ballInHand: true,
    lastShot: { by: s.turn, frames: [], events: { firstHit: null, pocketed: [], pockets: [], cushionAfterContact: false }, foul: "timeout", message: "Shot clock expired. Ball in hand" },
  }),
  currentTurn: (s) => (s.winner === null ? s.players[s.turn] : null),
  isTerminal: (s) => s.winner !== null,
  result(s): MatchResult {
    const w = s.winner ?? 0;
    return { ranks: { [s.players[w]]: 1, [s.players[1 - w]!]: 2 }, reason: "normal" };
  },
  viewFor: (s) => s,
  hash: (s) => stableStringify({ b: s.balls.map((b) => [b.n, b.x, b.y, b.in]), t: s.turn, g: s.groups, w: s.winner, n: s.shots, h: s.ballInHand }),
};

/** Per-mille aim error by bot level (1 = beginner … 5 = shark). */
const BOT_ERR = [0, 45, 22, 10, 4, 0];

/**
 * Ghost-ball AI (practice only): for every legal target and pocket it aims at the ghost-ball point, simulates the
 * shot with the authoritative engine and keeps the best. With ball in hand it also tries straight-in placements.
 * Lower levels miss by a deterministic, shot-dependent angle (no Math.random in game code).
 */
export function poolBotShot(s: PoolState, level = 3): PoolIntent {
  const lv = Math.max(1, Math.min(5, Math.trunc(level)));
  const targets = new Set(legalTargets(s));
  const on = s.balls.filter((b) => !b.in && targets.has(b.n));
  const eight = onTheEight(s);
  type Cand = { cue: { x: number; y: number } | undefined; dx: number; dy: number; pocket: number };
  const cands: Cand[] = [];
  const cue0 = s.balls.find((b) => b.n === 0)!;
  for (const t of on)
    for (let p = 0; p < POCKETS.length; p++) {
      const [px, py] = POCKETS[p]!;
      const ddx = px - t.x;
      const ddy = py - t.y;
      const len = Math.trunc(Math.sqrt(ddx * ddx + ddy * ddy)) || 1;
      const gx = t.x - Math.trunc((ddx * 572000) / len);
      const gy = t.y - Math.trunc((ddy * 572000) / len);
      cands.push({ cue: undefined, dx: Math.trunc((gx - cue0.x) / 1000), dy: Math.trunc((gy - cue0.y) / 1000), pocket: p });
      if (s.ballInHand) {
        // straight in: the cue ball 30 cm behind the ghost point, on the pocket line
        const cx = Math.trunc((gx - Math.trunc((ddx * 3_000_000) / len)) / U);
        const cy = Math.trunc((gy - Math.trunc((ddy * 3_000_000) / len)) / U);
        if (canPlaceCue(s, cx, cy)) cands.push({ cue: { x: cx, y: cy }, dx: Math.trunc((ddx * 1000) / len), dy: Math.trunc((ddy * 1000) / len), pocket: p });
      }
    }
  const power = 520 + lv * 60;
  const intentOf = (c: Cand): PoolIntent => {
    const e = BOT_ERR[lv]! * (((s.shots * 7919 + c.pocket * 31) % 3) - 1);
    return {
      dx: c.dx - Math.trunc((c.dy * e) / 1000),
      dy: c.dy + Math.trunc((c.dx * e) / 1000),
      power,
      spin: 0,
      ...(c.cue ? { cue: c.cue } : {}),
      ...(eight ? { pocket: c.pocket } : {}),
    };
  };
  const usable = cands.filter((c) => c.dx !== 0 || c.dy !== 0);
  if (usable.length === 0) return { dx: 1000, dy: 7, power: 700, spin: 0, ...(eight ? { pocket: 0 } : {}) };
  // shortest shots first (most likely to pot); a bounded number of simulations
  const dist = (c: Cand) => Math.abs(c.dx) + Math.abs(c.dy);
  let best = intentOf(usable[0]!);
  let bestScore = -Infinity;
  for (const c of usable.sort((a, b) => dist(a) - dist(b)).slice(0, 30)) {
    const intent = intentOf(c);
    const r = playShot({ ...s, balls: cloneBalls(s.balls) }, intent);
    const mineAfter = r.groups[s.turn];
    const potsMine = r.lastShot!.events.pocketed.filter((n) => n !== 0 && (mineAfter ? inGroup(n, mineAfter) : n !== 8)).length;
    const score = (r.winner === s.turn ? 100 : r.winner !== null ? -100 : 0) + potsMine * 10 - (r.lastShot!.foul ? 15 : 0) + (r.turn === s.turn ? 5 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = intent;
    }
  }
  return best;
}
