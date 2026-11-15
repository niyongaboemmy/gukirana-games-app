import { describe, expect, it } from "vitest";
import {
  DEFAULT_FIGHT_RULES,
  scoringRulesOf,
  type BoxingAction,
  type FightEvent,
  type FightInput,
  type FightRules,
  type RoundCard,
} from "@gukirana/contracts";
import {
  auditFight,
  beginFight,
  BREAK_DIST,
  cardFor,
  CLINCH_TICKS,
  createFight,
  decideCards,
  DUCKING_SLIPS,
  emptyTally,
  hashFight,
  isValidCard,
  KO_COUNT_TICKS,
  ladderStep,
  logStep,
  matchResultOf,
  newFightLog,
  replayFight,
  scoreRound,
  stepFight,
  JUDGE_PROFILES,
  tallyEvents,
  totalsOf,
  type FighterState,
  type FightState,
  type RoundTally,
  type SideTally,
  type TickInputs,
} from "./index.js";

/**
 * P3-FGT-06 — judges, fouls, decisions and the property tests of docs/BOXING-SCORING.md §7: 10k seeded fights always
 * give valid cards (every round 10-x, x in 7..10; deductions once; totals = sums), replaying the log gives identical
 * cards and hash, mirrored inputs give mirrored cards, the decision type matches the cards, and a DQ only comes after
 * the warning ladder.
 */

const NONE: TickInputs = [null, null];
const side = (p: Partial<SideTally> = {}): SideTally => ({ ...emptyTally()[0], ...p });
const tally = (a: Partial<SideTally>, b: Partial<SideTally>): RoundTally => [side(a), side(b)];
const J1 = JUDGE_PROFILES[0]!;

function inRound(dist = 150, guards: [boolean, boolean] = [false, false], rules?: FightRules): FightState {
  let s = beginFight(createFight(["a", "b"], rules));
  while (s.phase !== "round") s = stepFight(s, NONE);
  return {
    ...s,
    dist,
    fighters: s.fighters.map((f, i) => ({ ...f, guard: guards[i]! })) as [FighterState, FighterState],
  };
}
/** play ticks; `press(k)` gives the presses at tick offset k; the guards are re-sent every tick (not idle) */
function play(
  s0: FightState,
  n: number,
  press: (k: number) => [BoxingAction | null, BoxingAction | null] = () => [null, null],
  guards: [boolean, boolean] = [false, false],
) {
  let s = s0;
  const events: FightEvent[] = [];
  for (let k = 0; k < n && s.phase !== "over"; k++) {
    const p = press(k);
    const inp = [0, 1].map((i) => ({
      seq: s.fighters[i]!.seq + 1,
      g: guards[i]!,
      ...(p[i] ? { a: p[i]! } : {}),
    })) as unknown as TickInputs;
    s = stepFight(s, inp);
    events.push(...s.events);
  }
  return { s, events };
}

