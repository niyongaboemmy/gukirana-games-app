import {
  DEFAULT_FIGHT_RULES,
  INPUT_BUFFER_TICKS,
  TICK_HZ,
  isPunch,
  type ActStage,
  type BoxingAction,
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
 * Symmetry: both fighters are advanced independently from the same pre-tick state, then every punch is resolved
 * against that same state and all effects are applied together — swapping the corners' inputs swaps the result.
 *
 * Event convention: `by` on hit / block / evade / whiff is the PUNCHER; `to` on knockdown / up / warning is the
 * fighter it happens to.
 */

export const BOXING_META: GameMeta = {
  id: "boxing",
  version: "1.0.0",
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
/** points to the other fighter on a knockdown */
export const KNOCKDOWN_POINTS = 5;
/** composure a fighter rises with after the count */
export const RISE_COMPOSURE = 600;

/** frame data (ticks at 30 Hz), reach (cm), costs and value of a clean hit — tuned with simulations (§9) */
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
  jab: { windup: 6, active: 3, recovery: 7, reach: 190, stamina: 30, points: 1, composure: 60 },
  cross: { windup: 9, active: 3, recovery: 11, reach: 180, stamina: 55, points: 2, composure: 110 },
  hook: { windup: 11, active: 4, recovery: 13, reach: 130, stamina: 70, points: 3, composure: 170 },
  uppercut: { windup: 12, active: 4, recovery: 15, reach: 110, stamina: 80, points: 3, composure: 190 },
};
export const WHIFF_EXTRA = 20;
export const DIST = { min: 70, max: 360, start: 260, step: 45 } as const;

/** non-punch frame data (ticks) */
export const MOVE = {
  /** slip: total ticks, evasive window [from, to] (inclusive, actT) */
  slip: { ticks: 10, from: 2, to: 7, stamina: 25 },
  /** step in / out: total ticks; the 45 cm are covered over the first `moveTicks` ticks */
  step: { ticks: 8, moveTicks: 5, stamina: 15 },
  staggered: 10,
  blockHit: 6,
  rising: 15,
} as const;
/** extra windup ticks when the punch starts from a held guard / while tired */
export const GUARD_WINDUP = 2;
export const TIRED_WINDUP = 2;
export const TIRED_STAMINA = 300;
/** below this, hooks and uppercuts are refused ("Too tired") */
export const EXHAUSTED_STAMINA = 100;
/** a blocked punch costs the defender this much stamina */
export const BLOCK_STAMINA = 15;
/** a clean hit shortens the puncher's recovery by this many ticks (a whiff / evade keeps the full recovery) */
export const HIT_RECOVERY_BONUS = 3;
export const COUNTER_WINDOW = 12;
export const COMBO_WINDOW = 18;
export const COMBO_MAX = 4;
export const COMBO_BONUS_FROM = 3;
export const PASSIVITY_TICKS = ticks(15);
/** stamina / composure regeneration per tick */
export const REGEN = {
  stamina: 3,
  staminaRested: 5,
  blockDrain: 2,
  composure: 1,
  composureEvery: 3,
  restStamina: 8,
  restComposure: 10,
} as const;

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
  /** clean power punches landed (cross / hook / uppercut) */
  power: number;
  warnings: number;
  connected: boolean;
  /** ticks since this fighter's last input during a round (IDLE foul) */
  idle: number;
  /** IDLE strikes in a row (any input resets; the room forfeits at `maxTimeouts`) */
  idleStrikes: number;
  /** ticks since this fighter last threw a punch in this round (PASSIVITY) */
  passive: number;
  /** last accepted input seq */
  seq: number;
  /** sent an input after the opening bell (exit rules "first move") */
  acted: boolean;
  /** current punch: effective windup / recovery, counter flag, already resolved */
  wind: number;
  rec: number;
  counter: boolean;
  resolved: boolean;
  /** a press made while busy (dropped after INPUT_BUFFER_TICKS) */
  buf: { a: BoxingAction; ttl: number } | null;
  /** tick of the last evade / block of an opponent's punch (counter window) */
  defendAt: number;
  /** tick of the last clean hit + combo length */
  hitAt: number;
  combo: number;
}

