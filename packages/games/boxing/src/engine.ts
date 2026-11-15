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
  type FightStatLine,
  type Punch,
  type RefereeFoul,
  type RingId,
  type RoundCard,
  scoringRulesOf,
} from "@gukirana/contracts";
import { stableStringify, type GameMeta, type MatchResult } from "@gukirana/game-kit";
import { addControl, cardFor, decideCards, emptyTally, tallyEvents, type RoundTally } from "./scoring.js";
import { DUCKING_SLIPS, FREE_BREAKS, foulEvent, ladderStep } from "./fouls.js";

/**
 * Boxing — deterministic fight engine v2 (P3-FGT-10, docs/FIGHT-GAME-V2.md §4).
 *
 * v1 (./v1/) knew only the distance between the boxers. v2 puts both on the canvas: free 2D footwork (forward / back,
 * lateral steps, circling at a constant distance, pivots), solid bodies (the two centres never come closer than
 * BODY_SEP; contact pushes), the ropes as hard walls, five punches to head or body with real frame data, and a full
 * defence set (guard, parry, slip, duck / roll, step out, clinch) plus feints.
 *
 * One pure step per tick (TICK_HZ = 30): `stepFight(state, inputs)` → next state. Integer-only (positions in mm,
 * velocities in mm / tick), no randomness, no clocks, no trigonometry (only exact integer maths and `isqrt`), so the
 * same inputs always give the same fight on every machine (replays, the pre-sign audit, property tests).
 *
 * Symmetry: both fighters are advanced from the same pre-tick state, every punch is resolved against that same state
 * and all effects are applied together; mirroring the corners mirrors the fight.
 *
 * Event convention (unchanged from v1): `by` on hit / block / evade / whiff / parry is the PUNCHER; `to` on knockdown /
 * up / warning is the fighter it happens to; `by` on clinch is the fighter who tied up.
 */

export const ENGINE_VERSION = 2 as const;
export const BOXING_META: GameMeta = {
  id: "boxing",
  version: "2.0.0",
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
/** a count-out runs to 10 (KO) */
export const KO_COUNT_TICKS = ticks(10);
export const STOPPAGE_KNOCKDOWNS_ROUND = 3;
export const STOPPAGE_KNOCKDOWNS_MATCH = 4;
/** points to the other fighter on a knockdown */
export const KNOCKDOWN_POINTS = 5;
/** composure on rising from the first knockdown (each further knockdown: RISE_STEP less) */
export const RISE_COMPOSURE = 650;
export const RISE_STEP = 100;

/* ------------------------------------------------------------ geometry (mm) ------------------------------------------------------------ */

/**
 * The canvas (ring-local, centre = 0, axes along the ropes). A standard ring has 4.3 m inside the ropes: the ropes are
 * at ±ROPE; a boxer's centre stays LIMIT from the centre on each axis (torso + guard clear of the ropes).
 */
export const RING_MM = { rope: 2150, limit: 1800, ropeZone: 170, cornerZone: 300 } as const;
/** two torsos with the arms in guard: the centres never come closer than this */
export const BODY_SEP = 640;
/** the pair at the bell / after a break / after a count: this far apart along the x axis */
export const START_GAP = 1800;
export const BREAK_GAP = 1500;
/** in this range without a punch the referee sees holding / smothering (CLOSE_TICKS → "Break!") */
export const CLOSE_MM = 720;
export const CLOSE_TICKS = ticks(3);
export const BREAK_TICKS = TICK_HZ;
/** a clinch can be started from this far, and lasts at most this long before the referee breaks it */
export const CLINCH_REACH = 900;
export const CLINCH_TICKS = ticks(2);

/** walking speeds (mm / tick at 30 Hz: 34 ≈ 1.0 m/s) and the response (a body has weight: no instant velocity) */
export const MOVE_SPEED = { fwd: 34, back: 30, lat: 28, accel: 7, brake: 11 } as const;

/* ------------------------------------------------------------ punches ------------------------------------------------------------ */

export interface PunchSpec {
  windup: number;
  active: number;
  recovery: number;
  /** longest centre-to-centre distance that lands (mm); body shots reach BODY_REACH less */
  reach: number;
  /** straights are smothered (partial) closer than this (mm); 0 = never */
  smother: number;
  /** stamina cost (0..1000); a whiff costs WHIFF_EXTRA more and overreaches (WHIFF_RECOVERY ticks) */
  stamina: number;
  /** points for a clean hit (before counter / combo bonuses) */
  points: number;
  /** composure taken by a clean hit (0..1000) */
  damage: number;
  /** ticks the target is staggered by a clean hit */
  stagger: number;
  /** knock-back given to the target (mm / tick) */
  push: number;
  /** a straight (jab / cross: can be parried, slipped) or a hook (ducked, catches slips) or an uppercut (catches ducks) */
  kind: "straight" | "hook" | "uppercut";
  /** how far (mm) the target may have moved off the punch's line since it was thrown and still be hit */
  track: number;
}
/** frame data tuned with the skill-separation simulations (docs/FIGHT-GAME-V2.md §5, sim.test.ts) */
export const PUNCH_SPECS: Record<Punch, PunchSpec> = {
  jab: { windup: 4, active: 2, recovery: 7, reach: 1180, smother: 700, stamina: 18, points: 1, damage: 45, stagger: 5, push: 18, kind: "straight", track: 150 },
  cross: { windup: 7, active: 2, recovery: 10, reach: 1120, smother: 720, stamina: 40, points: 2, damage: 95, stagger: 8, push: 34, kind: "straight", track: 170 },
  hook: { windup: 8, active: 3, recovery: 11, reach: 860, smother: 0, stamina: 48, points: 2, damage: 115, stagger: 9, push: 26, kind: "hook", track: 300 },
  rhook: { windup: 10, active: 3, recovery: 13, reach: 840, smother: 0, stamina: 60, points: 3, damage: 145, stagger: 11, push: 30, kind: "hook", track: 320 },
  uppercut: { windup: 9, active: 3, recovery: 13, reach: 760, smother: 0, stamina: 56, points: 3, damage: 145, stagger: 11, push: 28, kind: "uppercut", track: 180 },
};
export const BODY_REACH = 60;
/** a body shot: one tick slower, less balance taken, but it drains the target's stamina and lowers their ceiling */
export const BODY = { windup: 1, damagePct: 60, staminaPct: 80, wearPct: 34 } as const;
export const WHIFF_EXTRA = 16;
export const WHIFF_RECOVERY = 4;
/** extra windup when the punch starts from a held guard / while tired */
export const GUARD_WINDUP = 2;
export const TIRED_WINDUP = 2;
export const TIRED_STAMINA = 300;
/** below this the hooks and the uppercut are refused ("Too tired") */
export const EXHAUSTED_STAMINA = 100;
/** a clean hit shortens the puncher's recovery (punches flow into combinations) */
export const HIT_RECOVERY_BONUS = 3;
/** a punch started within this many ticks after a successful defence (or a read feint) is a counter */
export const COUNTER_WINDOW = 12;
export const COMBO_WINDOW = 18;
export const COMBO_MAX = 4;
export const COMBO_BONUS_FROM = 3;
/** after a pivot ends the pivoting fighter has the angle this long: the defender's guard does not cover it */
export const ANGLE_TICKS = 12;
export const PASSIVITY_TICKS = ticks(15);

/** non-punch frame data (ticks): total, and the window [from, to] (actT, inclusive) in which it works */
export const MOVE = {
  slip: { ticks: 11, from: 2, to: 7, stamina: 14 },
  duck: { ticks: 13, from: 2, to: 8, stamina: 18 },
  parry: { ticks: 10, from: 1, to: 4, stamina: 8, recovery: 9 },
  /** step in / out: a burst of `speed` mm / tick over the first moveTicks ticks */
  step: { ticks: 8, moveTicks: 6, speed: 62, stamina: 14 },
  pivot: { ticks: 8, moveTicks: 6, speed: 78, stamina: 16 },
  feint: { ticks: 8, stamina: 6 },
  clinch: { ticks: 5, grab: 3, stamina: 10 },
  blockHit: 5,
  rising: 15,
} as const;
export const BLOCK_STAMINA = 10;
/** a blocked power punch still costs a little balance (a shell is not free) */
export const BLOCK_CHIP = 12;
export const REGEN = {
  /** idle with the guard down / guard up / moving (stamina per tick) */
  rest: 5,
  guard: 3,
  moving: 1,
  clinchHolder: 7,
  clinchHeld: 3,
  /** composure +1 every `composureEvery` ticks */
  composureEvery: 2,
  restStamina: 8,
  restComposure: 10,
} as const;

/* ------------------------------------------------------------ state ------------------------------------------------------------ */

export interface FighterState {
  id: string;
  corner: Corner;
  act: FighterAct;
  actT: number;
  stage: ActStage;
  guard: boolean;
  /** held footwork direction [lateral +1 = right, forward +1 = towards the opponent] */
  mv: [number, number];
  /** position and velocity (mm, mm / tick) */
  x: number;
  z: number;
  vx: number;
  vz: number;
  stamina: number;
  composure: number;
  /** accumulated head wear / body wear (0..1000): lower the composure / stamina ceilings */
  wear: number;
  bodyWear: number;
  points: number;
  knockdowns: number;
  roundKnockdowns: number;
  /** clean power punches landed */
  power: number;
  warnings: number;
  cautions: number;
  deductions: number;
  /** ticks in close range without punching (HOLDING) and "Break!" calls on this fighter this round */
  close: number;
  breaks: number;
  /** slips / ducks in a row without a punch (DUCKING) */
  slips: number;
  breakFoul: boolean;
  connected: boolean;
  idle: number;
  idleStrikes: number;
  passive: number;
  seq: number;
  acted: boolean;
  /** current punch: effective windup / recovery, body shot, counter flag, resolved, thrown from the angle */
  wind: number;
  rec: number;
  body: boolean;
  counter: boolean;
  resolved: boolean;
  /** a press made while busy (dropped after INPUT_BUFFER_TICKS) */
  buf: { a: BoxingAction; b: boolean; ttl: number } | null;
  /** tick of the last successful defence (counter window), of a feint the opponent bit on, of the angle */
  defendAt: number;
  readAt: number;
  angleUntil: number;
  hitAt: number;
  combo: number;
  /** where my current punch is aimed: the opponent's position when I threw it (a moving target leaves the line) */
  aimX: number;
  aimZ: number;
  /* skill-report counters (docs/FIGHT-GAME-V2.md §6) */
  /** ring control (2 per tick with the opponent on the ropes, 1 per tick holding the centre) */
  ctl: number;
  gassed: number;
  landedTired: number;
}

export interface ClinchState {
  holders: (0 | 1)[];
  left: number;
}

export interface FightState {
  /** engine version (replays pick the engine by it) */
  v: 2;
  rules: FightRules;
  tick: number;
  phase: FightPhase;
  left: number;
  round: number;
  /** centre-to-centre distance (cm, derived from the positions every tick; kept for the HUD / v1 readers) */
  dist: number;
  /** angle of the pair (deg × 10, derived: presentation / v1 readers) */
  orbit: number;
  fighters: [FighterState, FighterState];
  rounds: [number, number][];
  tally: RoundTally;
  tallies: RoundTally[];
  cards: RoundCard[];
  breakLeft: number;
  clinch: ClinchState | null;
  ko: 0 | 1 | null;
  staked: boolean;
  koBoth?: boolean;
  roundStart: [number, number];
  held: number;
  /** ticks of round time fought (skill report: output per minute) */
  fought: number;
  events: FightEvent[];
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
  mv: [0, 0],
  x: corner === "red" ? -START_GAP / 2 : START_GAP / 2,
  z: 0,
  vx: 0,
  vz: 0,
  stamina: 1000,
  composure: 1000,
  wear: 0,
  bodyWear: 0,
  points: 0,
  knockdowns: 0,
  roundKnockdowns: 0,
  power: 0,
  warnings: 0,
  cautions: 0,
  deductions: 0,
  close: 0,
  breaks: 0,
  slips: 0,
  breakFoul: false,
  connected: true,
  idle: 0,
  idleStrikes: 0,
  passive: 0,
  seq: -1,
  acted: false,
  wind: 0,
  rec: 0,
  body: false,
  counter: false,
  resolved: false,
  buf: null,
  defendAt: -1000,
  readAt: -1000,
  angleUntil: -1000,
  hitAt: -1000,
  combo: 0,
  aimX: 0,
  aimZ: 0,
  ctl: 0,
  gassed: 0,
  landedTired: 0,
});