describe("judges: 10-point must per round", () => {
  it("level → 10-10; a close round → 10-9; dominance → 10-8; knockdowns → 10-8 / 10-7; never below 7", () => {
    expect(scoreRound(tally({}, {}), J1)).toEqual([10, 10]);
    expect(
      scoreRound(tally({ value: 3, landed: 3, thrown: 3 }, { value: 2, landed: 1, power: 1, thrown: 1 }), J1),
    ).toEqual([10, 9]);
    // clear dominance without a knockdown: 3× the opponent's score and 60+ ahead
    expect(
      scoreRound(
        tally({ value: 20, landed: 12, power: 6, thrown: 15 }, { value: 2, landed: 2, thrown: 4 }),
        J1,
      ),
    ).toEqual([10, 8]);
    expect(
      scoreRound(tally({ value: 4, landed: 4, thrown: 4, kd: 1 }, { value: 4, landed: 4, thrown: 4 }), J1),
    ).toEqual([10, 8]);
    expect(
      scoreRound(tally({ value: 4, landed: 4, thrown: 4, kd: 2 }, { value: 4, landed: 4, thrown: 4 }), J1),
    ).toEqual([10, 7]);
    expect(scoreRound(tally({ value: 30, landed: 20, power: 10, thrown: 25, kd: 3 }, {}), J1)).toEqual([
      10, 7,
    ]);
    // a knockdown each: they cancel out; the better boxing wins 10-9
    expect(
      scoreRound(
        tally({ value: 5, landed: 5, thrown: 5, kd: 1 }, { value: 3, landed: 3, thrown: 3, kd: 1 }),
        J1,
      ),
    ).toEqual([10, 9]);
  });

  it("judges weigh the criteria differently, so a close round can be split (and it is symmetric)", () => {
    // red: busy and accurate with jabs; blue: fewer but heavier punches
    const t = tally(
      { value: 6, landed: 6, thrown: 10 },
      { value: 6, landed: 2, power: 2, thrown: 2, defended: 1 },
    );
    const cards = cardFor(1, t, 5).judges;
    expect(new Set(cards.map(([a, b]) => (a > b ? 0 : b > a ? 1 : -1))).size).toBeGreaterThan(1);
    const mirror = cardFor(1, [t[1], t[0]], 5).judges;
    expect(mirror).toEqual(cards.map(([a, b]) => [b, a]));
  });

  it("the tally counts the engine's events: clean / partial hits, defence, footwork, knockdowns, deductions", () => {
    const ev: FightEvent[] = [
      { k: "hit", t: 1, by: 0, punch: "cross", points: 2, counter: false, combo: 1 },
      { k: "hit", t: 2, by: 0, punch: "uppercut", points: 1, counter: false, combo: 0 },
      { k: "block", t: 3, by: 1, punch: "jab" },
      { k: "evade", t: 4, by: 1, punch: "hook" },
      { k: "whiff", t: 5, by: 1, punch: "jab" },
      { k: "knockdown", t: 6, to: 1, points: 5 },
      { k: "warning", t: 7, to: 1, foul: "HOLDING", penalty: 1, level: "warning", n: 1 },
      { k: "warning", t: 8, to: 1, foul: "IDLE", penalty: 0 },
    ];
    const [r, b] = tallyEvents(emptyTally(), ev);
    expect(r).toEqual(side({ value: 3, landed: 1, power: 1, thrown: 2, defended: 2, forcedMiss: 1, kd: 1 }));
    expect(b).toEqual(side({ thrown: 3, ded: 1 }));
  });
});

