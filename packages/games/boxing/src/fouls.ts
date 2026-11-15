import type { FightEvent, FoulLevel, RefereeFoul, ScoringRules } from "@gukirana/contracts";
import { TICK_HZ } from "@gukirana/contracts";

/**
 * Boxing fouls and the referee's escalation ladder (P3-FGT-06, docs/BOXING-SCORING.md §4).
 *
 * Every foul is detected from the engine's own state with fixed integer thresholds: nothing random, nothing a client
 * can claim, and every one is avoidable by skill (each rule has a plain "how to avoid it" line in the HUD tutorial
 * data, apps/web/src/fight/game/scoring-strings.ts). Impossible by construction (no such input or state): hitting
 * after the bell (acts reset at the bell, presses outside a round are dropped), hitting a downed opponent (both are
 * frozen during the count), head-butts, kicks, the open glove, pivot blows. LOW_BLOW is reserved for when the engine
 * gets body / head target zones.
 */

/** in this close range (cm) a fighter who doesn't punch is holding / smothering */
export const CLINCH_DIST = 90;
/** close range without a punch this long → the referee calls "Break!" */
export const CLINCH_TICKS = 3 * TICK_HZ;
/** after "Break!" the pair stands at this distance (beyond every punch's reach) */
export const BREAK_DIST = 200;
/** "Break!" lasts this long: punches pressed meanwhile are cancelled; stepping back in to punch is HIT_ON_BREAK */
export const BREAK_TICKS = TICK_HZ;
/** "Break!" calls on the same fighter in one round before it is a HOLDING foul (the first is free) */
export const FREE_BREAKS = 1;
/** slips in a row without a punch → DUCKING */
export const DUCKING_SLIPS = 5;

/** the ladder state of a fighter (match-wide, all referee fouls together) */
export interface LadderState {
  cautions: number;
  warnings: number;
  deductions: number;
}

export interface LadderStep {
  level: FoulLevel;
  /** points off every judge's card for this round (1 for a warning / the disqualifying warning) */
  penalty: number;
  next: LadderState;
}

/**
 * The referee's ladder: the first `cautions` fouls are cautions (no points); every foul after is a warning, −1 on
 * every judge's card; the `warningsToDq`-th warning disqualifies (IBA TCR 23.2: the third warning disqualifies).
 */
export function ladderStep(
  f: LadderState,
  rules: Pick<ScoringRules, "cautions" | "warningsToDq">,
): LadderStep {
  if (f.cautions < rules.cautions)
    return { level: "caution", penalty: 0, next: { ...f, cautions: f.cautions + 1 } };
  const warnings = f.warnings + 1;
  return {
    level: warnings >= rules.warningsToDq ? "dq" : "warning",
    penalty: 1,
    next: { ...f, warnings, deductions: f.deductions + 1 },
  };
}

/** the `warning` event of a referee foul */
export const foulEvent = (t: number, to: 0 | 1, foul: RefereeFoul, step: LadderStep): FightEvent => ({
  k: "warning",
  t,
  to,
  foul,
  penalty: step.penalty,
  level: step.level,
  n: step.next.warnings,
});

/** can a DQ be legal for this fighter (property tests / audit): only at the warningsToDq-th warning */
export const dqAllowed = (f: LadderState, rules: Pick<ScoringRules, "warningsToDq">): boolean =>
  f.warnings >= rules.warningsToDq;
