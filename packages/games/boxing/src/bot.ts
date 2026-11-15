import type { BoxingAction, FightInput, Punch } from "@gukirana/contracts";
import { isPunch } from "@gukirana/contracts";
import type { GameRng } from "@gukirana/game-kit";
import {
  EXHAUSTED_STAMINA,
  PUNCH_SPECS,
  TIRED_STAMINA,
  isBusy,
  stageOf,
  type FightState,
  type FighterState,
} from "./engine.js";

/** Practice sparring partner levels (1 = beginner … 5 = champion). Practice only: never in live / staked fights. */
export type BotLevel = 1 | 2 | 3 | 4 | 5;
export const BOT_LEVELS: readonly BotLevel[] = [1, 2, 3, 4, 5];

/** what each level can do (percent chances are rolled once per decision with the injected rng) */
export interface BotProfile {
  /** ticks after the opponent's windup starts before the bot can react */
  react: number;
  /** % chance to defend at all once it sees a punch coming */
  defend: number;
  /** % chance that the defence is the right one for that punch (else a random one) */
  read: number;
  /** % chance per idle tick to start an attack when in range */
  attack: number;
  /** % chance to punish an opponent's whiff / recovery at once */
  punish: number;
  /** keeps stamina above this before throwing power punches (0 = never cares) */
  reserve: number;
  /** % chance to follow a clean hit with another punch (combos) */
  combo: number;
  /** holds the guard while idle */
  guard: boolean;
}
export const BOT_PROFILES: Record<BotLevel, BotProfile> = {
  1: { react: 14, defend: 15, read: 30, attack: 3, punish: 5, reserve: 0, combo: 5, guard: false },
  2: { react: 11, defend: 30, read: 50, attack: 4, punish: 20, reserve: 150, combo: 15, guard: false },
  3: { react: 8, defend: 50, read: 65, attack: 5, punish: 40, reserve: 250, combo: 30, guard: true },
  4: { react: 5, defend: 70, read: 85, attack: 6, punish: 70, reserve: 350, combo: 50, guard: true },
  5: { react: 4, defend: 80, read: 92, attack: 7, punish: 85, reserve: 400, combo: 70, guard: true },
};

const roll = (rng: GameRng, pct: number): boolean => pct > 0 && rng.int(0, 99) < pct;
const DEFENCES: readonly BoxingAction[] = ["slipL", "slipR", "stepOut"];
/** the punch that follows in a combination (jab → cross → hook → uppercut) */
const COMBO_NEXT: Partial<Record<Punch, Punch>> = { jab: "cross", cross: "hook", hook: "uppercut" };

/** the right answer to an incoming punch (plan §2.3): slip straights / uppercuts, step out of hooks */
function bestDefence(p: Punch, rng: GameRng): BoxingAction {
  if (p === "hook") return "stepOut";
  return rng.int(0, 1) === 0 ? "slipL" : "slipR";
}

/** the punch to throw at this distance with this much stamina */
function choosePunch(me: FighterState, dist: number, p: BotProfile, rng: GameRng): Punch | null {
  const options: Punch[] = [];
  for (const k of ["jab", "cross", "hook", "uppercut"] as const) {
    if (dist > PUNCH_SPECS[k].reach) continue;
    if (k !== "jab" && me.stamina < Math.max(p.reserve, k === "cross" ? 0 : EXHAUSTED_STAMINA)) continue;
    options.push(k);
  }
  if (!options.length) return null;
  return options[rng.int(0, options.length - 1)]!;
}

/**
 * The AI's input for this tick (null = nothing new). Deterministic given the rng (practice seeds it from
 * @gukirana/fairness; tests use a fixed seed). It reads only what a human could see: the opponent's action, stage and
 * timing, the distance, its own meters.
 */
