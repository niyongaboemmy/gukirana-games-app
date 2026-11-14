import {
  DEFAULT_FIGHT_RULES,
  TICK_HZ,
  type ActStage,
  type BoxingOutcome,
  type BoxingSnapshot,
  type Corner,
  type FightEvent,
  type FightInput,
  type FightPhase,
  type FighterAct,
  type FightRules,
  type Punch,
  type RingId,
} from "@gukirana/contracts";
import { stableStringify, type GameMeta, type MatchResult } from "@gukirana/game-kit";

/**
 * Boxing — deterministic fight engine (P3-FGT-01, docs/FIGHT-GAMES-PLAN.md §2).
 *
 * One pure step per tick (TICK_HZ = 30): `stepFight(state, inputs)` → next state. Integer-only, no randomness, no
 * clocks: the room feeds the inputs that arrived for this tick (or null = nothing new; the guard keeps its last held
 * state). The same inputs always give the same fight (replays, audits, property tests).
 *
 * STUB (planning stage): phases, clocks, rounds and the points decision are real; combat (punches, defence,
 * stamina, composure, knockdowns, fouls) is Agent G's job — the frame data below is the starting table from the plan.
 */

export const BOXING_META: GameMeta = {
  id: "boxing",
  version: "0.1.0",
  minPlayers: 2,
  maxPlayers: 2,
  usesRandomness: false,
  skillClassification: "pure-skill",
  realtime: "simultaneous",
};

/** seconds → ticks */
export const ticks = (seconds: number): number => Math.round(seconds * TICK_HZ);
export const COUNTDOWN_TICKS = ticks(3);
export const KNOCKDOWN_COUNT_TICKS = ticks(8);
/** knockdowns that stop the fight (TKO-equivalent) */
export const STOPPAGE_KNOCKDOWNS_ROUND = 3;
export const STOPPAGE_KNOCKDOWNS_MATCH = 4;

/** frame data (ticks at 30 Hz), reach (cm), costs and value of a clean hit — starting values, tuned by Agent G */
export interface PunchSpec {
  windup: number;
  active: number;
  recovery: number;
  /** longest distance that can land (cm) */
  reach: number;
  /** stamina cost (0..1000 scale); a whiff costs WHIFF_EXTRA more */
  stamina: number;
  /** points for a clean hit */
  points: number;
  /** composure taken by a clean hit (0..1000 scale) */
  composure: number;
}
export const PUNCH_SPECS: Record<Punch, PunchSpec> = {
  jab: { windup: 6, active: 3, recovery: 7, reach: 190, stamina: 30, points: 1, composure: 40 },
  cross: { windup: 9, active: 3, recovery: 11, reach: 180, stamina: 55, points: 2, composure: 80 },
  hook: { windup: 11, active: 4, recovery: 13, reach: 130, stamina: 70, points: 3, composure: 120 },
  uppercut: { windup: 12, active: 4, recovery: 15, reach: 110, stamina: 80, points: 3, composure: 140 },
};
export const WHIFF_EXTRA = 20;
export const DIST = { min: 70, max: 360, start: 260, step: 45 } as const;

export interface FighterState {
  id: string;
  corner: Corner;
  act: FighterAct;
  actT: number;
  stage: ActStage;
  guard: boolean;
  stamina: number;
  composure: number;
  points: number;
  knockdowns: number;
  roundKnockdowns: number;
  power: number;
  warnings: number;
  connected: boolean;
  /** ticks since this fighter's last input during a round (IDLE foul) */
  idle: number;
  /** last accepted input seq */
  seq: number;
}

export interface FightState {
  rules: FightRules;
  tick: number;
  phase: FightPhase;
  /** ticks left in the phase (intro: waits for `beginFight`) */
  left: number;
  round: number;
  dist: number;
  fighters: [FighterState, FighterState];
  /** points per finished round, by fighter */
  rounds: [number, number][];
  /** points at the start of the current round (round totals = points − this) */
  roundStart: [number, number];
  /** what happened on the last tick (the room broadcasts them, then they are replaced) */
  events: FightEvent[];
  /** phase to go back to after a pause */
  resume: { phase: FightPhase; left: number } | null;
  outcome: BoxingOutcome | null;
}

/** inputs that arrived for this tick, by fighter index (0 = red, 1 = blue); null = nothing new */
export type TickInputs = readonly [FightInput | null, FightInput | null];

const fighter = (id: string, corner: Corner): FighterState => ({
  id,
  corner,
  act: "idle",
  actT: 0,
  stage: "none",
  guard: true,
  stamina: 1000,
  composure: 1000,
  points: 0,
  knockdowns: 0,
  roundKnockdowns: 0,
  power: 0,
  warnings: 0,
  connected: true,
  idle: 0,
  seq: -1,
});

export function createFight(
  players: readonly [string, string],
  rules: FightRules = DEFAULT_FIGHT_RULES,
): FightState {
  return {
    rules,
    tick: 0,
    phase: "intro",
    left: 0,
    round: 0,
    dist: DIST.start,
    fighters: [fighter(players[0], "red"), fighter(players[1], "blue")],
    rounds: [],
    roundStart: [0, 0],
    events: [],
    resume: null,
    outcome: null,
  };
}

/** both fighters are in the ring and ready: the opening countdown starts */
export function beginFight(s: FightState): FightState {
  if (s.phase !== "intro") return s;
  return { ...s, phase: "countdown", left: COUNTDOWN_TICKS, events: [] };
}