describe("decisions on the cards", () => {
  const card = (
    round: number,
    judges: [number, number][],
    deductions: [number, number] = [0, 0],
  ): RoundCard => ({
    round,
    judges,
    deductions,
    knockdowns: [0, 0],
  });
  const none = {
    knockdownsScored: [0, 0],
    warnings: [0, 0],
    cautions: [0, 0],
    power: [0, 0],
    landed: [0, 0],
  } as {
    knockdownsScored: [number, number];
    warnings: [number, number];
    cautions: [number, number];
    power: [number, number];
    landed: [number, number];
  };
  const five = (...w: (0 | 1 | null)[]): [number, number][] =>
    w.map((x) => (x === 0 ? [10, 9] : x === 1 ? [9, 10] : [10, 10]));

  it("unanimous, split, majority (5 and 3 judges)", () => {
    expect(decideCards([card(1, five(0, 0, 0, 0, 0))], 5, none, false)).toMatchObject({
      method: "UD",
      winner: 0,
    });
    expect(decideCards([card(1, five(1, 1, 1, 0, 0))], 5, none, false)).toMatchObject({
      method: "SD",
      winner: 1,
    });
    expect(decideCards([card(1, five(0, 0, 0, null, 1))], 5, none, false)).toMatchObject({
      method: "SD",
      winner: 0,
    });
    expect(decideCards([card(1, five(0, 0, 0, null, null))], 5, none, false)).toMatchObject({
      method: "MD",
      winner: 0,
    });
    expect(decideCards([card(1, five(0, 0, null))], 3, none, false)).toMatchObject({
      method: "MD",
      winner: 0,
    });
    expect(decideCards([card(1, five(0, 1, null))], 3, none, false)).toMatchObject({
      method: "DRAW",
      winner: null,
    });
  });

  it("a deduction comes off every card and can swing the decision", () => {
    const cards = [card(1, five(0, 0, 0, 0, 0), [1, 0])];
    expect(totalsOf(cards, 5)).toEqual(Array.from({ length: 5 }, () => [9, 9]));
    expect(decideCards(cards, 5, none, false)).toMatchObject({ method: "DRAW", winner: null });
  });

  it("no majority: a friendly is a draw; a staked fight goes to the countback (never by corner)", () => {
    const cards = [card(1, five(0, 0, 1, 1, null))];
    expect(decideCards(cards, 5, none, false)).toMatchObject({ method: "DRAW", winner: null });
    // votes 2-2, card sums equal → knockdowns scored, then fewer warnings, …
    expect(decideCards(cards, 5, { ...none, knockdownsScored: [0, 1] }, true)).toMatchObject({
      method: "TB",
      winner: 1,
      tiebreak: "KNOCKDOWNS",
    });
    expect(decideCards(cards, 5, { ...none, warnings: [1, 0] }, true)).toMatchObject({
      method: "TB",
      winner: 1,
      tiebreak: "WARNINGS",
    });
    expect(decideCards(cards, 5, { ...none, landed: [7, 6] }, true)).toMatchObject({
      method: "TB",
      winner: 0,
      tiebreak: "LANDED",
    });
    expect(decideCards(cards, 5, none, true)).toMatchObject({ method: "DRAW", winner: null });
    expect(decideCards([card(1, five(0, 0, 1, null, null))], 5, none, true)).toMatchObject({
      method: "TB",
      winner: 0,
      tiebreak: "VOTES",
    });
  });

  it("drawTiebreak: staked (default) names a winner only with stakes; always / never", () => {
    // red lands one more jab than blue in a 1-round fight… then both lose a point: still red. Here: perfectly level
    // cards but red landed more → only the countback separates them.
    const level = (staked: boolean, drawTiebreak?: "always" | "never") => {
      const rules: FightRules = {
        ...DEFAULT_FIGHT_RULES,
        rounds: 1,
        ...(drawTiebreak ? { drawTiebreak } : {}),
      };
      let s = { ...inRound(150, [false, false], rules), staked };
      s = { ...s, tally: tally({ landed: 1 }, {}), left: 1 };
      return stepFight(s, NONE).outcome!;
    };
    expect(level(false)).toMatchObject({ method: "DRAW", winner: null });
    expect(level(true)).toMatchObject({ method: "TB", winner: 0, tiebreak: "LANDED" });
    expect(level(false, "always")).toMatchObject({ method: "TB", winner: 0 });
    expect(level(true, "never")).toMatchObject({ method: "DRAW" });
  });
});

