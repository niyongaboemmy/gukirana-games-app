import type { BoxingOutcome, FightEvent, Punch } from "@gukirana/contracts";

/**
 * Clear witness of pass or fail (P3-FGT-09). Pure presentation logic over the engine's events and outcome (the engine
 * stays the only judge; nothing here changes a result):
 *  - every punch gets an outcome word (LANDED / BLOCKED / SLIPPED / MISSED) with a tone from MY side of it;
 *  - a running tally of the fight (thrown / landed / power / knockdowns / fouls, per fighter and per round);
 *  - the reasons a round went the way it did on the cards;
 *  - practice level goals, judged PASS / FAIL with 0–3 stars and what to improve.
 */

export type PunchOutcome = "landed" | "blocked" | "slipped" | "missed";
export interface PunchVerdict {
  outcome: PunchOutcome;
  /** my punch (true) or one thrown at me */
  mine: boolean;
  /** good for me: my punch landed, or theirs was blocked / slipped / missed */
  good: boolean;
  punch: Punch;
  points: number;
}

/** the outcome of a punch event, from fighter `me`'s side (null: not a punch outcome) */
export function punchVerdict(e: FightEvent, me: 0 | 1): PunchVerdict | null {
  const kind: PunchOutcome | null = e.k === "hit" ? "landed" : e.k === "block" ? "blocked" : e.k === "evade" ? "slipped" : e.k === "whiff" ? "missed" : null;
  if (!kind || !("by" in e) || typeof e.by !== "number") return null;
  const mine = e.by === me;
  const landed = kind === "landed";
  return { outcome: kind, mine, good: mine ? landed : !landed, punch: (e as { punch: Punch }).punch, points: e.k === "hit" ? e.points : 0 };
}

/** the colour of each outcome (consistent everywhere: pops, flash, stats); tone of the sound in fx */
export const OUTCOME_COLOR: Record<PunchOutcome, string> = {
  landed: "#22c55e",
  blocked: "#f59e0b",
  slipped: "#e2d3c1",
  missed: "#ef4444",
};

const POWER: ReadonlySet<Punch> = new Set<Punch>(["cross", "hook", "uppercut"]);

export interface Side {
  thrown: number;
  landed: number;
  powerLanded: number;
  blocked: number;
  slipped: number;
  missed: number;
  /** knockdowns this fighter SCORED (put the other one down) */
  knockdowns: number;
  warnings: number;
  /** points from clean punches */
  points: number;
}
export interface RoundTally {
  round: number;
  sides: [Side, Side];
}
export interface FightStats {
  sides: [Side, Side];
  rounds: RoundTally[];
  /** the round the tally is in (0 before the first bell) */
  round: number;
}

const side = (): Side => ({ thrown: 0, landed: 0, powerLanded: 0, blocked: 0, slipped: 0, missed: 0, knockdowns: 0, warnings: 0, points: 0 });
export const newStats = (): FightStats => ({ sides: [side(), side()], rounds: [], round: 0 });

/** fold events into the tally (returns a new object; the input is not changed) */
export function tallyStats(st: FightStats, events: readonly FightEvent[]): FightStats {
  if (!events.length) return st;
  const out: FightStats = { sides: [{ ...st.sides[0] }, { ...st.sides[1] }], rounds: st.rounds.map((r) => ({ round: r.round, sides: [{ ...r.sides[0] }, { ...r.sides[1] }] })), round: st.round };
  const cur = (): RoundTally => {
    let r = out.rounds.find((x) => x.round === out.round);
    if (!r) {
      r = { round: out.round, sides: [side(), side()] };
      out.rounds.push(r);
    }
    return r;
  };
  const bump = (i: 0 | 1, f: (s: Side) => void) => {
    f(out.sides[i]);
    f(cur().sides[i]);
  };
  for (const e of events) {
    if (e.k === "bell") {
      out.round = e.round;
      cur();
      continue;
    }
    if (e.k === "hit" || e.k === "block" || e.k === "evade" || e.k === "whiff") {
      const by = e.by;
      bump(by, (s) => {
        s.thrown++;
        if (e.k === "hit") {
          s.landed++;
          s.points += e.points;
          if (POWER.has(e.punch)) s.powerLanded++;
        } else if (e.k === "block") s.blocked++;
        else if (e.k === "evade") s.slipped++;
        else s.missed++;
      });
    } else if (e.k === "knockdown") bump((1 - e.to) as 0 | 1, (s) => s.knockdowns++);
    else if (e.k === "warning" && e.penalty > 0) bump(e.to, (s) => s.warnings++);
  }
  return out;
}

/** landed / thrown as a whole percent (0 when nothing thrown) */
export const accuracy = (s: Side): number => (s.thrown ? Math.round((100 * s.landed) / s.thrown) : 0);

/* ------------------------------------------------------------ round verdict ------------------------------------------------------------ */

export type RoundReason =
  | { k: "knockdowns"; mine: number; theirs: number }
  | { k: "landed"; mine: number; theirs: number }
  | { k: "power"; mine: number; theirs: number }
  | { k: "warnings"; mine: number; theirs: number };
export interface RoundVerdict {
  /** who took the round on most cards, from my side */
  winner: "me" | "them" | "even";
  /** judges for me / for them / level */
  votes: [number, number, number];
  /** the clearest reasons first (only the ones that differ) */
  reasons: RoundReason[];
}