export interface FightState {
  rules: FightRules;
  tick: number;
  phase: FightPhase;
  /** ticks left in the phase (intro: waits for `beginFight`) */
  left: number;
  round: number;
  dist: number;
  /** presentation orbit (deg × 10, 0..3599) */
  orbit: number;
  fighters: [FighterState, FighterState];
  /** points per finished round, by fighter */
  rounds: [number, number][];
  /** points at the start of the current round (round totals = points − this) */
  roundStart: [number, number];
  /** round clock left when a knockdown count started (restored when the fighter rises) */
  held: number;
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
  idleStrikes: 0,
  passive: 0,
  seq: -1,
  acted: false,
  wind: 0,
  rec: 0,
  counter: false,
  resolved: false,
  buf: null,
  defendAt: -1000,
  hitAt: -1000,
  combo: 0,
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
    orbit: 0,
    fighters: [fighter(players[0], "red"), fighter(players[1], "blue")],
    rounds: [],
    roundStart: [0, 0],
    held: 0,
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

/* ------------------------------------------------------------ helpers ------------------------------------------------------------ */

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const isPunchAct = (a: FighterAct): a is Punch => isPunch(a);
const isSlip = (a: FighterAct): boolean => a === "slipL" || a === "slipR";
const isStep = (a: FighterAct): boolean => a === "stepIn" || a === "stepOut";

/** total ticks of the fighter's current act (0 = no end: idle / down / over poses) */
export function actTicks(f: FighterState): number {
  if (isPunchAct(f.act)) return f.wind + PUNCH_SPECS[f.act].active + f.rec;
  if (isSlip(f.act)) return MOVE.slip.ticks;
  if (isStep(f.act)) return MOVE.step.ticks;
  if (f.act === "staggered") return MOVE.staggered;
  if (f.act === "blockHit") return MOVE.blockHit;
  if (f.act === "rising") return MOVE.rising;
  return 0;
}

export function stageOf(f: Pick<FighterState, "act" | "actT" | "wind">): ActStage {
  if (isPunchAct(f.act)) {
    if (f.actT < f.wind) return "windup";
    if (f.actT < f.wind + PUNCH_SPECS[f.act].active) return "active";
    return "recovery";
  }
  if (isSlip(f.act)) {
    if (f.actT < MOVE.slip.from) return "windup";
    if (f.actT <= MOVE.slip.to) return "active";
    return "recovery";
  }
  if (isStep(f.act)) return f.actT < MOVE.step.moveTicks ? "active" : "recovery";
  return "none";
}

/** can this fighter start a press right now (exported for the client's prediction) */
export const isBusy = (f: FighterState): boolean => f.act !== "idle";

/** would this press be refused outright (the "Too tired" hint)? */
export const isTooTired = (f: FighterState, a: BoxingAction): boolean =>
  (a === "hook" || a === "uppercut") && f.stamina < EXHAUSTED_STAMINA;

function startAct(f: FighterState, a: BoxingAction, t: number): FighterState {
  if (isTooTired(f, a)) return f;
  if (isPunch(a)) {
    const spec = PUNCH_SPECS[a];
    const wind = spec.windup + (f.guard ? GUARD_WINDUP : 0) + (f.stamina < TIRED_STAMINA ? TIRED_WINDUP : 0);
    return {
      ...f,
      act: a,
      actT: 0,
      wind,
      rec: spec.recovery,
      counter: t - f.defendAt <= COUNTER_WINDOW,
      resolved: false,
      stamina: Math.max(0, f.stamina - spec.stamina),
      passive: 0,
    };
  }
  const cost = a === "slipL" || a === "slipR" ? MOVE.slip.stamina : MOVE.step.stamina;
  return { ...f, act: a, actT: 0, wind: 0, rec: 0, resolved: false, stamina: Math.max(0, f.stamina - cost) };
}

function withStage(f: FighterState): FighterState {
  const stage = stageOf(f);
  return f.stage === stage ? f : { ...f, stage };
}

/** guard / seq bookkeeping of an input outside the round (presses are dropped) */
function takeGuardOnly(f: FighterState, inp: FightInput | null): FighterState {
  if (!inp || inp.seq <= f.seq) return f;
  return { ...f, guard: inp.g, seq: inp.seq };
}

const resetForBell = (f: FighterState): FighterState => ({
  ...f,
  act: "idle",
  actT: 0,
  stage: "none",
  buf: null,
  resolved: false,
  idle: 0,
  passive: 0,
  roundKnockdowns: 0,
  combo: 0,
});

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

/** end poses: the winner celebrates, the loser nods (draw / void: guard) */
function endPoses(fs: [FighterState, FighterState], winner: 0 | 1 | null): [FighterState, FighterState] {
  return fs.map((f, i) => ({
    ...f,
    act: winner === null ? "idle" : winner === i ? "celebrate" : "dejected",
    actT: 0,
    stage: "none",
    buf: null,
  })) as [FighterState, FighterState];
}

function finish(s: FightState, outcome: BoxingOutcome, events: FightEvent[]): FightState {
  events.push({ k: "over", t: s.tick, result: outcome });
  return { ...s, phase: "over", left: 0, outcome, fighters: endPoses(s.fighters, outcome.winner), events };
}

/** the points of the current (unfinished) round, by fighter */
const roundPoints = (s: FightState): [number, number] => [
  s.fighters[0].points - s.roundStart[0],
  s.fighters[1].points - s.roundStart[1],
];

/* ------------------------------------------------------------ the round tick ------------------------------------------------------------ */

/** one fighter's own part of a round tick: timers, input, buffer, stamina — independent of the other fighter */
function advanceFighter(f0: FighterState, inp: FightInput | null, t: number): FighterState {
  let f = f0;
  // 1. the current act runs on
  if (f.act !== "idle") {
    const actT = f.actT + 1;
    const total = actTicks(f);
    f = total > 0 && actT >= total ? { ...f, act: "idle", actT: 0, resolved: false } : { ...f, actT };
  }
  // 2. the input of this tick
  let press: BoxingAction | null = null;
  let buf = f.buf;
  if (buf) buf = buf.ttl > 1 ? { a: buf.a, ttl: buf.ttl - 1 } : null;
  if (inp && inp.seq > f.seq) {
    f = { ...f, guard: inp.g, seq: inp.seq, idle: 0, idleStrikes: 0, acted: true };
    if (inp.a) {
      if (isBusy(f)) buf = { a: inp.a, ttl: INPUT_BUFFER_TICKS };
      else press = inp.a;
    }
  } else {
    f = { ...f, idle: f.idle + 1 };
  }
  if (!press && !isBusy(f) && buf) {
    press = buf.a;
    buf = null;
  }
  f = { ...f, buf, passive: f.passive + 1 };
  if (press) f = startAct(f, press, t);
  // 3. stamina / composure
  let stamina = f.stamina;
  if (f.act === "blockHit") stamina -= REGEN.blockDrain;
  else if (!isPunchAct(f.act)) stamina += f.act === "idle" && !f.guard ? REGEN.staminaRested : REGEN.stamina;
  const composure =
    f.act === "down" || t % REGEN.composureEvery !== 0 ? f.composure : f.composure + REGEN.composure;
  f = { ...f, stamina: clamp(stamina, 0, 1000), composure: clamp(composure, 0, 1000) };
  return withStage(f);
}

type Resolution =
  | { kind: "pending" }
  | { kind: "whiff" }
  | { kind: "evade" }
  | { kind: "block" }
  | { kind: "hit"; partial: boolean };

/** does the attacker's punch land this tick? Uses only the (already advanced) pre-resolution state. */
function resolvePunch(att: FighterState, def: FighterState, dist: number): Resolution {
  if (!isPunchAct(att.act) || att.resolved || stageOf(att) !== "active") return { kind: "pending" };
  const spec = PUNCH_SPECS[att.act];
  const lastActive = att.actT === att.wind + spec.active - 1;
  if (dist > spec.reach)
    return lastActive ? (def.act === "stepOut" ? { kind: "evade" } : { kind: "whiff" }) : { kind: "pending" };
  // slip: evades straights and uppercuts in its evasive ticks; hooks catch a slip
  if (isSlip(def.act) && def.actT >= MOVE.slip.from && def.actT <= MOVE.slip.to && att.act !== "hook")
    return { kind: "evade" };
  // guard: only while not throwing / not hurt
  const guarding =
    def.guard &&
    !(isPunchAct(def.act) && def.actT < def.wind + PUNCH_SPECS[def.act].active) &&
    def.act !== "staggered" &&
    def.act !== "down" &&
    def.act !== "rising";
  if (guarding) return att.act === "uppercut" ? { kind: "hit", partial: true } : { kind: "block" };
  return { kind: "hit", partial: false };
}

function stepRound(s: FightState, inputs: TickInputs, t: number, events: FightEvent[]): FightState {
  // 1. each fighter on its own
  let fs = [advanceFighter(s.fighters[0], inputs[0], t), advanceFighter(s.fighters[1], inputs[1], t)] as [
    FighterState,
    FighterState,
  ];
  // 2. footwork + presentation orbit
  let dist = s.dist;
  let orbit = s.orbit;
  for (const f of fs) {
    if (isStep(f.act) && f.actT < MOVE.step.moveTicks) {
      const d = Math.trunc(DIST.step / MOVE.step.moveTicks);
      dist += f.act === "stepIn" ? -d : d;
    }
    if (isSlip(f.act) && f.actT >= MOVE.slip.from && f.actT <= MOVE.slip.to)
      orbit += f.act === "slipL" ? 6 : -6;
  }
  dist = clamp(dist, DIST.min, DIST.max);
  orbit = ((orbit % 3600) + 3600) % 3600;

  // 3. punches, resolved against the same state for both
  const res: [Resolution, Resolution] = [resolvePunch(fs[0], fs[1], dist), resolvePunch(fs[1], fs[0], dist)];
  const next = fs.map((f) => ({ ...f })) as [FighterState, FighterState];
  for (const i of [0, 1] as const) {
    const r = res[i];
    if (r.kind === "pending") continue;
    const j = (1 - i) as 0 | 1;
    const att = next[i];
    const def = next[j];
    const punch = fs[i].act as Punch;
    const spec = PUNCH_SPECS[punch];
    att.resolved = true;
    if (r.kind === "whiff" || r.kind === "evade") {
      att.stamina = Math.max(0, att.stamina - WHIFF_EXTRA);
      if (r.kind === "evade") def.defendAt = t;
      events.push({ k: r.kind, t, by: i, punch });
      continue;
    }
    if (r.kind === "block") {
      def.stamina = Math.max(0, def.stamina - BLOCK_STAMINA);
      def.defendAt = t;
      if (def.act === "idle") Object.assign(def, { act: "blockHit", actT: 0 });
      events.push({ k: "block", t, by: i, punch });
      continue;
    }
    // a hit (clean, or an uppercut partly through the guard)
    const tired = fs[i].stamina < TIRED_STAMINA;
    let dmg = r.partial ? Math.trunc(spec.composure / 2) : spec.composure;
    if (tired) dmg = Math.trunc((dmg * 3) / 4);
    let points: number;
    let combo = att.combo;
    if (r.partial) {
      points = 1;
    } else {
      combo = t - att.hitAt <= COMBO_WINDOW ? Math.min(COMBO_MAX, att.combo + 1) : 1;
      points = spec.points + (fs[i].counter ? 1 : 0) + (combo >= COMBO_BONUS_FROM ? 1 : 0);
      att.combo = combo;
      att.hitAt = t;
      att.rec = Math.max(1, att.rec - HIT_RECOVERY_BONUS);
      if (punch !== "jab") att.power += 1;
    }
    att.points += points;
    def.composure = Math.max(0, def.composure - dmg);
    if (!r.partial) Object.assign(def, { act: "staggered", actT: 0, resolved: false, buf: null });
    events.push({
      k: "hit",
      t,
      by: i,
      punch,
      points,
      counter: !r.partial && fs[i].counter,
      combo: r.partial ? 0 : combo,
    });
  }
  fs = next.map(withStage) as [FighterState, FighterState];

  // 4. knockdowns
  const downed = ([0, 1] as const).filter((i) => fs[i].composure <= 0);
  if (downed.length) {
    for (const i of downed) {
      const j = (1 - i) as 0 | 1;
      fs[j] = { ...fs[j], points: fs[j].points + KNOCKDOWN_POINTS };
      fs[i] = {
        ...fs[i],
        act: "down",
        actT: 0,
        stage: "none",
        buf: null,
        knockdowns: fs[i].knockdowns + 1,
        roundKnockdowns: fs[i].roundKnockdowns + 1,
      };
      events.push({ k: "knockdown", t, to: i, points: KNOCKDOWN_POINTS });
    }
    for (const i of [0, 1] as const)
      if (!downed.includes(i)) fs[i] = { ...fs[i], act: "idle", actT: 0, stage: "none", buf: null };
    const stopped = ([0, 1] as const).filter(
      (i) =>
        fs[i].roundKnockdowns >= STOPPAGE_KNOCKDOWNS_ROUND || fs[i].knockdowns >= STOPPAGE_KNOCKDOWNS_MATCH,
    );
    const base: FightState = { ...s, tick: t, dist: DIST.start, orbit, fighters: fs, events };
    if (stopped.length === 1) {
      const winner = (1 - stopped[0]!) as 0 | 1;
      events.push({ k: "stoppage", t, winner });
      const withRound: FightState = { ...base, rounds: [...s.rounds, roundPoints(base)] };
      return finish(withRound, { ...decide(withRound), decision: "stoppage", winner }, events);
    }
    if (stopped.length === 2) {
      const withRound: FightState = { ...base, rounds: [...s.rounds, roundPoints(base)] };
      return finish(withRound, decide(withRound), events);
    }
    events.push({ k: "count", t, n: 1 });
    return { ...base, phase: "knockdown", left: KNOCKDOWN_COUNT_TICKS, held: s.left - 1 };
  }

  // 5. fouls
  const idleTicks = ticks(s.rules.idleSeconds);
  for (const i of [0, 1] as const) {
    let f = fs[i];
    if (f.passive >= PASSIVITY_TICKS) {
      const warnings = f.warnings + 1;
      const penalty = warnings >= 2 ? Math.min(1, f.points) : 0;
      f = { ...f, warnings, passive: 0, points: f.points - penalty };
      events.push({ k: "warning", t, to: i, foul: "PASSIVITY", penalty });
    }
    if (f.idle >= idleTicks) {
      f = { ...f, idle: 0, idleStrikes: f.idleStrikes + 1 };
      events.push({ k: "warning", t, to: i, foul: "IDLE", penalty: 0 });
    }
    fs[i] = f;
  }
  return { ...s, tick: t, dist, orbit, fighters: fs, events, left: s.left - 1 };
}

/* ------------------------------------------------------------ stepFight ------------------------------------------------------------ */

/** One tick. Pure: never mutates `s`. */
export function stepFight(s: FightState, inputs: TickInputs): FightState {
  if (s.phase === "over" || s.phase === "intro" || s.phase === "paused")
    return s.events.length ? { ...s, events: [] } : s;
  const t = s.tick + 1;
  const events: FightEvent[] = [];

  if (s.phase === "round") {
    const next = stepRound(s, inputs, t, events);
    if (next.phase !== "round" || next.left > 0) return next;
    // the bell ends the round
    const pts = roundPoints(next);
    events.push({ k: "roundEnd", t, round: s.round, points: pts });
    const ended: FightState = {
      ...next,
      rounds: [...s.rounds, pts],
      fighters: next.fighters.map(resetForBell) as [FighterState, FighterState],
    };
    if (s.round >= s.rules.rounds) return finish(ended, decide(ended), events);
    return { ...ended, phase: "rest", left: ticks(s.rules.restSeconds) };
  }

  if (s.phase === "knockdown") {
    const fighters = s.fighters.map((f, i) => takeGuardOnly(f, inputs[i] ?? null)) as [
      FighterState,
      FighterState,
    ];
    const left = s.left - 1;
    const elapsed = KNOCKDOWN_COUNT_TICKS - left;
    if (left > 0) {
      if (elapsed % TICK_HZ === 0) events.push({ k: "count", t, n: elapsed / TICK_HZ + 1 });
      return { ...s, tick: t, fighters, left, events };
    }
    // the count reached 8: the downed fighter rises; the round clock runs on where it stopped
    const up = fighters.map((f, i) => {
      if (f.act !== "down") return { ...f, act: "idle", actT: 0, stage: "none", idle: 0, passive: 0 };
      events.push({ k: "up", t, to: i as 0 | 1 });
      return { ...f, act: "rising", actT: 0, stage: "none", composure: RISE_COMPOSURE, idle: 0, passive: 0 };
    }) as [FighterState, FighterState];
    return { ...s, tick: t, fighters: up, phase: "round", left: Math.max(1, s.held), held: 0, events };
  }

  // countdown / rest
  let fighters = s.fighters.map((f, i) => takeGuardOnly(f, inputs[i] ?? null)) as [
    FighterState,
    FighterState,
  ];
  if (s.phase === "rest")
    fighters = fighters.map((f) => ({
      ...f,
      stamina: Math.min(1000, f.stamina + REGEN.restStamina),
      composure: Math.min(1000, f.composure + REGEN.restComposure),
    })) as [FighterState, FighterState];
  const left = s.left - 1;
  if (left > 0) return { ...s, tick: t, fighters, left, events };
  if (s.resume) {
    // the 3 s countdown after a pause: back to where the fight stopped
    const r = s.resume;
    return { ...s, tick: t, fighters, phase: r.phase, left: r.left, resume: null, events };
  }
  const round = s.round + 1;
  events.push({ k: "bell", t, round });
  return {
    ...s,
    tick: t,
    phase: "round",
    round,
    left: ticks(s.rules.roundSeconds),
    dist: DIST.start,
    fighters: fighters.map(resetForBell) as [FighterState, FighterState],
    roundStart: [fighters[0].points, fighters[1].points],
    events,
  };
}

/* ------------------------------------------------------------ pauses / exits ------------------------------------------------------------ */

/** referee time-out (a fighter disconnected, or staff): the clock stops for both */
export function pauseFight(s: FightState, reason: "DISCONNECT" | "STAFF", who?: 0 | 1): FightState {
  if (s.phase === "over" || s.phase === "paused") return s;
  const fighters =
    who === undefined
      ? s.fighters
      : (s.fighters.map((f, i) => (i === who ? { ...f, connected: false } : f)) as [
          FighterState,
          FighterState,
        ]);
  // a pause during the after-pause countdown keeps the original resume point
  const resume = s.phase === "countdown" && s.resume ? s.resume : { phase: s.phase, left: s.left };
  return {
    ...s,
    fighters,
    resume,
    phase: "paused",
    events: [{ k: "pause", t: s.tick, reason, ...(who !== undefined ? { who } : {}) }],
  };
}
/**
 * Back from a time-out. With a countdown (default, plan §3.5) the fight resumes after COUNTDOWN_TICKS; without one it
 * resumes on the next tick. Fighters go back to neutral (idle, start distance) when the round resumes.
 */
export function resumeFight(s: FightState, countdown = true): FightState {
  if (s.phase !== "paused" || !s.resume) return s;
  const fighters = s.fighters.map((f) => ({
    ...f,
    connected: true,
    ...(f.act === "down"
      ? {}
      : { act: "idle" as const, actT: 0, stage: "none" as const, buf: null, resolved: false }),
    idle: 0,
  })) as [FighterState, FighterState];
  const events: FightEvent[] = [{ k: "resume", t: s.tick }];
  // before the opening bell there is nothing to resume to but the countdown itself
  if (s.resume.phase === "countdown" || s.resume.phase === "intro")
    return {
      ...s,
      fighters,
      phase: s.resume.phase,
      left: s.resume.phase === "intro" ? 0 : COUNTDOWN_TICKS,
      resume: null,
      events,
    };
  if (!countdown) return { ...s, fighters, phase: s.resume.phase, left: s.resume.left, resume: null, events };
  return {
    ...s,
    fighters,
    dist: DIST.start,
    phase: "countdown",
    left: COUNTDOWN_TICKS,
    resume: s.resume,
    events,
  };
}

/** a fighter left / timed out after the fight began (exit rules): the other one wins */
export function forfeitFight(s: FightState, loser: 0 | 1): FightState {
  if (s.phase === "over") return s;
  const base = decide(s);
  const outcome: BoxingOutcome = { ...base, decision: "forfeit", winner: (1 - loser) as 0 | 1 };
  return finish({ ...s, events: [] }, outcome, []);
}
export function voidFight(s: FightState): FightState {
  if (s.phase === "over") return s;
  const outcome: BoxingOutcome = { ...decide(s), decision: "void", winner: null };
  return finish({ ...s, events: [] }, outcome, []);
}

/** has the fight "really begun" (exit rules: before it, leaving voids): the opening bell rang and someone acted */
export const hasBegun = (s: FightState): boolean => s.round >= 1 && s.fighters.some((f) => f.acted);

export const isOver = (s: FightState): boolean => s.phase === "over";

/** upper bound on the ticks of a fight without pauses (property tests, room watchdog) */
export function maxFightTicks(rules: FightRules): number {
  return (
    COUNTDOWN_TICKS +
    rules.rounds * ticks(rules.roundSeconds) +
    (rules.rounds - 1) * ticks(rules.restSeconds) +
    // every knockdown stops the clock for one count; at most (STOPPAGE_MATCH - 1) × 2 counts before a stoppage
    2 * (STOPPAGE_KNOCKDOWNS_MATCH - 1) * KNOCKDOWN_COUNT_TICKS +
    2
  );
}

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

/** referee count shown during a knockdown (1..8) */
export const countOf = (s: FightState): number | undefined =>
  s.phase === "knockdown"
    ? clamp(Math.trunc((KNOCKDOWN_COUNT_TICKS - s.left) / TICK_HZ) + 1, 1, 8)
    : undefined;

export function snapshotOf(s: FightState, ring: RingId): BoxingSnapshot {
  const count = countOf(s);
  return {
    ring,
    tick: s.tick,
    phase: s.phase,
    round: s.round,
    rounds: s.rules.rounds,
    left: s.left,
    dist: s.dist,
    orbit: s.orbit,
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
    ...(count !== undefined ? { count } : {}),
  };
}

export const hashFight = (s: FightState): string => stableStringify({ ...s, events: [] });
