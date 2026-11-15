import type { BoxingAction, FightInput, Punch } from "@gukirana/contracts";
import { isPunch } from "@gukirana/contracts";
import type { GameRng } from "@gukirana/game-kit";
import { FREE_BREAKS } from "./fouls.js";
import {
  CLINCH_REACH,
  EXHAUSTED_STAMINA,
  MOVE,
  PASSIVITY_TICKS,
  PUNCH_SPECS,
  RING_MM,
  TIRED_STAMINA,
  gapOf,
  isBusy,
  perceived,
  reachOf,
  stageOf,
  type FightState,
  type FighterState,
} from "./engine.js";

/**
 * The practice sparring partner and the skill-separation agents (P3-FGT-10, docs/FIGHT-GAME-V2.md §5).
 * Practice only: never in live / staked fights. It sees only what a human sees (the opponent's PERCEIVED act — a
 * feint looks like a cross — the distance, the ropes, its own meters), reacts after a human-like delay, and its skill
 * is a handful of numbers: reaction time, how often it defends and picks the right defence, distance discipline,
 * counters, ring craft, stamina reserve. Deterministic given the injected rng (practice seeds it from
 * @gukirana/fairness; tests use a fixed one).
 */
export type BotLevel = 1 | 2 | 3 | 4 | 5;
export const BOT_LEVELS: readonly BotLevel[] = [1, 2, 3, 4, 5];

export interface BotProfile {
  /** ticks of the opponent's windup it needs to see before it can react (human ≈ 6–8 at 30 Hz; elite 4) */
  react: number;
  /** % chance to defend a punch it saw coming */
  defend: number;
  /** % chance the defence is the right one for that punch and its timing (else a random one) */
  read: number;
  /** holds the guard up when idle in range (%) */
  guard: number;
  /** % chance to counter at once after its own successful defence / an opponent's whiff */
  counter: number;
  /** % chance per idle tick in range to start an attack */
  attack: number;
  /** distance discipline (%): moves to the range it wants (in for the jab, out after combinations) */
  range: number;
  /** % chance to chain the next punch of a combination */
  combo: number;
  /** ring craft (%): pivots off the ropes, cuts the ring off when the opponent is on them, keeps circling */
  craft: number;
  /** keeps stamina above this before throwing power punches */
  reserve: number;
  /** % of punches thrown to the body */
  body: number;
  /** % of attacks opened with a feint */
  feint: number;
  /** ties up when hurt (%) */
  clinch: number;
  /** a button masher: walks forward and throws punches non-stop, never defends (sims only) */
  mash?: boolean;
}

export const BOT_PROFILES: Record<BotLevel, BotProfile> = {
  1: { react: 12, defend: 15, read: 25, guard: 20, counter: 5, attack: 4, range: 25, combo: 5, craft: 5, reserve: 0, body: 10, feint: 0, clinch: 0 },
  2: { react: 9, defend: 35, read: 45, guard: 45, counter: 20, attack: 5, range: 45, combo: 15, craft: 20, reserve: 150, body: 15, feint: 3, clinch: 10 },
  3: { react: 7, defend: 55, read: 65, guard: 65, counter: 40, attack: 6, range: 65, combo: 30, craft: 40, reserve: 250, body: 20, feint: 6, clinch: 25 },
  4: { react: 6, defend: 72, read: 82, guard: 80, counter: 60, attack: 7, range: 80, combo: 45, craft: 60, reserve: 300, body: 25, feint: 10, clinch: 40 },
  5: { react: 5, defend: 85, read: 92, guard: 90, counter: 80, attack: 8, range: 92, combo: 60, craft: 80, reserve: 350, body: 25, feint: 12, clinch: 50 },
};
/** the button masher (simulations: discipline must beat it) */
export const MASHER: BotProfile = { react: 99, defend: 0, read: 0, guard: 0, counter: 0, attack: 100, range: 0, combo: 100, craft: 0, reserve: 0, body: 20, feint: 0, clinch: 0, mash: true };

const roll = (rng: GameRng, pct: number): boolean => pct > 0 && rng.int(0, 99) < pct;
const COMBO_NEXT: Partial<Record<Punch, Punch>> = { jab: "cross", cross: "hook", hook: "rhook", rhook: "uppercut" };
const ALL: readonly Punch[] = ["jab", "cross", "hook", "rhook", "uppercut"];
const WRONG: readonly BoxingAction[] = ["slipL", "slipR", "duck", "parry", "stepOut"];