function decide(s: FightState): BoxingOutcome {
  const [a, b] = s.fighters;
  const points: [number, number] = [a.points, b.points];
  const knockdowns: [number, number] = [a.knockdowns, b.knockdowns];
  const power: [number, number] = [a.power, b.power];
  // points → knockdowns scored (= the other's knockdowns) → power punches → draw (plan §2.6)
  const order: [number, number][] = [points, [b.knockdowns, a.knockdowns], power];
  let winner: 0 | 1 | null = null;
  for (const [x, y] of order) {
    if (x !== y) {
      winner = x > y ? 0 : 1;
      break;
    }
  }
  return {
    decision: winner === null ? "draw" : "points",
    winner,
    points,
    knockdowns,
    power,
    rounds: s.rounds,
  };
}

/** One tick. Pure: never mutates `s`. */
export function stepFight(s: FightState, inputs: TickInputs): FightState {
  if (s.phase === "over" || s.phase === "intro" || s.phase === "paused")
    return s.events.length ? { ...s, events: [] } : s;
  const t = s.tick + 1;
  const events: FightEvent[] = [];
  const fighters = s.fighters.map((f, i) => {
    const inp = inputs[i];
    if (!inp || inp.seq <= f.seq) return f;
    // TODO(Agent G): presses → actions, frame data, hits / blocks / evades, stamina, composure, knockdowns, fouls
    return { ...f, guard: inp.g, seq: inp.seq, idle: 0 };
  }) as [FighterState, FighterState];
  let next: FightState = { ...s, tick: t, fighters, events, left: s.left - 1 };
  if (next.left > 0) return next;

  // phase transitions
  if (s.phase === "countdown" || s.phase === "rest") {
    const round = s.round + 1;
    events.push({ k: "bell", t, round });
    return {
      ...next,
      phase: "round",
      round,
      left: ticks(s.rules.roundSeconds),
      roundStart: [fighters[0].points, fighters[1].points],
    };
  }
  if (s.phase === "round") {
    const pts: [number, number] = [
      fighters[0].points - s.roundStart[0],
      fighters[1].points - s.roundStart[1],
    ];
    events.push({ k: "roundEnd", t, round: s.round, points: pts });
    next = {
      ...next,
      rounds: [...s.rounds, pts],
      fighters: fighters.map((f) => ({ ...f, roundKnockdowns: 0 })) as [FighterState, FighterState],
    };
    if (s.round >= s.rules.rounds) {
      const outcome = decide(next);
      events.push({ k: "over", t, result: outcome });
      return { ...next, phase: "over", left: 0, outcome };
    }
    return { ...next, phase: "rest", left: ticks(s.rules.restSeconds) };
  }
  // knockdown count over (combat stub: not reached yet)
  return { ...next, phase: "round", left: 1 };
}

/** referee time-out (a fighter disconnected, or staff): the clock stops for both */
export function pauseFight(s: FightState, reason: "DISCONNECT" | "STAFF", who?: 0 | 1): FightState {
  if (s.phase === "over" || s.phase === "paused") return s;
  return {
    ...s,
    resume: { phase: s.phase, left: s.left },
    phase: "paused",
    events: [{ k: "pause", t: s.tick, reason, ...(who !== undefined ? { who } : {}) }],
  };
}
export function resumeFight(s: FightState): FightState {
  if (s.phase !== "paused" || !s.resume) return s;
  return {
    ...s,
    phase: s.resume.phase,
    left: s.resume.left,
    resume: null,
    events: [{ k: "resume", t: s.tick }],
  };
}

/** a fighter left / timed out after the fight began (exit rules): the other one wins */
export function forfeitFight(s: FightState, loser: 0 | 1): FightState {
  if (s.phase === "over") return s;
  const base = decide(s);
  const outcome: BoxingOutcome = { ...base, decision: "forfeit", winner: (1 - loser) as 0 | 1 };
  return { ...s, phase: "over", left: 0, outcome, events: [{ k: "over", t: s.tick, result: outcome }] };
}
export function voidFight(s: FightState): FightState {
  if (s.phase === "over") return s;
  const outcome: BoxingOutcome = { ...decide(s), decision: "void", winner: null };
  return { ...s, phase: "over", left: 0, outcome, events: [{ k: "over", t: s.tick, result: outcome }] };
}

/** has the fight "really begun" (exit rules: before it, leaving voids): the opening bell rang and someone acted */
export const hasBegun = (s: FightState): boolean => s.round >= 1 && s.fighters.some((f) => f.seq >= 0);

export const isOver = (s: FightState): boolean => s.phase === "over";

/** the settle payload for the API / signer (ranks: 1 = winner, equal = draw) */
export function matchResultOf(s: FightState): MatchResult {
  const o = s.outcome ?? decide(s);
  const [a, b] = s.fighters;
  const ranks =
    o.winner === null
      ? { [a.id]: 1, [b.id]: 1 }
      : { [a.id]: o.winner === 0 ? 1 : 2, [b.id]: o.winner === 1 ? 1 : 2 };
  const reason = o.decision === "forfeit" ? "forfeit" : o.decision === "void" ? "void" : "normal";
  return { ranks, scores: { [a.id]: a.points, [b.id]: b.points }, reason };
}

export function snapshotOf(s: FightState, ring: RingId): BoxingSnapshot {
  return {
    ring,
    tick: s.tick,
    phase: s.phase,
    round: s.round,
    rounds: s.rules.rounds,
    left: s.left,
    dist: s.dist,
    orbit: 0, // TODO(Agent G): deterministic orbit from slips / steps
    fighters: s.fighters.map((f) => ({
      id: f.id,
      corner: f.corner,
      act: f.act,
      actT: f.actT,
      stage: f.stage,
      guard: f.guard,
      stamina: f.stamina,
      composure: f.composure,
      points: f.points,
      knockdowns: f.knockdowns,
      warnings: f.warnings,
      connected: f.connected,
    })) as BoxingSnapshot["fighters"],
  };
}

export const hashFight = (s: FightState): string => stableStringify({ ...s, events: [] });