export function createFight(
  players: readonly [string, string],
  rules: FightRules = DEFAULT_FIGHT_RULES,
  opts: { staked?: boolean } = {},
): FightState {
  return {
    v: 2,
    rules,
    tick: 0,
    phase: "intro",
    left: 0,
    round: 0,
    dist: START_GAP / 10,
    orbit: 0,
    fighters: [fighter(players[0], "red"), fighter(players[1], "blue")],
    rounds: [],
    tally: emptyTally(),
    tallies: [],
    cards: [],
    breakLeft: 0,
    clinch: null,
    ko: null,
    staked: opts.staked ?? false,
    roundStart: [0, 0],
    held: 0,
    fought: 0,
    events: [],
    resume: null,
    outcome: null,
  };
}

export function beginFight(s: FightState): FightState {
  if (s.phase !== "intro") return s;
  return { ...s, phase: "countdown", left: COUNTDOWN_TICKS, events: [] };
}

/* ------------------------------------------------------------ integer geometry ------------------------------------------------------------ */

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
/** exact integer square root (floor) */
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}
/** centre-to-centre distance of the two fighters (mm) */
export const gapOf = (a: { x: number; z: number }, b: { x: number; z: number }): number =>
  isqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
/** a vector scaled to length `len` (integer, truncated toward zero) */
const scaleTo = (dx: number, dz: number, len: number): [number, number] => {
  const d = isqrt(dx * dx + dz * dz);
  if (d === 0) return [0, 0];
  return [Math.trunc((dx * len) / d), Math.trunc((dz * len) / d)];
};
/** integer orbit (deg × 10) of the pair axis, from a small table (no trig: atan via octant + ratio) */
function orbitOf(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  if (dx === 0 && dz === 0) return 0;
  const ax = Math.abs(dx);
  const az = Math.abs(dz);
  // atan(r) for r in [0,1] ≈ 450·r·(1 + 0.2732·(1 − r))  (deg × 10, max error < 0.4°)
  const lo = Math.min(ax, az);
  const hi = Math.max(ax, az);
  const r1000 = Math.trunc((lo * 1000) / hi);
  let a10 = Math.trunc((450 * r1000 * (10000 + Math.trunc((2732 * (1000 - r1000)) / 1000))) / 10_000_000);
  if (az > ax) a10 = 900 - a10;
  if (dx < 0) a10 = 1800 - a10;
  if (dz < 0) a10 = 3600 - a10;
  return ((a10 % 3600) + 3600) % 3600;
}
const onRopes = (f: { x: number; z: number }): boolean =>
  Math.max(Math.abs(f.x), Math.abs(f.z)) >= RING_MM.limit - RING_MM.ropeZone;
const cornered = (f: { x: number; z: number }): boolean =>
  Math.min(Math.abs(f.x), Math.abs(f.z)) >= RING_MM.limit - RING_MM.cornerZone;
const inRing = (f: FighterState): FighterState => {
  const x = clamp(f.x, -RING_MM.limit, RING_MM.limit);
  const z = clamp(f.z, -RING_MM.limit, RING_MM.limit);
  if (x === f.x && z === f.z) return f;
  // the ropes stop the motion into them
  return { ...f, x, z, vx: x !== f.x ? 0 : f.vx, vz: z !== f.z ? 0 : f.vz };
};

/**
 * Solid bodies: push the two centres apart to BODY_SEP (half each, symmetric), keep both inside the ropes, and repeat
 * (a boxer pinned on the ropes takes no more push: the other one gives way). Closing velocity along the pair axis is
 * removed (they press into each other, they don't pass). Never leaves them closer than BODY_SEP.
 */