/** the right answer to an incoming punch, given the ticks left before it lands */
function bestDefence(p: Punch, body: boolean, toImpact: number, rng: GameRng): BoxingAction | "guard" | null {
  const spec = PUNCH_SPECS[p];
  // a defence works when its window covers the impact: it starts on the next tick
  const fits = (w: { from: number; to: number }) => toImpact - 1 >= w.from && toImpact - 1 <= w.to;
  if (body) return toImpact >= 3 ? "stepOut" : "guard";
  if (spec.kind === "straight") {
    if (fits(MOVE.parry) && rng.int(0, 2) === 0) return "parry";
    if (fits(MOVE.slip)) return rng.int(0, 1) === 0 ? "slipL" : "slipR";
    return "guard";
  }
  if (spec.kind === "hook") return fits(MOVE.duck) ? "duck" : "guard";
  // uppercut: slip it or step out of it
  if (fits(MOVE.slip)) return rng.int(0, 1) === 0 ? "slipL" : "slipR";
  return toImpact >= 3 ? "stepOut" : "guard";
}

/** the punch to throw at this distance */
function choosePunch(me: FighterState, gap: number, p: BotProfile, rng: GameRng): { a: Punch; b: boolean } | null {
  const body = roll(rng, p.body);
  const opts: Punch[] = [];
  for (const k of ALL) {
    if (gap > reachOf(k, body) - 20) continue;
    if (k !== "jab" && me.stamina < Math.max(p.reserve, k === "cross" ? 0 : EXHAUSTED_STAMINA)) continue;
    // straights are smothered up close: a good boxer works the hooks and uppercut inside
    if (PUNCH_SPECS[k].smother && gap < PUNCH_SPECS[k].smother + 30 && p.range > 40) continue;
    opts.push(k);
  }
  if (!opts.length) return null;
  return { a: opts[rng.int(0, opts.length - 1)]!, b: body };
}

const onRopes = (f: { x: number; z: number }) => Math.max(Math.abs(f.x), Math.abs(f.z)) >= RING_MM.limit - RING_MM.ropeZone - 80;

/** which way to pivot / circle to get off the ropes: towards the side where the ring centre is */
function escapeSide(f: FighterState, o: FighterState): 1 | -1 {
  const ux = o.x - f.x;
  const uz = o.z - f.z;
  // my right is (−uz, ux): go right if the centre (−f) lies on my right
  return -uz * -f.x + ux * -f.z >= 0 ? 1 : -1;
}

/**
 * The AI's input for this tick (null = nothing new). `who` is the level (practice) or a profile (sims).
 */