/** why a round went the way it did: the judges' cards (when open) and the tally of that round */
export function roundVerdict(e: Extract<FightEvent, { k: "roundEnd" }>, tally: RoundTally | undefined, me: 0 | 1): RoundVerdict {
  const judges = e.card?.judges ?? [];
  const ded = e.card?.deductions ?? [0, 0];
  let forMe = 0,
    forThem = 0,
    level = 0;
  for (const j of judges) {
    const a = j[me] - ded[me];
    const b = j[1 - me]! - ded[1 - me]!;
    if (a > b) forMe++;
    else if (b > a) forThem++;
    else level++;
  }
  if (!judges.length) {
    // sealed cards: the round's points
    const a = e.points[me];
    const b = e.points[1 - me]!;
    if (a > b) forMe = 1;
    else if (b > a) forThem = 1;
    else level = 1;
  }
  const winner = forMe > forThem ? "me" : forThem > forMe ? "them" : "even";
  const reasons: RoundReason[] = [];
  if (tally) {
    const m = tally.sides[me];
    const t = tally.sides[1 - me]!;
    if (m.knockdowns !== t.knockdowns) reasons.push({ k: "knockdowns", mine: m.knockdowns, theirs: t.knockdowns });
    if (m.landed !== t.landed) reasons.push({ k: "landed", mine: m.landed, theirs: t.landed });
    if (m.powerLanded !== t.powerLanded) reasons.push({ k: "power", mine: m.powerLanded, theirs: t.powerLanded });
    if (m.warnings !== t.warnings) reasons.push({ k: "warnings", mine: m.warnings, theirs: t.warnings });
  }
  return { winner, votes: [forMe, forThem, level], reasons: reasons.slice(0, 2) };
}

/** live score of the round in progress (clean points this round), from my side */
export function liveRound(st: FightStats, me: 0 | 1): { round: number; mine: number; theirs: number } | null {
  const r = st.rounds.find((x) => x.round === st.round);
  if (!r || st.round < 1) return null;
  return { round: st.round, mine: r.sides[me].points, theirs: r.sides[1 - me]!.points };
}

/* ------------------------------------------------------------ practice goals ------------------------------------------------------------ */

export type GoalKind = "land" | "winRound" | "win" | "winClear";
export interface LevelGoal {
  level: number;
  kind: GoalKind;
  /** land: clean punches to land */
  n: number;
}
/** each practice level's goal: early levels teach landing, later ones winning (a clear win at the top) */
export function levelGoal(level: number): LevelGoal {
  const l = Math.min(5, Math.max(1, Math.round(level)));
  if (l === 1) return { level: l, kind: "land", n: 10 };
  if (l === 2) return { level: l, kind: "land", n: 20 };
  if (l === 3) return { level: l, kind: "winRound", n: 0 };
  if (l === 4) return { level: l, kind: "win", n: 0 };
  return { level: l, kind: "winClear", n: 0 };
}

export type TipKey = "tip.accuracy" | "tip.guard" | "tip.power" | "tip.stamina" | "tip.fouls" | "tip.busy" | "tip.nextLevel";
export interface GoalResult {
  pass: boolean;
  /** 0 … 3 */
  stars: number;
  /** the progress line: landed so far, rounds won … */
  progress: { have: number; need: number };
  /** what to improve (at most 2), or the next step */
  tips: TipKey[];
}

/** rounds I took on the cards (majority of judges, deductions applied) */
export function roundsWon(outcome: BoxingOutcome, me: 0 | 1): number {
  const cards = outcome.cards ?? [];
  if (!cards.length) return outcome.rounds.filter((r) => r[me] > r[1 - me]!).length;
  return cards.filter((c) => {
    let a = 0,
      b = 0;
    for (const j of c.judges) {
      const x = j[me] - c.deductions[me];
      const y = j[1 - me]! - c.deductions[1 - me]!;
      if (x > y) a++;
      else if (y > x) b++;
    }
    return a > b;
  }).length;
}

/** judge a finished practice fight against its level goal (pure: the same result on every screen) */
export function judgeGoal(goal: LevelGoal, outcome: BoxingOutcome, stats: FightStats, me: 0 | 1): GoalResult {
  const m = stats.sides[me];
  const t = stats.sides[1 - me]!;
  const won = outcome.winner === me;
  const method = outcome.method;
  const clear = won && (method === "KO" || method === "RSC" || method === "UD" || outcome.decision === "stoppage");
  const rw = roundsWon(outcome, me);
  let pass: boolean;
  let progress: { have: number; need: number };
  switch (goal.kind) {
    case "land":
      pass = m.landed >= goal.n;
      progress = { have: Math.min(m.landed, goal.n), need: goal.n };
      break;
    case "winRound":
      pass = rw >= 1 || won;
      progress = { have: Math.min(1, rw), need: 1 };
      break;
    case "win":
      pass = won;
      progress = { have: won ? 1 : 0, need: 1 };
      break;
    case "winClear":
      pass = clear;
      progress = { have: clear ? 1 : 0, need: 1 };
      break;
  }
  // stars: 1 for the goal, +1 for accuracy ≥ 40 %, +1 for winning the fight (or a stoppage when the goal is a win)
  let stars = 0;
  if (pass) {
    stars = 1;
    if (accuracy(m) >= 40) stars++;
    if (goal.kind === "win" || goal.kind === "winClear" ? m.knockdowns > 0 || method === "UD" : won) stars++;
  }
  const tips: TipKey[] = [];
  if (accuracy(m) < 35 && m.thrown >= 6) tips.push("tip.accuracy");
  if (m.thrown < 12) tips.push("tip.busy");
  if (t.landed > m.landed) tips.push("tip.guard");
  if (m.powerLanded < Math.max(2, Math.floor(m.landed / 4))) tips.push("tip.power");
  if (m.warnings > 0) tips.push("tip.fouls");
  if (!won && (method === "KO" || method === "RSC")) tips.unshift("tip.stamina");
  if (pass && tips.length === 0) tips.push("tip.nextLevel");
  return { pass, stars, progress, tips: tips.slice(0, 2) };
}
