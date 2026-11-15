import type { BoxingMethod, Foul, FoulLevel, TiebreakStep } from "@gukirana/contracts";

/**
 * Boxing scoring + referee strings (P3-FGT-06, docs/BOXING-SCORING.md). English source of the i18n keys
 * `fight.scoring.*`, for the HUD, the result card and the rules tutorial. The HUD (P3-FGT-05) imports these; this file
 * holds text and plain data only, no UI. Plain words, no jargon.
 */
export const FS = {
  // fouls: what the referee says (HUD pop)
  "foul.PASSIVITY": "Too passive: throw punches",
  "foul.IDLE": "Are you there? No input",
  "foul.HOLDING": "Holding: punch or step out of the clinch",
  "foul.HIT_ON_BREAK": "Punch on the break: wait after “Break!”",
  "foul.DUCKING": "Ducking: too many slips without a punch",
  "foul.LOW_BLOW": "Low blow",
  // the ladder
  "level.caution": "Caution",
  "level.warning": "Warning · −1 point on every card",
  "level.dq": "Disqualified",
  "hud.break": "Break!",
  "hud.cautions": "Cautions {n}",
  "hud.warnings": "Warnings {n} of {max}",
  "hud.judges": "{n} judges",
  "hud.cardsSealed": "The judges' cards are shown at the end",
  "hud.card": "Judge {j}: {a} – {b}",
  // decision methods (result card)
  "method.KO": "Knockout: could not beat the count",
  "method.RSC": "Referee stopped the contest",
  "method.DQ": "Disqualification",
  "method.UD": "Unanimous decision",
  "method.SD": "Split decision",
  "method.MD": "Majority decision",
  "method.TB": "Level on the cards: won on countback",
  "method.DRAW": "Draw on the cards",
  "method.FORFEIT": "By forfeit",
  "method.VOID": "No result: nothing was settled",
  "method.dqBy": "Disqualified for: {foul}",
  // the countback step that named the winner
  "tiebreak.VOTES": "more judges had them ahead",
  "tiebreak.CARDS": "more points on all the cards together",
  "tiebreak.KNOCKDOWNS": "more knockdowns scored",
  "tiebreak.WARNINGS": "fewer warnings",
  "tiebreak.CAUTIONS": "fewer cautions",
  "tiebreak.POWER": "more clean power punches",
  "tiebreak.LANDED": "more clean punches landed",
  "tiebreak.LAST_ROUND": "won the last round",
  // tutorial: how scoring works
  "rules.title": "How the fight is scored",
  "rules.judges": "{n} judges score every round. The winner of a round gets 10 points, the other 9.",
  "rules.clear": "A knockdown or a one-sided round is 10–8; two knockdowns, 10–7. A level round is 10–10.",
  "rules.criteria": "Judges count clean punches first, then power, defence, footwork and who takes the lead.",
  "rules.decision": "Most judges ahead wins: all of them = unanimous, a majority with one against = split.",
  "rules.ladder": "Fouls: first a caution, then warnings (−1 point on every card). Warning {max} = disqualified.",
  "rules.ko": "Knocked down with no stamina left? You can't beat the count: knockout.",
  "rules.stoppage": "Three knockdowns in a round, or four in the fight, and the referee stops it.",
  // tutorial: each foul (what triggers it, how to avoid it)
  "rule.PASSIVITY.when": "No punch thrown for 15 seconds.",
  "rule.PASSIVITY.avoid": "Keep throwing: even a jab resets it.",
  "rule.HOLDING.when": "Standing chest to chest for 2 seconds without punching. The first “Break!” of a round is free.",
  "rule.HOLDING.avoid": "Punch when you are close, or step out.",
  "rule.HIT_ON_BREAK.when": "Pressing a punch in the second after the referee says “Break!”.",
  "rule.HIT_ON_BREAK.avoid": "Wait for the break to end before you punch.",
  "rule.DUCKING.when": "Five slips in a row without a punch.",
  "rule.DUCKING.avoid": "Slip, then punch back.",
} as const;
export type FsKey = keyof typeof FS;

/** translate a scoring key, filling `{name}` placeholders */
export function fst(key: FsKey, vars?: Record<string, string | number>): string {
  let s: string = FS[key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export const foulText = (f: Foul): FsKey => `foul.${f}` as FsKey;
export const levelText = (l: FoulLevel): FsKey => `level.${l}` as FsKey;
export const methodText = (m: BoxingMethod): FsKey => `method.${m}` as FsKey;
export const tiebreakText = (t: TiebreakStep): FsKey => `tiebreak.${t}` as FsKey;

/** the foul rules the tutorial lists (LOW_BLOW is reserved: not in the game yet; IDLE is the inactivity strike) */
export const FOUL_TUTORIAL = (["PASSIVITY", "HOLDING", "HIT_ON_BREAK", "DUCKING"] as const).map((foul) => ({
  foul,
  when: `rule.${foul}.when` as FsKey,
  avoid: `rule.${foul}.avoid` as FsKey,
}));