export function separate(pair: [FighterState, FighterState]): [FighterState, FighterState] {
  let [a, b] = pair;
  for (let k = 0; k < 4; k++) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const d = isqrt(dx * dx + dz * dz);
    if (d >= BODY_SEP) break;
    // coincident centres (only possible from a hand-made state): split along the red → blue x axis
    const [ux, uz] = d === 0 ? [1000, 0] : scaleTo(dx, dz, 1000);
    const deficit = BODY_SEP - d + 1;
    const ha = Math.ceil(deficit / 2);
    const hb = Math.ceil(deficit / 2);
    const na = inRing({ ...a, x: a.x - Math.trunc((ux * ha) / 1000) - Math.sign(ux), z: a.z - Math.trunc((uz * ha) / 1000) - Math.sign(uz) });
    const nb = inRing({ ...b, x: b.x + Math.trunc((ux * hb) / 1000) + Math.sign(ux), z: b.z + Math.trunc((uz * hb) / 1000) + Math.sign(uz) });
    // remove the closing velocity along the axis
    const close = (f: FighterState, sgn: number): FighterState => {
      const along = Math.trunc((f.vx * ux + f.vz * uz) / 1000) * sgn;
      if (along <= 0) return f;
      return { ...f, vx: f.vx - Math.trunc((ux * along * sgn) / 1000), vz: f.vz - Math.trunc((uz * along * sgn) / 1000) };
    };
    a = close(na, 1);
    b = close(nb, -1);
  }
  // still overlapping (both against the same ropes): slide the one nearer the centre round the other, along the rope
  let d = gapOf(a, b);
  for (let k = 0; d < BODY_SEP && k < 3; k++) {
    const aNear = Math.abs(a.x) + Math.abs(a.z) <= Math.abs(b.x) + Math.abs(b.z);
    const m = aNear ? a : b;
    const o = aNear ? b : a;
    // perpendicular to the pair axis, towards the ring centre
    let px = -(o.z - m.z);
    let pz = o.x - m.x;
    if (px * -m.x + pz * -m.z < 0) {
      px = -px;
      pz = -pz;
    }
    if (px === 0 && pz === 0) {
      px = -Math.sign(m.x) || 1;
      pz = -Math.sign(m.z);
    }
    const [sx, sz] = scaleTo(px, pz, isqrt(BODY_SEP * BODY_SEP - d * d) + 2);
    const moved = inRing({ ...m, x: m.x + sx, z: m.z + sz, vx: 0, vz: 0 });
    if (aNear) a = moved;
    else b = moved;
    d = gapOf(a, b);
  }
  return [a, b];
}

/* ------------------------------------------------------------ acts ------------------------------------------------------------ */

const isPunchAct = (a: FighterAct): a is Punch => isPunch(a);
const isSlip = (a: FighterAct): boolean => a === "slipL" || a === "slipR";
const isStep = (a: FighterAct): boolean => a === "stepIn" || a === "stepOut";
const isPivot = (a: FighterAct): boolean => a === "pivotL" || a === "pivotR";
const isDefence = (a: BoxingAction): boolean =>
  a === "slipL" || a === "slipR" || a === "duck" || a === "parry" || a === "stepOut" || a === "pivotL" || a === "pivotR";

/** total ticks of the fighter's current act (0 = no end) */
export function actTicks(f: Pick<FighterState, "act" | "wind" | "rec">): number {
  if (isPunchAct(f.act)) return f.wind + PUNCH_SPECS[f.act].active + f.rec;
  if (isSlip(f.act)) return MOVE.slip.ticks;
  if (f.act === "duck") return MOVE.duck.ticks;
  if (f.act === "parry") return MOVE.parry.ticks;
  if (isStep(f.act)) return MOVE.step.ticks;
  if (isPivot(f.act)) return MOVE.pivot.ticks;
  if (f.act === "feint") return MOVE.feint.ticks;
  if (f.act === "blockHit") return MOVE.blockHit;
  if (f.act === "rising") return MOVE.rising;
  if (f.act === "staggered") return f.rec;
  return 0;
}

const windowOf = (a: FighterAct): { from: number; to: number } | null =>
  isSlip(a) ? MOVE.slip : a === "duck" ? MOVE.duck : a === "parry" ? MOVE.parry : null;

export function stageOf(f: Pick<FighterState, "act" | "actT" | "wind">): ActStage {
  if (isPunchAct(f.act)) {
    if (f.actT < f.wind) return "windup";
    if (f.actT < f.wind + PUNCH_SPECS[f.act].active) return "active";
    return "recovery";
  }
  const w = windowOf(f.act);
  if (w) return f.actT < w.from ? "windup" : f.actT <= w.to ? "active" : "recovery";
  if (isStep(f.act)) return f.actT < MOVE.step.moveTicks ? "active" : "recovery";
  if (isPivot(f.act)) return f.actT < MOVE.pivot.moveTicks ? "active" : "recovery";
  if (f.act === "feint") return "windup";
  return "none";
}

/** can this fighter start a press right now (exported for the client's prediction) */
export const isBusy = (f: Pick<FighterState, "act">): boolean => f.act !== "idle";

/** would this press be refused outright (the "Too tired" hint)? */
export const isTooTired = (f: Pick<FighterState, "stamina">, a: BoxingAction): boolean =>
  (a === "hook" || a === "rhook" || a === "uppercut") && f.stamina < EXHAUSTED_STAMINA;

/** the windup a punch gets from this fighter right now */
export const windupOf = (f: Pick<FighterState, "guard" | "stamina">, p: Punch, body: boolean): number =>
  PUNCH_SPECS[p].windup + (f.guard ? GUARD_WINDUP : 0) + (f.stamina < EXHAUSTED_STAMINA ? 2 * TIRED_WINDUP : f.stamina < TIRED_STAMINA ? TIRED_WINDUP : 0) + (body ? BODY.windup : 0);

/** a punch's reach (mm) to head or body */
export const reachOf = (p: Punch, body: boolean): number => PUNCH_SPECS[p].reach - (body ? BODY_REACH : 0);

function startAct(f: FighterState, a: BoxingAction, body: boolean, t: number): FighterState {
  if (isTooTired(f, a)) return f;
  if (isPunch(a)) {
    const spec = PUNCH_SPECS[a];
    return {
      ...f,
      act: a,
      actT: 0,
      wind: windupOf(f, a, body),
      rec: spec.recovery,
      body,
      counter: t - f.defendAt <= COUNTER_WINDOW || t - f.readAt <= COUNTER_WINDOW,
      resolved: false,
      stamina: Math.max(0, f.stamina - spec.stamina),
      passive: 0,
    };
  }
  const cost =
    a === "slipL" || a === "slipR"
      ? MOVE.slip.stamina
      : a === "duck"
        ? MOVE.duck.stamina
        : a === "parry"
          ? MOVE.parry.stamina
          : a === "pivotL" || a === "pivotR"
            ? MOVE.pivot.stamina
            : a === "feint"
              ? MOVE.feint.stamina
              : a === "clinch"
                ? MOVE.clinch.stamina
                : MOVE.step.stamina;
  return { ...f, act: a, actT: 0, wind: 0, rec: 0, body: false, resolved: false, stamina: Math.max(0, f.stamina - cost) };
}

function withStage(f: FighterState): FighterState {
  const stage = stageOf(f);
  return f.stage === stage ? f : { ...f, stage };
}

function takeGuardOnly(f: FighterState, inp: FightInput | null): FighterState {
  if (!inp || inp.seq <= f.seq) return f;
  return { ...f, guard: inp.g, seq: inp.seq, ...(inp.mv ? { mv: [inp.mv[0], inp.mv[1]] as [number, number] } : {}) };
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
  close: 0,
  breaks: 0,
  slips: 0,
  breakFoul: false,
  vx: 0,
  vz: 0,
});

/** both boxers back on the start line round `mid` (the bell, after a count, after a pause), `gap` apart */
function placePair(fs: [FighterState, FighterState], gap: number, mid: { x: number; z: number } = { x: 0, z: 0 }): [FighterState, FighterState] {
  const dx = fs[1].x - fs[0].x;
  const dz = fs[1].z - fs[0].z;
  const [ux, uz] = dx === 0 && dz === 0 ? [1000, 0] : scaleTo(dx, dz, 1000);
  const hx = Math.trunc((ux * gap) / 2000);
  const hz = Math.trunc((uz * gap) / 2000);
  // keep the pair inside: shift the middle in so both ends fit
  const lim = RING_MM.limit;
  const mx = clamp(mid.x, -lim + Math.abs(hx), lim - Math.abs(hx));
  const mz = clamp(mid.z, -lim + Math.abs(hz), lim - Math.abs(hz));
  return separate([
    inRing({ ...fs[0], x: mx - hx, z: mz - hz, vx: 0, vz: 0 }),
    inRing({ ...fs[1], x: mx + hx, z: mz + hz, vx: 0, vz: 0 }),
  ]);
}
const midOf = (fs: readonly [{ x: number; z: number }, { x: number; z: number }]): { x: number; z: number } => ({
  x: Math.trunc((fs[0].x + fs[1].x) / 2),
  z: Math.trunc((fs[0].z + fs[1].z) / 2),
});
const startLine = (fs: [FighterState, FighterState]): [FighterState, FighterState] => [
  { ...fs[0], x: -START_GAP / 2, z: 0, vx: 0, vz: 0 },
  { ...fs[1], x: START_GAP / 2, z: 0, vx: 0, vz: 0 },
];
const derive = (s: FightState, fs: [FighterState, FighterState]): { dist: number; orbit: number } => ({
  dist: Math.round(gapOf(fs[0], fs[1]) / 10),
  orbit: orbitOf(fs[0], fs[1]),
});