describe("fouls and the referee ladder", () => {
  it("ladder: cautions first, then warnings (−1), the warningsToDq-th warning disqualifies", () => {
    const rules = { cautions: 1, warningsToDq: 3 };
    let f = { cautions: 0, warnings: 0, deductions: 0 };
    const levels: string[] = [];
    for (let k = 0; k < 4; k++) {
      const st = ladderStep(f, rules);
      levels.push(`${st.level}:${st.penalty}`);
      f = st.next;
    }
    expect(levels).toEqual(["caution:0", "warning:1", "warning:1", "dq:1"]);
    expect(f).toEqual({ cautions: 1, warnings: 3, deductions: 3 });
    expect(
      ladderStep({ cautions: 0, warnings: 0, deductions: 0 }, { cautions: 0, warningsToDq: 2 }).level,
    ).toBe("warning");
  });

  it("HOLDING: close range without punching → Break! (free the first time), then a foul; the pair is separated", () => {
    const r = play(inRound(80), CLINCH_TICKS * 2 + 30, (k) => [
      k === 0 || k === CLINCH_TICKS + 5 ? "stepIn" : null,
      null,
    ]);
    const breaks = r.events.filter((e) => e.k === "break");
    expect(breaks.length).toBeGreaterThanOrEqual(1);
    expect(r.events.some((e) => e.k === "warning" && e.foul === "HOLDING")).toBe(false); // the first break is free
    // keep crowding after the break: the second break in the round is a HOLDING caution
    let s = r.s;
    expect(breaks[0]).toMatchObject({ by: [0, 1] });
    s = { ...s, dist: 80 };
    const r2 = play(s, CLINCH_TICKS + 2);
    const holding = r2.events.filter((e) => e.k === "warning" && e.foul === "HOLDING");
    expect(holding.map((e) => (e.k === "warning" ? e.level : ""))).toEqual(["caution", "caution"]);
    expect(r2.s.dist).toBe(BREAK_DIST);
  });

  it("HIT_ON_BREAK: a punch pressed within a second of Break! is cancelled and is a foul; waiting is fine", () => {
    let s = play(inRound(80), CLINCH_TICKS).s;
    expect(s.breakLeft).toBeGreaterThan(0);
    const bad = play(s, 3, (k) => [k === 0 ? "jab" : null, null]);
    expect(bad.events).toContainEqual(expect.objectContaining({ k: "warning", to: 0, foul: "HIT_ON_BREAK" }));
    expect(bad.s.fighters[0].act).toBe("idle");
    s = play(s, 40).s; // the break is over
    const ok = play(s, 3, (k) => [k === 0 ? "jab" : null, null]);
    expect(ok.events.some((e) => e.k === "warning")).toBe(false);
    expect(ok.s.fighters[0].act).toBe("jab");
  });

  it("DUCKING: DUCKING_SLIPS slips in a row without a punch; a punch in between resets the run", () => {
    const slips = (n: number, punchAt = -1) =>
      play(inRound(300), n * 12, (k) => [
        k % 12 === 0 ? (k / 12 === punchAt ? "jab" : "slipL") : null,
        null,
      ]).events.filter((e) => e.k === "warning" && e.foul === "DUCKING").length;
    expect(slips(DUCKING_SLIPS - 1)).toBe(0);
    expect(slips(DUCKING_SLIPS)).toBe(1);
    expect(slips(DUCKING_SLIPS + 1, 2)).toBe(0);
  });

  it("DQ ends the fight for the other fighter (decision dq); the cards are still kept", () => {
    let s = inRound(150);
    s.fighters[0] = { ...s.fighters[0], cautions: 1, warnings: 2, deductions: 2 };
    s = { ...s, fighters: [{ ...s.fighters[0], passive: 10_000 }, { ...s.fighters[1] }] };
    s = stepFight(s, [
      { seq: 99, g: false },
      { seq: 99, g: false },
    ]);
    expect(s.outcome).toMatchObject({ decision: "dq", method: "DQ", winner: 1, dqFoul: "PASSIVITY" });
    expect(s.events).toContainEqual(expect.objectContaining({ k: "dq", to: 0, foul: "PASSIVITY" }));
    expect(matchResultOf(s).ranks).toEqual({ a: 2, b: 1 });
    expect(s.cards).toHaveLength(1);
    expect(s.cards[0]!.partial).toBe(true);
  });

  it("KO: knocked down with no stamina left → the count runs to 10 and the fight ends", () => {
    let s = inRound(150);
    s.fighters[1] = { ...s.fighters[1], composure: 30, stamina: 50 };
    s = play(s, 15, (k) => [k === 0 ? "jab" : null, null]).s;
    expect(s.phase).toBe("knockdown");
    expect(s.ko).toBe(1);
    const r = play(s, KO_COUNT_TICKS + 2);
    const counts = r.events.flatMap((e) => (e.k === "count" ? [e.n] : []));
    expect(counts.at(-1)).toBe(10);
    expect(r.s.outcome).toMatchObject({ decision: "stoppage", method: "KO", winner: 0 });
    expect(r.events).toContainEqual(expect.objectContaining({ k: "ko", to: 1 }));
    expect(auditFight(r.s)).toEqual([]);
  });
});