export function boxingBotInput(s: FightState, me: 0 | 1, who: BotLevel | BotProfile, rng: GameRng): FightInput | null {
  if (s.phase !== "round") return null;
  const p = typeof who === "number" ? BOT_PROFILES[who] : who;
  const f = s.fighters[me];
  const of = s.fighters[(1 - me) as 0 | 1];
  const o = perceived(of);
  const gap = gapOf(f, of);
  const seq = f.seq + 1;
  const send = (a: BoxingAction | undefined, g: boolean, mv: [number, number], b = false): FightInput => ({
    seq,
    g,
    mv,
    ...(a ? { a } : {}),
    ...(b ? { b: true } : {}),
  });

  if (p.mash) {
    // the masher: forward, punches all the time (the engine buffers what it can't start)
    const k = ALL[rng.int(0, ALL.length - 1)]!;
    return send(k, false, [0, 1], roll(rng, p.body));
  }

  const tired = f.stamina < TIRED_STAMINA;
  const inRange = gap <= PUNCH_SPECS.jab.reach + 120;
  const wantGuard = inRange && s.tick % 100 < p.guard;
  // footwork: circle (direction changes now and then), in / out by distance discipline, off the ropes
  const circleDir = ((s.tick >> 6) + me) % 3 === 0 ? 0 : ((s.tick >> 7) & 1) === 0 ? 1 : -1;
  let fwd = 0;
  if (gap > PUNCH_SPECS.jab.reach + 40 && !(tired && roll(rng, 50))) fwd = roll(rng, p.range + 20) ? 1 : 0;
  else if (gap < 760 && f.composure < 500 && roll(rng, p.range)) fwd = -1;
  // circle at range (planted feet in the exchange: you punch and defend from your stance)
  let lat = gap > 1000 && roll(rng, p.craft) ? circleDir : 0;
  if (onRopes(f) && roll(rng, p.craft)) lat = escapeSide(f, of);
  // cutting the ring off: an opponent on the ropes is not let off (step in, mirror his circling)
  if (onRopes(of) && roll(rng, p.craft)) {
    fwd = gap > 900 ? 1 : 0;
    lat = -escapeSide(of, f);
  }
  const mv: [number, number] = [lat, fwd];

  // 1. defence: once per incoming punch, `react` ticks into its windup
  if (isPunch(o.act) && o.actT === p.react && o.stage === "windup" && gap <= reachOf(o.act, !!o.body) + 140) {
    if (roll(rng, p.defend)) {
      const toImpact = Math.max(0, o.wind - o.actT);
      const right = roll(rng, p.read);
      const d = right ? bestDefence(o.act, !!o.body, toImpact, rng) : WRONG[rng.int(0, WRONG.length - 1)]!;
      if (d === "guard") return send(undefined, true, [0, 0]);
      if (d) return send(d, f.guard, mv);
    } else if (roll(rng, p.guard)) return send(undefined, true, mv);
  }
  // 1b. combinations: late in my own punch, the next one (buffered by the engine)
  if (isPunch(f.act) && stageOf(f) === "recovery" && !f.buf && f.actT === f.wind + PUNCH_SPECS[f.act].active + 1) {
    const next = COMBO_NEXT[f.act];
    if (next && gap <= reachOf(next, false) && f.stamina >= Math.max(p.reserve, TIRED_STAMINA) && roll(rng, p.combo))
      return send(next, false, [0, 0], roll(rng, p.body));
    // after the combination: out of range again (hit and don't get hit)
    if (roll(rng, p.range) && gap < 900 && of.composure > 400) return send("stepOut", f.guard, mv);
  }
  // 2. counter at once after my successful defence, or punish a whiff / a parried punch
  const oWhiffed = isPunch(of.act) && stageOf(of) === "recovery" && of.rec > PUNCH_SPECS[of.act].recovery;
  const canCounter = s.tick === f.defendAt && f.act !== "staggered";
  if ((canCounter || (oWhiffed && !isBusy(f))) && roll(rng, p.counter)) {
    const k = choosePunch(f, gap, p, rng);
    if (k) return send(k.a, false, [0, 0], k.b);
    if (gap > PUNCH_SPECS.jab.reach) return send("stepIn", false, [0, 1]);
  }
  if (isBusy(f)) return send(undefined, f.guard || wantGuard, mv);
  // "Break!": hands down until the referee lets them box on (a punch now from close is HIT_ON_BREAK)
  if (s.breakLeft > 0) return send(undefined, wantGuard, [lat, gap < 1500 ? -1 : 0]);

  // 2a. distance control: meet the opponent's step in with a straight (he walks onto it)
  if (of.act === "stepIn" && of.actT <= 2 && gap <= PUNCH_SPECS.jab.reach + 250 && roll(rng, Math.trunc(p.range / 2))) return send(roll(rng, 50) ? "jab" : "cross", false, [0, 0]);
  // 2b. the angle a pivot just made: the guard does not cover it — punch now
  if (s.tick <= f.angleUntil && gap <= PUNCH_SPECS.jab.reach && roll(rng, p.craft)) {
    const k = choosePunch(f, gap, p, rng);
    if (k) return send(k.a, false, [0, 0], k.b);
  }
  // 3. hurt: tie up
  if (f.composure < 300 && gap <= CLINCH_REACH && of.act !== "clinch" && f.breaks < FREE_BREAKS && roll(rng, Math.ceil(p.clinch / 10)))
    return send("clinch", true, [0, 0]);
  // 4. attack when in range (more on a tired / hurt opponent, less when tired yourself)
  const pressure = of.stamina < TIRED_STAMINA || of.composure < 350 ? 2 : 0;
  if (gap <= PUNCH_SPECS.jab.reach && roll(rng, Math.max(1, p.attack + pressure - (tired ? 3 : 0)))) {
    if (roll(rng, p.feint) && f.stamina > 200) return send("feint", false, mv);
    // engage: from the long range, step in behind the jab to where the power punches land
    if (gap > PUNCH_SPECS.hook.reach + 80 && f.stamina >= Math.max(p.reserve, TIRED_STAMINA) && roll(rng, 35)) return send("stepIn", f.guard, [0, 0]);
    const k = choosePunch(f, gap, p, rng);
    if (k) return send(k.a, false, [0, 0], k.b);
  }
  // 4b. never passive for long (PASSIVITY): a jab to keep busy, stepping in for it if needed
  if (f.passive > PASSIVITY_TICKS - 90) return gap <= PUNCH_SPECS.jab.reach ? send("jab", false, [0, 0]) : send(undefined, wantGuard, [0, 1]);
  // 5. the angle: a pivot when the opponent is square in front and I have the legs
  if (inRange && gap <= PUNCH_SPECS.cross.reach && of.guard && of.act === "idle" && (s.tick & 15) === 0 && roll(rng, Math.trunc(p.craft / 3)) && f.stamina > 400)
    return send(roll(rng, 50) ? "pivotL" : "pivotR", f.guard, mv);
  if (onRopes(f) && gap < 1000 && roll(rng, Math.trunc(p.craft / 8))) return send(escapeSide(f, of) > 0 ? "pivotR" : "pivotL", f.guard, mv);
  return send(undefined, wantGuard, mv);
}