/* ------------------------------------------------------------ decisions ------------------------------------------------------------ */

function decide(s: FightState): BoxingOutcome {
  const [a, b] = s.fighters;
  const sr = scoringRulesOf(s.rules);
  const pair = (f: (x: FighterState) => number): [number, number] => [f(a), f(b)];
  const landed = (i: 0 | 1) => [...s.tallies, s.tally].reduce((n, t) => n + t[i].landed, 0);
  const named = sr.drawTiebreak === "always" || (sr.drawTiebreak === "staked" && s.staked);
  const d = decideCards(
    s.cards,
    sr.judges,
    {
      knockdownsScored: [b.knockdowns, a.knockdowns],
      warnings: pair((f) => f.warnings),
      cautions: pair((f) => f.cautions),
      power: pair((f) => f.power),
      landed: [landed(0), landed(1)],
    },
    named,
  );
  return {
    decision: d.winner === null ? "draw" : "points",
    method: d.method,
    winner: d.winner,
    points: pair((f) => f.points),
    knockdowns: pair((f) => f.knockdowns),
    power: pair((f) => f.power),
    rounds: s.rounds,
    cards: s.cards,
    totals: d.totals,
    votes: d.votes,
    cautions: pair((f) => f.cautions),
    warnings: pair((f) => f.warnings),
    deductions: pair((f) => f.deductions),
    ...(d.tiebreak ? { tiebreak: d.tiebreak } : {}),
  };
}

const roundPoints = (s: FightState): [number, number] => [
  s.fighters[0].points - s.roundStart[0],
  s.fighters[1].points - s.roundStart[1],
];

function closeRound(s: FightState, partial: boolean): FightState {
  if (s.round < 1 || s.cards.length >= s.round) return s;
  const card = cardFor(s.round, s.tally, scoringRulesOf(s.rules).judges, partial);
  return {
    ...s,
    rounds: [...s.rounds, roundPoints(s)],
    tallies: [...s.tallies, s.tally],
    cards: [...s.cards, card],
    tally: emptyTally(),
  };
}

function endPoses(fs: [FighterState, FighterState], winner: 0 | 1 | null): [FighterState, FighterState] {
  return fs.map((f, i) => ({
    ...f,
    act: winner === null ? "idle" : winner === i ? "celebrate" : "dejected",
    actT: 0,
    stage: "none",
    buf: null,
    vx: 0,
    vz: 0,
  })) as [FighterState, FighterState];
}

function finish(s: FightState, outcome: BoxingOutcome, events: FightEvent[]): FightState {
  events.push({ k: "over", t: s.tick, result: outcome });
  return { ...s, phase: "over", left: 0, clinch: null, outcome, fighters: endPoses(s.fighters, outcome.winner), events };
}

/* ------------------------------------------------------------ the round tick ------------------------------------------------------------ */

const composureCap = (f: FighterState): number => Math.max(500, 1000 - (f.wear >> 1));
const staminaCap = (f: FighterState): number => Math.max(500, 1000 - (f.bodyWear >> 1));

/**
 * Slip / duck / parry / block, then counter: once my defence has worked (defendAt), a punch press cuts the rest of the
 * defence short and goes at once — the counter window is real time, not the tail of an animation.
 */
const counterReady = (f: FighterState, a: BoxingAction, t: number): boolean =>
  isPunch(a) &&
  t - f.defendAt <= COUNTER_WINDOW &&
  t > f.defendAt &&
  (isSlip(f.act) || f.act === "duck" || f.act === "parry" || (f.act === "blockHit" && f.actT >= 2));

/** one fighter's own part of a tick: timers, input, buffer, stamina — independent of the other fighter */
function advanceFighter(f0: FighterState, inp: FightInput | null, t: number, locked: boolean): FighterState {
  let f = f0;
  if (f.act !== "idle" && f.act !== "clinch") {
    const actT = f.actT + 1;
    const total = actTicks(f);
    f = total > 0 && actT >= total ? { ...f, act: "idle", actT: 0, resolved: false, body: false } : { ...f, actT };
  } else if (f.act === "clinch" && !locked) {
    // the grab (not yet tied up): runs MOVE.clinch.ticks, then back to idle
    const actT = f.actT + 1;
    f = actT >= MOVE.clinch.ticks ? { ...f, act: "idle", actT: 0 } : { ...f, actT };
  }
  let press: BoxingAction | null = null;
  let body = false;
  let buf = f.buf;
  if (buf) buf = buf.ttl > 1 ? { ...buf, ttl: buf.ttl - 1 } : null;
  if (inp && inp.seq > f.seq) {
    f = { ...f, guard: inp.g, seq: inp.seq, idle: 0, idleStrikes: 0, acted: true, ...(inp.mv ? { mv: [inp.mv[0], inp.mv[1]] as [number, number] } : {}) };
    if (inp.a && !locked) {
      // a defence cancels the last ticks of my own punch's recovery (punch, then get out of the way)
      const cancel =
        (isDefence(inp.a) && isPunchAct(f.act) && stageOf(f) === "recovery" && f.actT >= f.wind + PUNCH_SPECS[f.act].active + 3) ||
        counterReady(f, inp.a, t);
      if (isBusy(f) && !cancel) buf = { a: inp.a, b: !!inp.b, ttl: INPUT_BUFFER_TICKS };
      else {
        press = inp.a;
        body = !!inp.b;
      }
    }
  } else {
    f = { ...f, idle: f.idle + 1 };
  }
  if (!press && buf && !locked && (!isBusy(f) || counterReady(f, buf.a, t))) {
    press = buf.a;
    body = buf.b;
    buf = null;
  }
  f = { ...f, buf: locked ? null : buf, passive: f.passive + 1 };
  if (press) f = startAct({ ...f, act: "idle" }, press, body, t);
  return f;
}

/** the velocity a fighter wants this tick (mm / tick, world axes), from the held direction and the current act */
function wantVelocity(f: FighterState, o: FighterState): [number, number] {
  const dx = o.x - f.x;
  const dz = o.z - f.z;
  const [ux, uz] = scaleTo(dx, dz, 1000);
  // my right (looking at the opponent): (−uz, ux)
  const rx = -uz;
  const rz = ux;
  if (isStep(f.act) && f.actT < MOVE.step.moveTicks) {
    const sgn = f.act === "stepIn" ? 1 : -1;
    return [Math.trunc((ux * MOVE.step.speed * sgn) / 1000), Math.trunc((uz * MOVE.step.speed * sgn) / 1000)];
  }
  if (isPivot(f.act) && f.actT < MOVE.pivot.moveTicks) {
    const sgn = f.act === "pivotR" ? 1 : -1;
    return [Math.trunc((rx * MOVE.pivot.speed * sgn) / 1000), Math.trunc((rz * MOVE.pivot.speed * sgn) / 1000)];
  }
  if (f.act === "staggered" || f.act === "blockHit" || f.act === "rising" || f.act === "down" || f.act === "clinch") return [0, 0];
  const [lat, fwd] = f.mv;
  if (lat === 0 && fwd === 0) return [0, 0];
  let fs = fwd > 0 ? MOVE_SPEED.fwd : fwd < 0 ? -MOVE_SPEED.back : 0;
  let ls = lat * MOVE_SPEED.lat;
  if (lat !== 0 && fwd !== 0) {
    fs = Math.trunc((fs * 3) / 4);
    ls = Math.trunc((ls * 3) / 4);
  }
  // planted feet while punching / defending: you can't run and throw
  let pct = 100;
  const st = stageOf(f);
  if (isPunchAct(f.act)) pct = st === "recovery" ? 50 : 25;
  else if (isSlip(f.act) || f.act === "duck" || f.act === "parry" || f.act === "feint") pct = 50;
  if (f.stamina < TIRED_STAMINA) pct = Math.trunc((pct * 3) / 4);
  return [Math.trunc(((ux * fs + rx * ls) * pct) / 100_000), Math.trunc(((uz * fs + rz * ls) * pct) / 100_000)];
}