/* ------------------------------------------------------------ property tests ------------------------------------------------------------ */

const lcg = (seed: number) => {
  let x = seed >>> 0 || 1;
  return {
    int(min: number, max: number) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      return min + ((x >>> 8) % (max - min + 1));
    },
  };
};
const ACTIONS: readonly BoxingAction[] = [
  "jab",
  "cross",
  "hook",
  "uppercut",
  "slipL",
  "slipR",
  "stepIn",
  "stepOut",
];

/** a seeded input script independent of the state (so it can be mirrored), with styles that make fouls happen */
function script(seed: number, length: number): [FightInput | null, FightInput | null][] {
  const r = lcg(seed);
  const style = [r.int(0, 3), r.int(0, 3)]; // 0 random · 1 crowd (step in, rarely punch) · 2 duck (slips) · 3 passive
  const rows: [FightInput | null, FightInput | null][] = [];
  for (let t = 0; t < length; t++) {
    const one = (i: 0 | 1): FightInput | null => {
      const v = r.int(0, 99);
      if (v < 78) return null;
      const st = style[i];
      const a: BoxingAction | undefined =
        st === 1
          ? v < 92
            ? "stepIn"
            : ACTIONS[r.int(0, 3)]
          : st === 2
            ? v < 93
              ? v % 2
                ? "slipL"
                : "slipR"
              : ACTIONS[r.int(0, 7)]
            : st === 3
              ? v < 97
                ? undefined
                : "jab"
              : v < 95
                ? ACTIONS[r.int(0, 7)]
                : undefined;
      return { seq: t, g: r.int(0, 1) === 1, ...(a ? { a } : {}) };
    };
    rows.push([one(0), one(1)]);
  }
  return rows;
}

/** run a script through a logged fight (as the room does) */
function fight(seed: number, rules: FightRules, swap: boolean, staked: boolean) {
  const rows = script(seed, 20_000);
  const players: [string, string] = swap ? ["b", "a"] : ["a", "b"];
  const log = newFightLog(players, rules, staked);
  let s = beginFight(createFight(players, rules, { staked }));
  log.ops.push({ o: "begin" });
  if (seed % 4 === 0) {
    // some fights start shaken + tired: knockdowns, KOs and stoppages happen
    const tired = s.fighters.map((f) => ({ ...f, composure: 200, stamina: 150 })) as [
      FighterState,
      FighterState,
    ];
    s = { ...s, fighters: tired };
  }
  while (s.phase !== "over") {
    const row = rows[s.tick]!;
    const inputs: TickInputs = swap ? [row[1], row[0]] : row;
    logStep(log, inputs);
    s = stepFight(s, inputs);
  }
  return { s, log };
}