export function boxingBotInput(s: FightState, me: 0 | 1, level: BotLevel, rng: GameRng): FightInput | null {
  if (s.phase !== "round") return null;
  const p = BOT_PROFILES[level];
  const f = s.fighters[me];
  const o = s.fighters[(1 - me) as 0 | 1];
  const send = (a: BoxingAction | undefined, g: boolean): FightInput =>
    a ? { seq: f.seq + 1, a, g } : { seq: f.seq + 1, g };
  const wantGuard = p.guard && f.stamina >= TIRED_STAMINA - 100;

  // 1. defence: react once per incoming punch, `react` ticks into its windup
  if (
    isPunch(o.act) &&
    o.actT === p.react &&
    stageOf(o) === "windup" &&
    s.dist <= PUNCH_SPECS[o.act].reach + 45
  ) {
    if (roll(rng, p.defend)) {
      const d = roll(rng, p.read) ? bestDefence(o.act, rng) : DEFENCES[rng.int(0, DEFENCES.length - 1)]!;
      // a guard is also a good answer to straights and hooks for a guard-holding bot
      if (p.guard && o.act !== "uppercut" && roll(rng, 40)) return send(undefined, true);
      return send(d, wantGuard);
    }
  }
  // 1b. combinations (P3-FGT-07): late in its own punch the bot presses the next one (the engine buffers it, so the
  // punches chain without a gap): 1-2, 1-2-3, 2-3, hook-uppercut — more often the better the level
  if (isPunch(f.act) && stageOf(f) === "recovery" && f.actT === f.wind + PUNCH_SPECS[f.act].active + 1 && !f.buf) {
    const next = COMBO_NEXT[f.act];
    if (next && s.dist <= PUNCH_SPECS[next].reach + 20 && f.stamina >= Math.max(p.reserve, TIRED_STAMINA) && roll(rng, Math.round(p.combo * 0.6) + 8))
      return send(next, false);
  }
  if (isBusy(f)) return null;

  // 2. punish a whiff / an opponent in recovery
  const oStage = stageOf(o);
  if (
    isPunch(o.act) &&
    oStage === "recovery" &&
    o.actT === o.wind + PUNCH_SPECS[o.act].active &&
    roll(rng, p.punish)
  ) {
    const k = choosePunch(f, s.dist, p, rng);
    if (k) return send(k, false);
    if (s.dist > PUNCH_SPECS.jab.reach) return send("stepIn", wantGuard);
  }
  // 3. combos after a clean hit
  if (s.tick - f.hitAt <= 2 && o.act === "staggered" && roll(rng, p.combo)) {
    const k = choosePunch(f, s.dist, p, rng);
    if (k) return send(k, false);
  }
  // 4. range management + attack: pressure a tired / shaken opponent, ease off when tired yourself
  const pressure = o.stamina < TIRED_STAMINA || o.composure < 350 ? 2 : 0;
  const tiredSelf = f.stamina < TIRED_STAMINA ? -2 : 0;
  if (roll(rng, Math.max(1, p.attack + pressure + tiredSelf))) {
    if (s.dist > PUNCH_SPECS.cross.reach) return send("stepIn", wantGuard);
    if (f.stamina < p.reserve && s.dist < PUNCH_SPECS.cross.reach && roll(rng, 30))
      return send("stepOut", wantGuard);
    // work inside now and then (hooks / uppercuts to the body and head), then get back out to the long range
    if (s.dist > PUNCH_SPECS.hook.reach && f.stamina >= Math.max(p.reserve, TIRED_STAMINA) && roll(rng, 18)) return send("stepIn", wantGuard);
    if (s.dist <= PUNCH_SPECS.hook.reach && roll(rng, 22)) return send("stepOut", wantGuard);
    // at long range the jab measures / sets up (a 1-2 follows through the combo chain)
    const k = s.dist > PUNCH_SPECS.hook.reach && roll(rng, 45) ? "jab" : choosePunch(f, s.dist, p, rng);
    if (k) return send(k, wantGuard && level < 3);
    return send("stepIn", wantGuard);
  }
  // 5. keep the guard where the level wants it
  if (f.guard !== wantGuard) return send(undefined, wantGuard);
  return null;
}