/** footwork for one fighter from the pre-tick pair: weighty velocity, circling at a constant distance, the ropes */
function moveFighter(f: FighterState, o: FighterState): FighterState {
  const [tx, tz] = wantVelocity(f, o);
  const step = (v: number, target: number): number => {
    const k = Math.abs(target) >= Math.abs(v) && Math.sign(target) === Math.sign(v || target) ? MOVE_SPEED.accel : MOVE_SPEED.brake;
    return v < target ? Math.min(target, v + k) : Math.max(target, v - k);
  };
  const vx = step(f.vx, tx);
  const vz = step(f.vz, tz);
  let x = f.x + vx;
  let z = f.z + vz;
  // circling (lateral only, or a pivot): keep the distance to the opponent — an arc round them, not a drift away
  const circling = (f.mv[1] === 0 && f.mv[0] !== 0 && !isStep(f.act)) || (isPivot(f.act) && f.actT < MOVE.pivot.moveTicks);
  if (circling && (vx !== 0 || vz !== 0)) {
    const d0 = gapOf(f, o);
    const [ex, ez] = scaleTo(x - o.x, z - o.z, d0);
    if (ex !== 0 || ez !== 0) {
      x = o.x + ex;
      z = o.z + ez;
    }
  }
  return inRing({ ...f, x, z, vx, vz });
}

/** how far (mm) the defender now stands off the attacker's punch line (attacker → aim point) */
function offLine(att: FighterState, def: FighterState): number {
  const lx = att.aimX - att.x;
  const lz = att.aimZ - att.z;
  const len = isqrt(lx * lx + lz * lz);
  if (len === 0) return 0;
  const dx = def.x - att.x;
  const dz = def.z - att.z;
  return Math.abs(Math.trunc((lx * dz - lz * dx) / len));
}

type Resolution =
  | { kind: "pending" }
  | { kind: "whiff" }
  | { kind: "evade"; how: "slip" | "duck" | "step" }
  | { kind: "parry" }
  | { kind: "block" }
  | { kind: "hit"; partial: boolean; counter: boolean; angle: boolean };

const inWindow = (f: FighterState): boolean => {
  const w = windowOf(f.act);
  return !!w && f.actT >= w.from && f.actT <= w.to;
};

/** does the attacker's punch land this tick? Pure function of the (advanced, moved) pre-resolution state. */
function resolvePunch(att: FighterState, def: FighterState, gap: number, t: number): Resolution {
  if (!isPunchAct(att.act) || att.resolved || stageOf(att) !== "active") return { kind: "pending" };
  const spec = PUNCH_SPECS[att.act];
  const lastActive = att.actT === att.wind + spec.active - 1;
  const reach = reachOf(att.act, att.body);
  if (gap > reach) return lastActive ? (def.act === "stepOut" || isPivot(def.act) ? { kind: "evade", how: "step" } : { kind: "whiff" }) : { kind: "pending" };
  // the line: the target moved off it since the punch was thrown (lateral footwork, a pivot) → it goes past
  if (offLine(att, def) > spec.track + (att.body ? 40 : 0)) return lastActive ? { kind: "evade", how: "step" } : { kind: "pending" };
  const head = !att.body;
  // defences with a window
  if (inWindow(def) && head) {
    if (isSlip(def.act) && spec.kind !== "hook") return { kind: "evade", how: "slip" };
    if (def.act === "duck" && spec.kind !== "uppercut") return { kind: "evade", how: "duck" };
    if (def.act === "parry" && spec.kind === "straight") return { kind: "parry" };
  }
  // caught in the wrong defence: a hook catches a slip, an uppercut catches a duck (a counter); a parry vs a hook
  const caught =
    inWindow(def) && ((isSlip(def.act) && spec.kind === "hook") || (def.act === "duck" && spec.kind === "uppercut"));
  // caught throwing: landing into the opponent's own punch (windup / active) or their whiff recovery
  const counter = att.counter || caught || (isPunchAct(def.act) && stageOf(def) !== "recovery") || (isPunchAct(def.act) && def.rec > PUNCH_SPECS[def.act].recovery);
  const angle = t <= att.angleUntil && !isPivot(def.act) && !isStep(def.act);
  const guarding =
    def.guard &&
    !angle &&
    !(isPunchAct(def.act) && def.actT < def.wind + PUNCH_SPECS[def.act].active) &&
    def.act !== "staggered" &&
    def.act !== "down" &&
    def.act !== "rising" &&
    def.act !== "parry" &&
    !inWindow(def);
  const smothered = spec.smother > 0 && gap < spec.smother;
  if (guarding) {
    if (head && spec.kind !== "uppercut" && !smothered) return { kind: "block" };
    // an uppercut splits the guard, a body shot goes under the elbows: partial
    return { kind: "hit", partial: true, counter: false, angle: false };
  }
  return { kind: "hit", partial: smothered, counter: counter && !smothered, angle };
}