describe("scoring — properties (10k seeded fights)", () => {
  it("valid cards, deductions once, totals = sums, decision matches the cards, DQ only after the ladder", () => {
    const rules: FightRules = {
      rounds: 2,
      roundSeconds: 30,
      restSeconds: 1,
      idleSeconds: 10,
      cautions: 1,
      warningsToDq: 3,
    };
    const sr = scoringRulesOf(rules);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 10_000; seed++) {
      const { s } = fight(seed, { ...rules, judges: seed % 2 ? 5 : 3 }, false, seed % 3 === 0);
      const o = s.outcome!;
      const j = seed % 2 ? 5 : 3;
      seen.add(o.method!);
      const errs = auditFight(s);
      if (errs.length) throw new Error(`seed ${seed}: ${errs.join(",")}`);
      for (const c of s.cards) if (!isValidCard(c, j)) throw new Error(`seed ${seed} bad card`);
      // totals = per-judge sums of (round score − deductions)
      const totals = totalsOf(s.cards, j);
      expect(o.totals).toEqual(totals);
      for (const i of [0, 1] as const) {
        const ded = s.cards.reduce((n, c) => n + c.deductions[i], 0);
        if (ded !== s.fighters[i].warnings) throw new Error(`seed ${seed} deductions ${ded}`);
      }
      // the decision type matches the votes
      const v0 = o.votes!.filter((x) => x === 0).length;
      const v1 = o.votes!.filter((x) => x === 1).length;
      const need = Math.floor(j / 2) + 1;
      if (o.method === "UD") expect([v0, v1]).toContainEqual(j);
      if (o.method === "SD") expect(Math.max(v0, v1) >= need && Math.min(v0, v1) > 0).toBe(true);
      if (o.method === "MD")
        expect(Math.max(v0, v1) >= need && Math.min(v0, v1) === 0 && Math.max(v0, v1) < j).toBe(true);
      if (o.method === "TB" || o.method === "DRAW") expect(Math.max(v0, v1)).toBeLessThan(need);
      if (o.method === "UD" || o.method === "SD" || o.method === "MD") expect(o.winner).toBe(v0 > v1 ? 0 : 1);
      if (o.method === "DQ")
        for (const i of [0, 1] as const)
          if (o.winner !== i) expect(s.fighters[i].warnings).toBeGreaterThanOrEqual(sr.warningsToDq);
      // a DQ'd fighter only ever loses; the ranks follow the outcome
      const ranks = matchResultOf(s).ranks;
      if (o.winner === null) expect(ranks).toEqual({ a: 1, b: 1 });
      else expect(ranks[["a", "b"][o.winner]!]).toBe(1);
    }
    // every way to end a fight on the engine shows up in 10k fights
    expect([...seen].sort()).toEqual(expect.arrayContaining(["DQ", "MD", "RSC", "SD", "UD"]));
  }, 300_000);

  it("determinism: replaying the fight log gives identical cards and hash", () => {
    const rules: FightRules = { ...DEFAULT_FIGHT_RULES, rounds: 2, roundSeconds: 30, restSeconds: 1 };
    for (let seed = 1; seed <= 400; seed++) {
      if (seed % 4 === 0) continue; // the shaken start is a test-only state patch, not in the log
      const { s, log } = fight(seed, rules, false, true);
      const r = replayFight(JSON.parse(JSON.stringify(log)));
      expect(hashFight(r)).toBe(hashFight(s));
      expect(r.cards).toEqual(s.cards);
      expect(auditFight(s, log)).toEqual([]);
    }
  }, 120_000);

  it("symmetry: mirrored inputs give mirrored cards, totals, votes and decision", () => {
    const rules: FightRules = { ...DEFAULT_FIGHT_RULES, rounds: 2, roundSeconds: 30, restSeconds: 1 };
    const flip = (p: [number, number]) => [p[1], p[0]];
    for (let seed = 1; seed <= 600; seed++) {
      const a = fight(seed, rules, false, seed % 2 === 0).s;
      const m = fight(seed, rules, true, seed % 2 === 0).s;
      const o = a.outcome!;
      const mo = m.outcome!;
      expect(
        m.cards.map((c) => ({
          ...c,
          judges: c.judges.map(flip),
          deductions: flip(c.deductions),
          knockdowns: flip(c.knockdowns),
        })),
      ).toEqual(a.cards);
      expect(mo.totals!.map(flip)).toEqual(o.totals);
      expect(mo.votes).toEqual(o.votes!.map((v) => (v === null ? null : 1 - v)));
      expect(mo.method).toBe(o.method);
      expect(mo.winner).toBe(o.winner === null ? null : 1 - o.winner);
      // same people, same ranks, whichever corner they had
      expect(matchResultOf(m).ranks).toEqual(matchResultOf(a).ranks);
    }
  }, 120_000);
});
