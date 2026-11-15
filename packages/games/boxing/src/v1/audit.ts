import { scoringRulesOf, type FightRules, type PauseReason } from "@gukirana/contracts";
import { stableStringify } from "@gukirana/game-kit";
import {
  beginFight,
  createFight,
  forfeitFight,
  hashFight,
  pauseFight,
  resumeFight,
  stepFight,
  voidFight,
  type FightState,
  type TickInputs,
} from "./engine.js";
import { dqAllowed } from "./fouls.js";
import { cardFor, decideCards, isValidCard, totalsOf } from "./scoring.js";

/**
 * The fight log and the pre-sign audit (P3-FGT-06, docs/BOXING-SCORING.md §6).
 *
 * The room records every engine call it makes (begin, each tick's inputs, pauses / resumes, forfeit / void). Because
 * the engine is pure, replaying the log from `createFight` must give the exact same state — and the same judges'
 * cards, decision and hash. Before signing a result the room replays its own log and checks the cards; a mismatch is
 * never signed (the match is voided instead). The log's hash goes into the signed `stateHash` (the room hashes `logText` with `hashFight`), so anyone holding the log
 * can re-derive the result and check it against the settled match.
 */
export type FightOp =
  | { o: "begin" }
  | { o: "step"; i: TickInputs }
  /** `n` ticks in a row with no input from either fighter */
  | { o: "idle"; n: number }
  | { o: "pause"; reason: PauseReason; who?: 0 | 1 }
  | { o: "resume"; countdown: boolean }
  | { o: "forfeit"; loser: 0 | 1 }
  | { o: "void" };

export interface FightLog {
  players: [string, string];
  rules: FightRules;
  staked: boolean;
  ops: FightOp[];
}

export function newFightLog(players: [string, string], rules: FightRules, staked: boolean): FightLog {
  return { players, rules, staked, ops: [] };
}

/** append a step (runs of empty ticks are folded into one `idle` op) */
export function logStep(log: FightLog, inputs: TickInputs): void {
  if (inputs[0] === null && inputs[1] === null) {
    const last = log.ops.at(-1);
    if (last?.o === "idle") last.n += 1;
    else log.ops.push({ o: "idle", n: 1 });
    return;
  }
  log.ops.push({ o: "step", i: inputs });
}

const NONE: TickInputs = [null, null];

/** replay a log from scratch (pure) */
export function replayFight(log: FightLog): FightState {
  let s = createFight(log.players, log.rules, { staked: log.staked });
  for (const op of log.ops) {
    switch (op.o) {
      case "begin":
        s = beginFight(s);
        break;
      case "step":
        s = stepFight(s, op.i);
        break;
      case "idle":
        for (let k = 0; k < op.n; k++) s = stepFight(s, NONE);
        break;
      case "pause":
        s = pauseFight(s, op.reason, op.who);
        break;
      case "resume":
        s = resumeFight(s, op.countdown);
        break;
      case "forfeit":
        s = forfeitFight(s, op.loser);
        break;
      case "void":
        s = voidFight(s);
        break;
    }
  }
  return s;
}

/** the canonical text of a log (the room hashes it into the signed `stateHash`) */
export const logText = (log: FightLog): string => stableStringify(log);

/**
 * Check a finished fight's scoring against its own records: every card well formed and equal to the judges' card of
 * that round's tally, deductions applied exactly once, the totals and the decision type matching the cards, a DQ only
 * after the warning ladder, and (when a log is given) the replay reaching the very same state. [] = all good.
 */
export function auditFight(s: FightState, log?: FightLog): string[] {
  const errs: string[] = [];
  const o = s.outcome;
  if (!o) return ["NOT_OVER"];
  const sr = scoringRulesOf(s.rules);
  if (s.cards.length !== s.tallies.length) errs.push("CARDS_TALLIES");
  s.cards.forEach((c, k) => {
    if (c.round !== k + 1) errs.push(`ROUND_ORDER:${k}`);
    if (!isValidCard(c, sr.judges)) errs.push(`CARD_INVALID:${c.round}`);
    const t = s.tallies[k];
    if (t && stableStringify(cardFor(c.round, t, sr.judges, !!c.partial)) !== stableStringify(c))
      errs.push(`CARD_MISMATCH:${c.round}`);
  });
  // deductions: once per warning, nowhere else
  for (const i of [0, 1] as const) {
    const onCards = s.cards.reduce((n, c) => n + c.deductions[i], 0);
    if (onCards !== s.fighters[i].deductions || s.fighters[i].deductions !== s.fighters[i].warnings)
      errs.push(`DEDUCTIONS:${i}`);
  }
  const totals = totalsOf(s.cards, sr.judges);
  if (o.totals && stableStringify(o.totals) !== stableStringify(totals)) errs.push("TOTALS");
  if (o.decision === "points" || o.decision === "draw") {
    // re-run the decision: it must give the same method and winner
    const named = sr.drawTiebreak === "always" || (sr.drawTiebreak === "staked" && s.staked);
    const [a, b] = s.fighters;
    const landed = (i: 0 | 1) => s.tallies.reduce((n, t) => n + t[i].landed, 0);
    const d = decideCards(
      s.cards,
      sr.judges,
      {
        knockdownsScored: [b.knockdowns, a.knockdowns],
        warnings: [a.warnings, b.warnings],
        cautions: [a.cautions, b.cautions],
        power: [a.power, b.power],
        landed: [landed(0), landed(1)],
      },
      named,
    );
    if (d.method !== o.method || d.winner !== o.winner) errs.push("DECISION");
  }
  if (o.method === "DQ") {
    for (const i of [0, 1] as const)
      if ((o.winner === null || o.winner === 1 - i) && !dqAllowed(s.fighters[i], sr))
        errs.push(`DQ_EARLY:${i}`);
  }
  if (log) {
    const r = replayFight(log);
    if (hashFight(r) !== hashFight(s)) errs.push("REPLAY");
  }
  return errs;
}