function stepRound(s: FightState, inputs: TickInputs, t: number, events: FightEvent[]): FightState {
  const locked = !!s.clinch;
  // 1. each fighter on its own (timers, input, buffer)
  let fs = [advanceFighter(s.fighters[0], inputs[0], t, locked), advanceFighter(s.fighters[1], inputs[1], t, locked)] as [
    FighterState,
    FighterState,
  ];
  // the clinch locks both: no punches, no footwork; the referee breaks it at the end
  let clinch = s.clinch;
  if (clinch) {
    fs = fs.map((f) => ({ ...f, act: "clinch" as const, actT: f.act === "clinch" ? f.actT + 1 : 0, buf: null, vx: 0, vz: 0 })) as [FighterState, FighterState];
  }
  // 1b. a punch thrown this tick is aimed where the opponent stands now
  for (const i of [0, 1] as const) {
    const f = fs[i];
    if (isPunchAct(f.act) && f.actT === 0) fs[i] = { ...f, aimX: s.fighters[1 - i]!.x, aimZ: s.fighters[1 - i]!.z };
  }
  // 2. footwork from the same pre-tick pair, then solid bodies
  if (!clinch) {
    fs = [moveFighter(fs[0], s.fighters[1]), moveFighter(fs[1], s.fighters[0])];
    fs = separate(fs);
  }
  const gap = gapOf(fs[0], fs[1]);
  // a feint the opponent bit on: their defence (or step away) started while my feint was showing
  for (const i of [0, 1] as const) {
    const o = fs[1 - i]!;
    if (fs[i].act === "feint" && o.actT === 0 && (isDefence(o.act as BoxingAction) || o.act === "clinch")) fs[i] = { ...fs[i], readAt: t };
  }

  // 3. punches, resolved against the same state for both
  const res: [Resolution, Resolution] = [resolvePunch(fs[0], fs[1], gap, t), resolvePunch(fs[1], fs[0], gap, t)];
  const next = fs.map((f) => ({ ...f })) as [FighterState, FighterState];
  const staggers: [0 | 1, number][] = [];
  for (const i of [0, 1] as const) {
    const r = res[i];
    if (r.kind === "pending") continue;
    const j = (1 - i) as 0 | 1;
    const att = next[i];
    const def = next[j];
    const punch = fs[i].act as Punch;
    const spec = PUNCH_SPECS[punch];
    const body = fs[i].body;
    att.resolved = true;
    if (r.kind === "whiff" || r.kind === "evade") {
      att.stamina = Math.max(0, att.stamina - WHIFF_EXTRA);
      att.rec += WHIFF_RECOVERY;
      if (r.kind === "evade") {
        def.defendAt = t;
        events.push({ k: "evade", t, by: i, punch, how: r.how });
      } else events.push({ k: "whiff", t, by: i, punch });
      continue;
    }
    if (r.kind === "parry") {
      att.rec += MOVE.parry.recovery;
      att.composure = Math.max(0, att.composure - 20);
      def.defendAt = t;
      events.push({ k: "parry", t, by: i, punch });
      continue;
    }
    const [ux, uz] = scaleTo(fs[j].x - fs[i].x, fs[j].z - fs[i].z, 1000);
    if (r.kind === "block") {
      def.stamina = Math.max(0, def.stamina - BLOCK_STAMINA);
      if (punch !== "jab") def.composure = Math.max(1, def.composure - BLOCK_CHIP);
      def.defendAt = t;
      def.vx += Math.trunc((ux * (spec.push >> 1)) / 1000);
      def.vz += Math.trunc((uz * (spec.push >> 1)) / 1000);
      if (def.act === "idle") Object.assign(def, { act: "blockHit", actT: 0 });
      events.push({ k: "block", t, by: i, punch, ...(body ? { body: true } : {}) });
      continue;
    }
    // a hit: clean, or partial (through the guard / smothered)
    const tired = fs[i].stamina < TIRED_STAMINA;
    let dmg = spec.damage;
    if (r.counter) dmg = Math.trunc((dmg * 5) / 4);
    // walking into it: the defender was moving towards the punch
    const into = Math.trunc((fs[j].vx * -ux + fs[j].vz * -uz) / 1000);
    if (into > 12) dmg = Math.trunc((dmg * 5) / 4);
    // tired arms: 3/4 of the power; gassed (exhausted) arm punches: half
    if (fs[i].stamina < EXHAUSTED_STAMINA) dmg = dmg >> 1;
    else if (tired) dmg = Math.trunc((dmg * 3) / 4);
    if (r.partial) dmg = dmg >> 1;
    let points: number;
    let combo = att.combo;
    if (body) {
      def.stamina = Math.max(0, def.stamina - Math.trunc((dmg * BODY.staminaPct) / 100));
      def.bodyWear = Math.min(1000, def.bodyWear + Math.trunc((dmg * BODY.wearPct) / 100));
      dmg = Math.trunc((dmg * BODY.damagePct) / 100);
    } else if (!r.partial) def.wear = Math.min(1000, def.wear + Math.trunc(dmg / 5));
    if (r.partial) {
      points = 1;
    } else {
      combo = t - att.hitAt <= COMBO_WINDOW ? Math.min(COMBO_MAX, att.combo + 1) : 1;
      points = spec.points + (r.counter ? 1 : 0) + (combo >= COMBO_BONUS_FROM ? 1 : 0);
      att.combo = combo;
      att.hitAt = t;
      att.rec = Math.max(1, att.rec - HIT_RECOVERY_BONUS);
      if (punch !== "jab") att.power += 1;
      if (tired) att.landedTired += 1;
    }
    att.points += points;
    def.composure = Math.max(0, def.composure - dmg);
    const push = r.partial ? spec.push >> 1 : spec.push + (r.counter ? spec.push >> 2 : 0);
    def.vx += Math.trunc((ux * push) / 1000);
    def.vz += Math.trunc((uz * push) / 1000);
    // the stagger is applied after both punches are resolved (two punches landing at once: order-free)
    if (!r.partial) staggers.push([j, spec.stagger + (r.counter ? 2 : 0)]);
    events.push({
      k: "hit",
      t,
      by: i,
      punch,
      points,
      counter: !r.partial && r.counter,
      combo: r.partial ? 0 : combo,
      ...(body ? { body: true } : {}),
      ...(r.angle && !r.partial ? { angle: true } : {}),
    });
  }
  for (const [j, ticksOf] of staggers)
    Object.assign(next[j], { act: "staggered", actT: 0, rec: Math.max(ticksOf, next[j].act === "staggered" ? next[j].rec : 0), resolved: false, buf: null, body: false });
  fs = next;

  // 3b. stamina / composure / skill counters (after the punches: a hit fighter does not regenerate this tick)
  fs = fs.map((f, i) => {
    let stamina = f.stamina;
    const moving = Math.abs(f.vx) + Math.abs(f.vz) > 8;
    if (clinch) stamina += clinch.holders.includes(i as 0 | 1) ? REGEN.clinchHolder : REGEN.clinchHeld;
    else if (f.act === "blockHit" || f.act === "staggered") stamina += 0;
    else if (isPunchAct(f.act)) stamina += 0;
    else if (f.act === "idle") stamina += moving ? REGEN.moving : f.guard ? REGEN.guard : REGEN.rest;
    else stamina += REGEN.moving;
    const regenC = f.act !== "down" && f.act !== "staggered" && t % REGEN.composureEvery === 0 ? 1 + (clinch ? 2 : 0) : 0;
    return withStage({
      ...f,
      stamina: clamp(stamina, 0, staminaCap(f)),
      composure: clamp(f.composure + regenC, 0, Math.max(f.composure, composureCap(f))),
      gassed: f.gassed + (f.stamina < TIRED_STAMINA ? 1 : 0),
    });
  }) as [FighterState, FighterState];

  // 3c. clinch: a grab at its grab tick ties the other up (if still in reach and not knocked away)
  let tally = tallyEvents(s.tally, events);
  if (!clinch) {
    const grabbers = ([0, 1] as const).filter(
      (i) => fs[i].act === "clinch" && fs[i].actT === MOVE.clinch.grab && gap <= CLINCH_REACH && fs[1 - i]!.act !== "staggered" && fs[1 - i]!.act !== "down",
    );
    if (grabbers.length) {
      clinch = { holders: [...grabbers], left: CLINCH_TICKS };
      for (const i of grabbers) events.push({ k: "clinch", t, by: i });
      // pulled in tight: chest to chest at the body line
      fs = placePair(fs, BODY_SEP + 20, midOf(fs));
      fs = fs.map((f) => ({ ...f, act: "clinch" as const, actT: 0, buf: null, resolved: false, body: false, stage: "none" as const })) as [FighterState, FighterState];
    }
  }

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
    // a fighter down with no stamina left, or worn out, can't beat the count: it runs on to 10 → KO
    const out = downed.filter((i) => fs[i].stamina < EXHAUSTED_STAMINA || fs[i].wear >= 850);
    for (const i of [0, 1] as const)
      if (!downed.includes(i)) fs[i] = { ...fs[i], act: "idle", actT: 0, stage: "none", buf: null, vx: 0, vz: 0 };
    const stopped = ([0, 1] as const).filter(
      (i) => fs[i].roundKnockdowns >= STOPPAGE_KNOCKDOWNS_ROUND || fs[i].knockdowns >= STOPPAGE_KNOCKDOWNS_MATCH,
    );
    const base: FightState = {
      ...s,
      tick: t,
      ...derive(s, fs),
      fighters: fs,
      events,
      breakLeft: 0,
      clinch: null,
      fought: s.fought + 1,
      tally: tallyEvents(s.tally, events),
    };
    if (stopped.length === 1) {
      const winner = (1 - stopped[0]!) as 0 | 1;
      events.push({ k: "stoppage", t, winner });
      const closed = closeRound(base, true);
      return finish(closed, { ...decide(closed), decision: "stoppage", method: "RSC", winner }, events);
    }
    if (stopped.length === 2) {
      const closed = closeRound(base, true);
      return finish(closed, decide(closed), events);
    }
    events.push({ k: "count", t, n: 1 });
    const ko = out.length === 1 ? out[0]! : null;
    const both = out.length === 2;
    return {
      ...base,
      phase: "knockdown",
      left: ko !== null || both ? KO_COUNT_TICKS : KNOCKDOWN_COUNT_TICKS,
      held: s.left - 1,
      ko: both ? null : ko,
      ...(both ? { koBoth: true } : {}),
    };
  }

  // 5. ring control (generalship): the opponent on the ropes / in a corner, or holding the centre
  const ropes = [onRopes(fs[0]) || cornered(fs[0]), onRopes(fs[1]) || cornered(fs[1])];
  const r2 = (f: FighterState) => f.x * f.x + f.z * f.z;
  let ctlBy: 0 | 1 | null = null;
  let ctlW = 0;
  if (!clinch && ropes[0] !== ropes[1]) {
    ctlBy = ropes[0] ? 1 : 0;
    ctlW = 2;
  } else if (!clinch && !ropes[0] && !ropes[1]) {
    const d = r2(fs[0]) - r2(fs[1]);
    if (Math.abs(d) > 300 * 300) {
      ctlBy = d < 0 ? 0 : 1;
      ctlW = 1;
    }
  }
  // pressure that eats more punches than it lands is not generalship (IBA: domination by technical superiority)
  if (ctlBy !== null && tally[ctlBy].landed >= tally[1 - ctlBy]!.landed) {
    const c = fs[ctlBy];
    const before = Math.trunc(c.ctl / (2 * TICK_HZ));
    fs[ctlBy] = { ...c, ctl: c.ctl + ctlW };
    if (Math.trunc(fs[ctlBy].ctl / (2 * TICK_HZ)) > before) tally = addControl(tally, ctlBy);
  }

  // 6. fouls (fouls.ts ladder): referee fouls go up the ladder; IDLE is the exit-rules strike
  const sr = scoringRulesOf(s.rules);
  const idleTicks = ticks(s.rules.idleSeconds);
  const dq: [boolean, boolean] = [false, false];
  const dqCode: [RefereeFoul | null, RefereeFoul | null] = [null, null];
  const foul = (i: 0 | 1, code: RefereeFoul): void => {
    const f = fs[i];
    const st = ladderStep(f, sr);
    fs[i] = { ...f, ...st.next, points: f.points - Math.min(st.penalty, f.points) };
    events.push(foulEvent(t, i, code, st));
    if (st.level === "dq" && !dq[i]) {
      dq[i] = true;
      dqCode[i] = code;
      events.push({ k: "dq", t, to: i, foul: code });
    }
  };
  let breakLeft = Math.max(0, s.breakLeft - 1);
  // while "Break!" is in force a punch pressed now is cancelled; pressing one from close range is HIT_ON_BREAK
  for (const i of [0, 1] as const) {
    const f = fs[i];
    if (s.breakLeft > 0 && isPunchAct(f.act) && f.actT === 0) {
      const charged = gap < BREAK_GAP - 100 && !f.breakFoul;
      fs[i] = { ...f, act: "idle", actT: 0, stage: "none", resolved: false, breakFoul: f.breakFoul || charged };
      if (charged) foul(i, "HIT_ON_BREAK");
    }
  }
  // DUCKING: slips / ducks in a row without a punch
  for (const i of [0, 1] as const) {
    const f = fs[i];
    if (f.actT !== 0) continue;
    if (isPunchAct(f.act) && f.slips) fs[i] = { ...f, slips: 0 };
    else if (isSlip(f.act) || f.act === "duck") {
      if (f.slips + 1 >= DUCKING_SLIPS) {
        fs[i] = { ...f, slips: 0 };
        foul(i, "DUCKING");
      } else fs[i] = { ...f, slips: f.slips + 1 };
    }
  }
  // the clinch runs out → "Break!"; smothering in close range without punches → "Break!" too
  const breakNow = (holders: (0 | 1)[]): void => {
    events.push({ k: "break", t, by: [...holders] });
    breakLeft = BREAK_TICKS;
    clinch = null;
    fs = placePair(
      fs.map((f) => ({ ...f, act: "idle" as const, actT: 0, stage: "none" as const, close: 0, breakFoul: false })) as [FighterState, FighterState],
      BREAK_GAP,
      midOf(fs),
    );
    for (const i of holders) {
      const breaks = fs[i].breaks + 1;
      fs[i] = { ...fs[i], breaks };
      if (breaks > FREE_BREAKS) foul(i, "HOLDING");
    }
  };
  if (clinch && s.clinch) {
    const left = clinch.left - 1;
    if (left <= 0) breakNow(clinch.holders);
    else clinch = { ...clinch, left };
  } else if (!clinch) {
    for (const i of [0, 1] as const) {
      const f = fs[i];
      const close = gap <= CLOSE_MM && !isPunchAct(f.act) ? f.close + 1 : 0;
      if (close !== f.close) fs[i] = { ...f, close };
    }
    const holders = ([0, 1] as const).filter((i) => fs[i].close >= CLOSE_TICKS);
    if (holders.length) breakNow([...holders]);
  }
  for (const i of [0, 1] as const) {
    if (fs[i].passive >= PASSIVITY_TICKS) {
      fs[i] = { ...fs[i], passive: 0 };
      foul(i, "PASSIVITY");
    }
    const f = fs[i];
    if (f.idle >= idleTicks) {
      fs[i] = { ...f, idle: 0, idleStrikes: f.idleStrikes + 1 };
      events.push({ k: "warning", t, to: i, foul: "IDLE", penalty: 0 });
    }
  }
  fs = fs.map(withStage) as [FighterState, FighterState];
  const after: FightState = {
    ...s,
    tick: t,
    ...derive(s, fs),
    fighters: fs,
    events,
    left: s.left - 1,
    breakLeft,
    clinch,
    fought: s.fought + 1,
    tally: tallyEvents(tally, events.filter((e) => e.k === "warning")),
  };
  // (the warning events were not in the first fold: fold them now, once)
  if (dq[0] || dq[1]) {
    const closed = closeRound(after, true);
    const winner = dq[0] && dq[1] ? null : dq[0] ? 1 : 0;
    const dqFoul = winner === null ? null : dqCode[1 - winner];
    return finish(closed, { ...decide(closed), decision: "dq", method: "DQ", winner, ...(dqFoul ? { dqFoul } : {}) }, events);
  }
  return after;
}

