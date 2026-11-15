import type { FightEvent, FoulLevel, RefereeFoul, ScoringRules } from "@gukirana/contracts";

/**
 * Boxing fouls and the referee's escalation ladder (P3-FGT-06, docs/BOXING-SCORING.md §4).
 *
 * Every foul is detected from the engine's own state with fixed integer thresholds: nothing random, nothing a client
 * can claim, and every one is avoidable by skill (each rule has a plain "how to avoid it" line in the HUD tutorial
 * data, apps/web/src/fight/game/scoring-strings.ts). Impossible by construction (no such input or state): hitting
 * after the bell (acts reset at the bell, presses outside a round are dropped), hitting a downed opponent (both are
 * frozen during the count), head-butts, kicks, the open glove, pivot blows, low blows (engine v2's body shots land on
 * the legal body target by construction; LOW_BLOW stays reserved). Engine v2 adds the clinch: a clinch the referee has
 * to break counts as a "Break!" call (HOLDING after FREE_BREAKS), and ducks count with slips for DUCKING.
 */

/*
 * The distances / times of the referee's "Break!" are engine geometry: engine v2 (engine.ts CLOSE_MM, CLOSE_TICKS,
 * CLINCH_TICKS, BREAK_GAP, BREAK_TICKS); v1 keeps its own frozen copy (v1/fouls.ts).
 */
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
