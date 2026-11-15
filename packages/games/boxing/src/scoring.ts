import type { BoxingMethod, FightEvent, RoundCard, TiebreakStep } from "@gukirana/contracts";
import { TIEBREAK_STEPS } from "@gukirana/contracts";

/**
 * Boxing scoring: deterministic virtual judges on the 10-point-must system (P3-FGT-06, docs/BOXING-SCORING.md §3).
 *
 * Everything here is a pure, integer function of the engine's own events: the engine folds every tick's events into
 * a per-round tally (`tallyEvents`), each judge turns the tally of a round into a 10-x card (`scoreRound`), and the
 * cards decide the fight (`decideCards`). No randomness, no clocks, no corner bias: swapping the fighters swaps every
 * number. Judges differ only by their fixed integer weights (JUDGE_PROFILES), so close fights can be split.
 */

/** what one fighter did in a round, as the judges see it (all counts / sums of event values) */
export interface SideTally {
  /** value of clean blows landed: the `points` of the fighter's hit events (punch value + counter + combo bonus) */
  value: number;
  /** clean punches landed (a partial uppercut through the guard is not clean) */
  landed: number;
  /** clean power punches landed (cross / hook / uppercut) */
  power: number;
  /** punches thrown (landed, partial, blocked, evaded or missed): initiative / activity */
  thrown: number;
  /** the opponent's punches this fighter blocked or slipped: defence */
  defended: number;
  /** the opponent's punches that fell short (out of reach): footwork / ring generalship */
  forcedMiss: number;
  /** knockdowns this fighter scored */
  kd: number;
  /** points deducted from this fighter in the round (one per warning) */
  ded: number;
}
export type RoundTally = [SideTally, SideTally];

const side = (): SideTally => ({
  value: 0,
  landed: 0,
  power: 0,
  thrown: 0,
  defended: 0,
  forcedMiss: 0,
  kd: 0,
  ded: 0,
});
export const emptyTally = (): RoundTally => [side(), side()];

/** fold one tick's events into the round tally (pure: returns a new tally when something counted) */
export function tallyEvents(t: RoundTally, events: readonly FightEvent[]): RoundTally {
  let out: RoundTally | null = null;
  const w = (): RoundTally => (out ??= [{ ...t[0] }, { ...t[1] }]);
  for (const e of events) {
    switch (e.k) {
      case "hit": {
        const s = w()[e.by];
        s.value += e.points;
        s.thrown += 1;
        // clean hits always carry a combo count ≥ 1; a partial uppercut through the guard has combo 0
        if (e.combo > 0) {
          s.landed += 1;
          if (e.punch !== "jab") s.power += 1;
        }
        break;
      }
      case "block":
      case "evade":
        w()[e.by].thrown += 1;
        w()[1 - e.by]!.defended += 1;
        break;
      case "whiff":
        w()[e.by].thrown += 1;
        w()[1 - e.by]!.forcedMiss += 1;
        break;
      case "knockdown":
        w()[1 - e.to]!.kd += 1;
        break;
      case "warning":
        if (e.level && e.penalty > 0) w()[e.to].ded += e.penalty;
        break;
      default:
        break;
    }
  }
  return out ?? t;
}

/**
 * A judge's integer weights (World Boxing / IBA criteria, IBA TCR 18.11): quality blows on target dominate every
 * judge (`clean` per point of blow value); judges then lean slightly differently on power, defence, footwork (ring
 * generalship) and activity (initiative). Fixed table: nothing about a judge depends on who fights.
 */
export interface JudgeProfile {
  id: string;
  /** per point of clean blow value */
  clean: number;
  /** per clean power punch */
  power: number;
  /** per opponent punch blocked / slipped */
  defence: number;
  /** per opponent punch made to miss (out of reach) */
  footwork: number;
  /** per punch thrown */
  activity: number;
}
export const JUDGE_PROFILES: readonly JudgeProfile[] = [
  { id: "J1", clean: 4, power: 2, defence: 2, footwork: 1, activity: 1 }, // balanced
  { id: "J2", clean: 4, power: 4, defence: 1, footwork: 0, activity: 1 }, // likes power
  { id: "J3", clean: 4, power: 1, defence: 3, footwork: 2, activity: 0 }, // technician: defence, footwork
  { id: "J4", clean: 4, power: 2, defence: 1, footwork: 1, activity: 2 }, // initiative, aggression
  { id: "J5", clean: 5, power: 1, defence: 1, footwork: 1, activity: 1 }, // counts clean blows
];
export const judgesFor = (n: number): readonly JudgeProfile[] => JUDGE_PROFILES.slice(0, n);

/** weight of a knockdown in deciding WHO won a round (≈ ten clean jabs: a knockdown nearly always wins the round) */
export const KD_WEIGHT = 40;
/** "clear winner" without a knockdown (10-8): base score ≥ 3× the opponent's and at least this far ahead */
export const DOMINANCE_RATIO = 3;
export const DOMINANCE_MARGIN = 60;

/** a judge's view of one side's round, without the knockdowns */
export const baseScore = (s: SideTally, p: JudgeProfile): number =>
  p.clean * s.value +
  p.power * s.power +
  p.defence * s.defended +
  p.footwork * s.forcedMiss +
  p.activity * s.thrown;