/* ------------------------------------------------------------ stepFight ------------------------------------------------------------ */

/** One tick. Pure: never mutates `s`. */
export function stepFight(s: FightState, inputs: TickInputs): FightState {
  if (s.phase === "over" || s.phase === "intro" || s.phase === "paused") return s.events.length ? { ...s, events: [] } : s;
  const t = s.tick + 1;
  const events: FightEvent[] = [];

  if (s.phase === "round") {
    const next = stepRound(s, inputs, t, events);
    if (next.phase !== "round" || next.left > 0) return next;
    const pts = roundPoints(next);
    const ended: FightState = closeRound(
      { ...next, breakLeft: 0, clinch: null, fighters: next.fighters.map(resetForBell) as [FighterState, FighterState] },
      false,
    );
    const open = scoringRulesOf(s.rules).openScoring;
    events.push({ k: "roundEnd", t, round: s.round, points: pts, ...(open ? { card: ended.cards.at(-1)! } : {}) });
    if (s.round >= s.rules.rounds) return finish(ended, decide(ended), events);
    return { ...ended, phase: "rest", left: ticks(s.rules.restSeconds) };
  }

  if (s.phase === "knockdown") {
    const fighters = s.fighters.map((f, i) => takeGuardOnly(f, inputs[i] ?? null)) as [FighterState, FighterState];
    const left = s.left - 1;
    const elapsed = countTotal(s) - left;
    if (left > 0) {
      if (elapsed % TICK_HZ === 0) events.push({ k: "count", t, n: elapsed / TICK_HZ + 1 });
      return { ...s, tick: t, fighters, left, events };
    }
    if (s.ko !== null || s.koBoth) {
      const closed = closeRound({ ...s, tick: t, fighters, left: 0, events }, true);
      if (s.ko === null) return finish({ ...closed, koBoth: false }, decide(closed), events);
      events.push({ k: "ko", t, to: s.ko });
      const winner = (1 - s.ko) as 0 | 1;
      return finish(closed, { ...decide(closed), decision: "stoppage", method: "KO", winner }, events);
    }
    // the count reached 8: the downed fighter rises; the referee restarts them apart
    const up = fighters.map((f, i) => {
      if (f.act !== "down") return { ...f, act: "idle", actT: 0, stage: "none", idle: 0, passive: 0 };
      events.push({ k: "up", t, to: i as 0 | 1 });
      const rise = Math.min(composureCap(f), RISE_COMPOSURE - RISE_STEP * Math.max(0, f.knockdowns - 1));
      return { ...f, act: "rising", actT: 0, stage: "none", composure: Math.max(300, rise), idle: 0, passive: 0 };
    }) as [FighterState, FighterState];
    const placed = placePair(up, START_GAP, midOf(up));
    return { ...s, tick: t, fighters: placed, ...derive(s, placed), phase: "round", left: Math.max(1, s.held), held: 0, events };
  }

  // countdown / rest
  let fighters = s.fighters.map((f, i) => takeGuardOnly(f, inputs[i] ?? null)) as [FighterState, FighterState];
  if (s.phase === "rest")
    fighters = fighters.map((f) => ({
      ...f,
      stamina: Math.min(staminaCap(f), f.stamina + REGEN.restStamina),
      composure: Math.min(composureCap(f), f.composure + REGEN.restComposure),
    })) as [FighterState, FighterState];
  const left = s.left - 1;
  if (left > 0) return { ...s, tick: t, fighters, left, events };
  if (s.resume) {
    const r = s.resume;
    return { ...s, tick: t, fighters, phase: r.phase, left: r.left, resume: null, events };
  }
  const round = s.round + 1;
  events.push({ k: "bell", t, round });
  const fresh = startLine(fighters.map((f) => ({ ...resetForBell(f), breaks: 0 })) as [FighterState, FighterState]);
  return {
    ...s,
    tick: t,
    phase: "round",
    round,
    left: ticks(s.rules.roundSeconds),
    ...derive(s, fresh),
    fighters: fresh,
    roundStart: [fighters[0].points, fighters[1].points],
    breakLeft: 0,
    clinch: null,
    events,
  };
}