/**
 * One judge, one round, 10-point must (before deductions):
 *  - level (same weighted score, same knockdowns): 10-10 — the judge saw nothing between them;
 *  - else the round winner gets 10, the loser 9 (close round), 8 (clear: one net knockdown OR dominance) or
 *    7 (total dominance: two net knockdowns, or one plus dominance). Never below 7 (IBA TCR 18.12).
 */
export function scoreRound(t: RoundTally, p: JudgeProfile): [number, number] {
  const base: [number, number] = [baseScore(t[0], p), baseScore(t[1], p)];
  const total: [number, number] = [base[0] + KD_WEIGHT * t[0].kd, base[1] + KD_WEIGHT * t[1].kd];
  if (total[0] === total[1]) return [10, 10];
  const w = total[0] > total[1] ? 0 : 1;
  const l = 1 - w;
  const netKd = Math.max(0, t[w].kd - t[l]!.kd);
  const dominant = base[w] >= DOMINANCE_RATIO * base[l]! && base[w] - base[l]! >= DOMINANCE_MARGIN;
  const loser = Math.max(7, 9 - Math.min(2, netKd + (dominant ? 1 : 0)));
  return w === 0 ? [10, loser] : [loser, 10];
}

/** every judge's card for a round */
export function cardFor(round: number, t: RoundTally, judges: number, partial = false): RoundCard {
  return {
    round,
    judges: judgesFor(judges).map((p) => scoreRound(t, p)),
    deductions: [t[0].ded, t[1].ded],
    knockdowns: [t[1].kd, t[0].kd],
    ...(partial ? { partial: true } : {}),
  };
}

/** per judge: [red, blue] totals after deductions */
export function totalsOf(cards: readonly RoundCard[], judges: number): [number, number][] {
  return Array.from({ length: judges }, (_, j) => {
    let a = 0;
    let b = 0;
    for (const c of cards) {
      const s = c.judges[j]!;
      a += s[0] - c.deductions[0];
      b += s[1] - c.deductions[1];
    }
    return [a, b] as [number, number];
  });
}

/** the countback inputs (symmetric: [red, blue]; "fewer is better" steps are compared reversed) */
export interface CountbackStats {
  knockdownsScored: [number, number];
  warnings: [number, number];
  cautions: [number, number];
  power: [number, number];
  landed: [number, number];
}

export interface CardsDecision {
  method: Extract<BoxingMethod, "UD" | "SD" | "MD" | "TB" | "DRAW">;
  winner: 0 | 1 | null;
  totals: [number, number][];
  votes: (0 | 1 | null)[];
  tiebreak?: TiebreakStep;
}

/**
 * The decision on the cards. A winner needs a majority of ALL judges (3 of 5, 2 of 3):
 *  UD every judge has them ahead · MD a majority, the rest level · SD a majority, at least one judge the other way.
 * No majority → countback (when a winner must be named: staked fights by default) → else a draw.
 */
export function decideCards(
  cards: readonly RoundCard[],
  judges: number,
  stats: CountbackStats,
  nameWinner: boolean,
): CardsDecision {
  const totals = totalsOf(cards, judges);
  const votes = totals.map(([a, b]) => (a > b ? 0 : b > a ? 1 : null));
  const v: [number, number] = [votes.filter((x) => x === 0).length, votes.filter((x) => x === 1).length];
  const need = Math.floor(judges / 2) + 1;
  for (const w of [0, 1] as const) {
    if (v[w] < need) continue;
    const method = v[1 - w]! > 0 ? "SD" : v[w] === judges ? "UD" : "MD";
    return { method, winner: w, totals, votes };
  }
  if (nameWinner) {
    const sum = (i: 0 | 1) => totals.reduce((n, t) => n + t[i], 0);
    const last = cards.at(-1);
    const lastSum = (i: 0 | 1) =>
      last ? last.judges.reduce((n, s) => n + s[i], 0) - judges * last.deductions[i] : 0;
    const steps: Record<TiebreakStep, [number, number]> = {
      VOTES: v,
      CARDS: [sum(0), sum(1)],
      KNOCKDOWNS: stats.knockdownsScored,
      // fewer is better: compare the opponent's count
      WARNINGS: [stats.warnings[1], stats.warnings[0]],
      CAUTIONS: [stats.cautions[1], stats.cautions[0]],
      POWER: stats.power,
      LANDED: stats.landed,
      LAST_ROUND: [lastSum(0), lastSum(1)],
    };
    for (const step of TIEBREAK_STEPS) {
      const [a, b] = steps[step];
      if (a !== b) return { method: "TB", winner: a > b ? 0 : 1, totals, votes, tiebreak: step };
    }
  }
  return { method: "DRAW", winner: null, totals, votes };
}

/** is this a well-formed card (property tests, the room's pre-sign audit)? */
export function isValidCard(c: RoundCard, judges: number): boolean {
  if (c.judges.length !== judges) return false;
  for (const [a, b] of c.judges) {
    if (!Number.isInteger(a) || !Number.isInteger(b)) return false;
    if (Math.max(a, b) !== 10 || Math.min(a, b) < 7) return false;
  }
  return c.deductions.every((d) => Number.isInteger(d) && d >= 0) && c.knockdowns.every((k) => k >= 0);
}