/* ------------------------------------------------------------ pauses / exits ------------------------------------------------------------ */

export function pauseFight(s: FightState, reason: "DISCONNECT" | "STAFF", who?: 0 | 1): FightState {
  if (s.phase === "over" || s.phase === "paused") return s;
  const fighters =
    who === undefined
      ? s.fighters
      : (s.fighters.map((f, i) => (i === who ? { ...f, connected: false } : f)) as [FighterState, FighterState]);
  const resume = s.phase === "countdown" && s.resume ? s.resume : { phase: s.phase, left: s.left };
  return { ...s, fighters, resume, phase: "paused", events: [{ k: "pause", t: s.tick, reason, ...(who !== undefined ? { who } : {}) }] };
}

/** Back from a time-out (3 s countdown by default); the round resumes from the start line round the pair's middle. */
export function resumeFight(s: FightState, countdown = true): FightState {
  if (s.phase !== "paused" || !s.resume) return s;
  let fighters = s.fighters.map((f) => ({
    ...f,
    connected: true,
    ...(f.act === "down" ? {} : { act: "idle" as const, actT: 0, stage: "none" as const, buf: null, resolved: false }),
    idle: 0,
    vx: 0,
    vz: 0,
  })) as [FighterState, FighterState];
  const events: FightEvent[] = [{ k: "resume", t: s.tick }];
  if (s.resume.phase === "countdown" || s.resume.phase === "intro")
    return { ...s, fighters, phase: s.resume.phase, left: s.resume.phase === "intro" ? 0 : COUNTDOWN_TICKS, resume: null, events };
  if (!countdown) return { ...s, fighters, phase: s.resume.phase, left: s.resume.left, resume: null, events };
  if (s.resume.phase === "round") fighters = placePair(fighters, START_GAP, midOf(fighters));
  return { ...s, fighters, ...derive(s, fighters), clinch: null, phase: "countdown", left: COUNTDOWN_TICKS, resume: s.resume, events };
}

export function forfeitFight(s: FightState, loser: 0 | 1): FightState {
  if (s.phase === "over") return s;
  const closed = closeRound(s, true);
  const outcome: BoxingOutcome = { ...decide(closed), decision: "forfeit", method: "FORFEIT", winner: (1 - loser) as 0 | 1 };
  return finish({ ...closed, events: [] }, outcome, []);
}
export function voidFight(s: FightState): FightState {
  if (s.phase === "over") return s;
  const closed = closeRound(s, true);
  const outcome: BoxingOutcome = { ...decide(closed), decision: "void", method: "VOID", winner: null };
  return finish({ ...closed, events: [] }, outcome, []);
}

export const hasBegun = (s: FightState): boolean => s.round >= 1 && s.fighters.some((f) => f.acted);
export const isOver = (s: FightState): boolean => s.phase === "over";

export function maxFightTicks(rules: FightRules): number {
  return (
    COUNTDOWN_TICKS +
    rules.rounds * ticks(rules.roundSeconds) +
    (rules.rounds - 1) * ticks(rules.restSeconds) +
    2 * (STOPPAGE_KNOCKDOWNS_MATCH - 1) * KNOCKDOWN_COUNT_TICKS +
    (KO_COUNT_TICKS - KNOCKDOWN_COUNT_TICKS) +
    2
  );
}

export function matchResultOf(s: FightState): MatchResult {
  const o = s.outcome ?? decide(s);
  const [a, b] = s.fighters;
  const ranks =
    o.winner === null ? { [a.id]: 1, [b.id]: 1 } : { [a.id]: o.winner === 0 ? 1 : 2, [b.id]: o.winner === 1 ? 1 : 2 };
  const reason = o.decision === "forfeit" ? "forfeit" : o.decision === "void" ? "void" : "normal";
  return { ranks, scores: { [a.id]: a.points, [b.id]: b.points }, reason };
}

const countTotal = (s: FightState): number => (s.ko !== null || s.koBoth ? KO_COUNT_TICKS : KNOCKDOWN_COUNT_TICKS);
export const countOf = (s: FightState): number | undefined =>
  s.phase === "knockdown" ? clamp(Math.trunc((countTotal(s) - s.left) / TICK_HZ) + 1, 1, countTotal(s) / TICK_HZ) : undefined;

/**
 * What everyone may see of a fighter: a feint looks exactly like the start of a cross (the act and stage a cross
 * would show), so neither the opponent's screen nor the practice AI can tell it apart before it is over.
 */
export function perceived(f: FighterState): Pick<FighterState, "act" | "actT" | "stage" | "wind" | "body"> {
  if (f.act !== "feint") return f;
  return { act: "cross", actT: f.actT, stage: "windup", wind: f.actT + 3, body: false };
}

export function snapshotOf(s: FightState, ring: RingId): BoxingSnapshot {
  const count = countOf(s);
  const sr = scoringRulesOf(s.rules);
  return {
    ring,
    tick: s.tick,
    phase: s.phase,
    round: s.round,
    rounds: s.rules.rounds,
    left: s.left,
    dist: s.dist,
    orbit: s.orbit,
    engine: 2,
    fighters: s.fighters.map((f) => {
      const p = perceived(f);
      return {
        id: f.id,
        corner: f.corner,
        act: p.act,
        actT: p.actT,
        stage: p.stage,
        guard: f.guard,
        stamina: f.stamina,
        composure: f.composure,
        points: f.points,
        knockdowns: f.knockdowns,
        warnings: f.warnings,
        connected: f.connected,
        cautions: f.cautions,
        deductions: f.deductions,
        x: f.x,
        z: f.z,
        ...(p.body ? { body: true } : {}),
        wear: f.wear,
      };
    }) as BoxingSnapshot["fighters"],
    ...(count !== undefined ? { count } : {}),
    judges: sr.judges,
    ...(sr.openScoring || s.phase === "over" ? { cards: s.cards } : {}),
    ...(s.breakLeft > 0 ? { breakLeft: s.breakLeft } : {}),
    ...(s.clinch ? { clinch: { by: s.clinch.holders[0]!, left: s.clinch.left } } : {}),
  };
}

export const hashFight = (s: FightState): string => stableStringify({ ...s, events: [] });

/* ------------------------------------------------------------ the skill report (docs/FIGHT-GAME-V2.md §6) ------------------------------------------------------------ */

const pct = (a: number, b: number): number => (b > 0 ? Math.round((100 * a) / b) : 0);

/** each fighter's skill line for the whole fight, from the engine's own tallies and counters (integers) */
export function fightStatsOf(s: FightState): [FightStatLine, FightStatLine] {
  const all = [...s.tallies, ...(s.cards.length < s.round ? [s.tally] : [])];
  const sum = (i: 0 | 1, k: "thrown" | "landed" | "power" | "defended" | "kd" | "counters" | "body") =>
    all.reduce((n, t) => n + (t[i][k] ?? 0), 0);
  const mins10 = Math.max(1, Math.round((s.fought * 10) / (60 * TICK_HZ)));
  return ([0, 1] as const).map((i) => {
    const o = (1 - i) as 0 | 1;
    const f = s.fighters[i];
    const thrown = sum(i, "thrown");
    const landed = sum(i, "landed");
    const oppThrown = sum(o, "thrown");
    const oppLanded = sum(o, "landed");
    return {
      thrown,
      landed,
      power: sum(i, "power"),
      body: sum(i, "body"),
      counters: sum(i, "counters"),
      defended: sum(i, "defended"),
      oppThrown,
      oppLanded,
      kd: sum(i, "kd"),
      controlS: Math.trunc(f.ctl / (2 * TICK_HZ)),
      gassedS: Math.trunc(f.gassed / TICK_HZ),
      landedTired: f.landedTired,
      perMin: Math.round((thrown * 100) / mins10),
      accuracy: pct(landed, thrown),
      defencePct: oppThrown > 0 ? 100 - pct(oppLanded, oppThrown) : 100,
      diff: landed - oppLanded,
      fouls: f.warnings + f.cautions,
    };
  }) as [FightStatLine, FightStatLine];
}
