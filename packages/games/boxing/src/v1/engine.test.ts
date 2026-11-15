import { describe, expect, it } from "vitest";
import {
  DEFAULT_FIGHT_RULES,
  TICK_HZ,
  type BoxingAction,
  type FightEvent,
  type FightInput,
} from "@gukirana/contracts";
import {
  beginFight,
  COUNTDOWN_TICKS,
  createFight,
  forfeitFight,
  auditFight,
  cardFor,
  hashFight,
  hasBegun,
  KNOCKDOWN_COUNT_TICKS,
  matchResultOf,
  pauseFight,
  PASSIVITY_TICKS,
  resumeFight,
  RISE_COMPOSURE,
  snapshotOf,
  stepFight,
  voidFight,
  type FighterState,
  type FightState,
  type TickInputs,
} from "./index.js";

const NONE: TickInputs = [null, null];
function run(s: FightState, inputs: (t: number) => TickInputs = () => NONE, guard = 100_000): FightState {
  while (s.phase !== "over" && guard-- > 0) s = stepFight(s, inputs(s.tick));
  return s;
}

/** a fight right after the opening bell, at `dist`, with the guards as given */
function inRound(dist = 150, guards: [boolean, boolean] = [false, false]): FightState {
  let s = beginFight(createFight(["a", "b"]));
  while (s.phase !== "round") s = stepFight(s, NONE);
  return {
    ...s,
    dist,
    fighters: s.fighters.map((f, i) => ({ ...f, guard: guards[i]! })) as [FighterState, FighterState],
  };
}

type Script = Record<number, [BoxingAction | null, BoxingAction | null]>;
/** play `n` ticks; script keys are tick offsets from now; guards held as given */
function play(s0: FightState, n: number, script: Script, guards?: [boolean, boolean]) {
  let s = s0;
  const events: FightEvent[] = [];
  for (let k = 0; k < n && s.phase !== "over"; k++) {
    const row = script[k];
    const inp = [0, 1].map((i) => {
      const a = row?.[i];
      const g = guards ? guards[i]! : s.fighters[i]!.guard;
      if (!a && !guards) return null;
      return { seq: s.fighters[i]!.seq + 1, g, ...(a ? { a } : {}) } satisfies FightInput;
    }) as unknown as TickInputs;
    s = stepFight(s, inp);
    events.push(...s.events);
  }
  return { s, events };
}
const kinds = (ev: FightEvent[]) => ev.map((e) => e.k).filter((k) => k !== "count");

describe("boxing engine — clock and decision", () => {
  it("runs the rounds and rests on the fixed tick, then decides (mirror-image whiffs → level cards → draw)", () => {
    const r = DEFAULT_FIGHT_RULES;
    // both throw a jab from out of reach every 10 s: active (no PASSIVITY), identical → every card 10-10
    const jabs = (t: number): TickInputs =>
      t % 300 === 0
        ? [
            { seq: t, a: "jab", g: true },
            { seq: t, a: "jab", g: true },
          ]
        : NONE;
    const end = run(beginFight(createFight(["a", "b"], r)), jabs);
    expect(end.phase).toBe("over");
    expect(end.tick).toBe(
      COUNTDOWN_TICKS + r.rounds * r.roundSeconds * TICK_HZ + (r.rounds - 1) * r.restSeconds * TICK_HZ,
    );
    expect(end.rounds).toHaveLength(r.rounds);
    expect(end.cards).toHaveLength(r.rounds);
    expect(end.cards.every((c) => c.judges.every(([x, y]) => x === 10 && y === 10))).toBe(true);
    expect(end.outcome).toMatchObject({ decision: "draw", method: "DRAW", winner: null });
    expect(matchResultOf(end).ranks).toEqual({ a: 1, b: 1 });
    expect(auditFight(end)).toEqual([]);
  });

  it("nobody throws a punch: passivity up the ladder → both disqualified at the 3rd warning (no winner)", () => {
    const end = run(beginFight(createFight(["a", "b"])));
    // caution at 15 s, warnings at 30 / 45 s, the 3rd warning (DQ) at 60 s
    expect(end.tick).toBe(COUNTDOWN_TICKS + 4 * PASSIVITY_TICKS);
    expect(end.outcome).toMatchObject({
      decision: "dq",
      method: "DQ",
      winner: null,
      warnings: [3, 3],
      cautions: [1, 1],
    });
    expect(end.outcome!.dqFoul).toBeUndefined();
    expect(matchResultOf(end).ranks).toEqual({ a: 1, b: 1 });
    expect(auditFight(end)).toEqual([]);
  });

  it("the decision follows the judges' cards (10-point must), not the raw points", () => {
    // red lands 3 clean jabs in round 1; blue lands one cross: red wins the round 10-9 on every card
    const s = play(inRound(150), 120, {
      0: ["jab", null],
      20: ["jab", null],
      40: ["jab", null],
      60: [null, "cross"],
    }).s;
    const card = cardFor(1, s.tally, 5);
    expect(card.judges).toEqual(Array.from({ length: 5 }, () => [10, 9]));
    const atBell = stepFight({ ...s, rules: { ...s.rules, rounds: 1 }, left: 1 }, NONE);
    expect(atBell.outcome).toMatchObject({
      decision: "points",
      method: "UD",
      winner: 0,
      votes: [0, 0, 0, 0, 0],
    });
    expect(atBell.outcome!.totals).toEqual(Array.from({ length: 5 }, () => [10, 9]));
    expect(auditFight(atBell)).toEqual([]);
  });

  it("forfeit and void", () => {
    const s = forfeitFight(beginFight(createFight(["a", "b"])), 0);
    expect(s.outcome).toMatchObject({ decision: "forfeit", winner: 1 });
    expect(matchResultOf(s)).toMatchObject({ ranks: { a: 2, b: 1 }, reason: "forfeit" });
    expect(voidFight(inRound()).outcome).toMatchObject({ decision: "void", winner: null });
  });

  it("hasBegun only after the bell and an input", () => {
    let s = beginFight(createFight(["a", "b"]));
    s = stepFight(s, [{ seq: 0, g: true }, null]);
    expect(hasBegun(s)).toBe(false);
    s = inRound();
    expect(hasBegun(s)).toBe(false);
    s = stepFight(s, [null, { seq: 5, g: false }]);
    expect(hasBegun(s)).toBe(true);
  });
});

describe("boxing engine — defence matrix (§2.3)", () => {
  it("jab: clean hit when open, blocked by the guard, evaded by a timed slip", () => {
    const hit = play(inRound(150), 20, { 0: ["jab", null] });
    expect(hit.events.find((e) => e.k === "hit")).toMatchObject({ by: 0, punch: "jab", points: 1 });
    expect(hit.s.fighters[0].points).toBe(1);

    const blocked = play(inRound(150, [false, true]), 20, { 0: ["jab", null] });
    expect(kinds(blocked.events)).toContain("block");
    expect(blocked.s.fighters[0].points).toBe(0);

    const slipped = play(inRound(150), 20, { 0: ["jab", null], 2: [null, "slipL"] });
    expect(kinds(slipped.events)).toContain("evade");
    expect(slipped.s.fighters[0].points).toBe(0);
  });

  it("cross: blocked by the guard, evaded by a slip", () => {
    expect(kinds(play(inRound(150, [false, true]), 25, { 0: ["cross", null] }).events)).toContain("block");
    expect(kinds(play(inRound(150), 25, { 0: ["cross", null], 4: [null, "slipR"] }).events)).toContain(
      "evade",
    );
  });

  it("hook: blocked by the guard, catches a slip, evaded by stepping out", () => {
    expect(kinds(play(inRound(120, [false, true]), 30, { 0: ["hook", null] }).events)).toContain("block");
    const slip = play(inRound(120), 30, { 0: ["hook", null], 6: [null, "slipL"] });
    expect(slip.events.find((e) => e.k === "hit")).toMatchObject({ punch: "hook", points: 3 });
    const out = play(inRound(120), 30, { 0: ["hook", null], 2: [null, "stepOut"] });
    expect(kinds(out.events)).not.toContain("hit");
    expect(kinds(out.events).some((k) => k === "whiff" || k === "evade")).toBe(true);
  });

  it("uppercut: partly through the guard (1 pt, half composure), evaded by a slip", () => {
    const g = play(inRound(100, [false, true]), 30, { 0: ["uppercut", null] });
    expect(g.events.find((e) => e.k === "hit")).toMatchObject({ punch: "uppercut", points: 1 });
    expect(kinds(play(inRound(100), 30, { 0: ["uppercut", null], 6: [null, "slipR"] }).events)).toContain(
      "evade",
    );
  });

  it("out of reach is a whiff that costs extra stamina", () => {
    const r = play(inRound(300), 25, { 0: ["jab", null] });
    expect(kinds(r.events)).toContain("whiff");
  });

  it("a clean hit interrupts the target's windup", () => {
    // blue starts a slow uppercut, red's jab lands first
    const r = play(inRound(100), 30, { 0: [null, "uppercut"], 1: ["jab", null] });
    expect(r.events.filter((e) => e.k === "hit")).toHaveLength(1);
    expect(r.s.fighters[1].points).toBe(0);
  });

  it("counter after an evade scores +1; combos from the 3rd hit score +1", () => {
    const c = play(inRound(150), 40, { 0: [null, "jab"], 2: ["slipL", null], 12: ["jab", null] });
    expect(c.events.find((e) => e.k === "hit" && e.by === 0)).toMatchObject({ counter: true, points: 2 });

    // three jabs in a row on an open target (each within the combo window)
    const combo = play(inRound(150), 60, { 0: ["jab", null], 14: ["jab", null], 28: ["jab", null] });
    const hits = combo.events.filter((e) => e.k === "hit");
    expect(hits.map((h) => (h.k === "hit" ? h.combo : 0))).toEqual([1, 2, 3]);
    expect(combo.s.fighters[0].points).toBe(1 + 1 + 2);
  });

  it("presses during an action are buffered, and an exhausted fighter can't throw power punches", () => {
    const r = play(inRound(150), 40, { 0: ["jab", null], 10: ["jab", null] });
    expect(r.events.filter((e) => e.k === "hit")).toHaveLength(2);
    const tired = inRound(100);
    tired.fighters[0] = { ...tired.fighters[0], stamina: 50 };
    const t = play(tired, 5, { 0: ["hook", null] });
    expect(t.s.fighters[0].act).toBe("idle");
  });
});

describe("boxing engine — knockdown, stoppage, fouls, pauses", () => {
  const low = (s: FightState, who: 0 | 1, composure = 30): FightState => {
    const fighters = [...s.fighters] as [FighterState, FighterState];
    fighters[who] = { ...fighters[who], composure };
    return { ...s, fighters };
  };

  it("composure 0 → knockdown: +5, count 1..8 with the clock stopped, rise with 600", () => {
    let s0 = low(inRound(150), 1);
    const evs: FightEvent[] = [];
    s0 = stepFight(s0, [{ seq: 1, a: "jab", g: false }, null]);
    while (s0.phase === "round") {
      s0 = stepFight(s0, NONE);
      evs.push(...s0.events);
    }
    const r = { s: s0, events: evs };
    expect(r.s.phase).toBe("knockdown");
    expect(r.events.find((e) => e.k === "knockdown")).toMatchObject({ to: 1, points: 5 });
    expect(r.s.fighters[0].points).toBe(1 + 5);
    const held = r.s.held;
    const counted = play(r.s, KNOCKDOWN_COUNT_TICKS + 1, {});
    const counts = counted.events.filter((e) => e.k === "count").map((e) => (e.k === "count" ? e.n : 0));
    expect(counts).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(counted.events.find((e) => e.k === "up")).toMatchObject({ to: 1 });
    expect(counted.s.phase).toBe("round");
    expect(counted.s.left).toBe(held - 1);
    expect(counted.s.fighters[1].composure).toBeGreaterThanOrEqual(RISE_COMPOSURE);
    expect(snapshotOf(r.s, "R1").count).toBe(1);
  });

  it("3 knockdowns in one round → stoppage", () => {
    let s = inRound(150);
    for (let k = 0; k < 3; k++) {
      s = low({ ...s, dist: 150 }, 1);
      s = play(s, 20, { 0: ["jab", null] }).s;
      if (s.phase === "over") break;
      expect(s.phase).toBe("knockdown");
      s = play(s, KNOCKDOWN_COUNT_TICKS + MOVE_RISE, {}).s;
    }
    expect(s.phase).toBe("over");
    expect(s.outcome).toMatchObject({ decision: "stoppage", winner: 0 });
    expect(s.fighters[0].act).toBe("celebrate");
  });

  it("passivity: a caution after 15 s without a punch, then a warning (−1 on every card)", () => {
    let s = inRound();
    s.fighters[0] = { ...s.fighters[0], points: 3 };
    const ev: FightEvent[] = [];
    for (let k = 0; k < PASSIVITY_TICKS * 2; k++) {
      // red keeps moving the guard (not idle) but never punches; blue jabs (not passive)
      const red: FightInput = { seq: s.fighters[0].seq + 1, g: k % 2 === 0 };
      const blue: FightInput | null = k % 60 === 0 ? { seq: s.fighters[1].seq + 1, a: "jab", g: true } : null;
      s = stepFight(s, [red, blue]);
      ev.push(...s.events);
    }
    const w = ev.filter((e) => e.k === "warning" && e.to === 0);
    expect(w).toHaveLength(2);
    expect(w.map((e) => (e.k === "warning" ? e.penalty : -1))).toEqual([0, 1]);
    expect(w.map((e) => (e.k === "warning" ? e.level : null))).toEqual(["caution", "warning"]);
    expect(s.fighters[0]).toMatchObject({ cautions: 1, warnings: 1, deductions: 1, points: 2 });
    expect(s.tally[1].ded + s.tally[0].ded).toBe(1);
  });

  it("idle: an IDLE strike after idleSeconds without any input", () => {
    const r = play(inRound(), DEFAULT_FIGHT_RULES.idleSeconds * TICK_HZ, {});
    expect(r.events.filter((e) => e.k === "warning" && e.foul === "IDLE")).toHaveLength(2);
    expect(r.s.fighters[0].idleStrikes).toBe(1);
  });

  it("pause stops the clock; resume counts 3 s down then continues where it stopped", () => {
    const s = play(inRound(), 30, {}).s;
    const p = pauseFight(s, "DISCONNECT", 1);
    expect(p.phase).toBe("paused");
    expect(p.fighters[1].connected).toBe(false);
    expect(stepFight(p, NONE).left).toBe(s.left);
    const back = resumeFight(p);
    expect(back.phase).toBe("countdown");
    const after = play(back, COUNTDOWN_TICKS, {}).s;
    expect(after.phase).toBe("round");
    expect(after.left).toBe(s.left);
  });
});

const MOVE_RISE = 16;

/* ------------------------------------------------------------ property tests ------------------------------------------------------------ */

/** seeded test rng (tests only; practice uses @gukirana/fairness) */
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

/** random inputs, independent of the state (so the same script can be replayed mirrored) */
function script(seed: number, length: number): [FightInput | null, FightInput | null][] {
  const r = lcg(seed);
  const rows: [FightInput | null, FightInput | null][] = [];
  for (let t = 0; t < length; t++) {
    const one = (): FightInput | null => {
      const v = r.int(0, 99);
      if (v < 80) return null;
      return v < 95
        ? { seq: t, a: ACTIONS[r.int(0, ACTIONS.length - 1)]!, g: r.int(0, 1) === 1 }
        : { seq: t, g: r.int(0, 1) === 1 };
    };
    rows.push([one(), one()]);
  }
  return rows;
}

describe("boxing engine — properties", () => {
  it("10k seeded random fights terminate within the tick bound, meters and points stay in range", () => {
    // short rules (the tick logic is the same per tick; 2 rounds exercise the rest and the decision)
    const rules = { rounds: 2, roundSeconds: 8, restSeconds: 1, idleSeconds: 3 };
    const bound = COUNTDOWN_TICKS + 2 * 8 * TICK_HZ + TICK_HZ + 2 * 3 * KNOCKDOWN_COUNT_TICKS + 2;
    let over = 0;
    for (let seed = 1; seed <= 10_000; seed++) {
      const r = lcg(seed);
      const one = (seq: number): FightInput | null => {
        const v = r.int(0, 99);
        if (v < 75) return null;
        return v < 95
          ? { seq, a: ACTIONS[r.int(0, 7)]!, g: r.int(0, 1) === 1 }
          : { seq, g: r.int(0, 1) === 1 };
      };
      let s = beginFight(createFight(["a", "b"], rules));
      // start some fights tired / shaken so knockdowns and stoppages happen
      if (seed % 3 === 0)
        s = {
          ...s,
          fighters: s.fighters.map((f) => ({ ...f, composure: 150, stamina: 120 })) as [
            FighterState,
            FighterState,
          ],
        };
      while (s.phase !== "over") {
        if (s.tick >= bound) throw new Error(`no end seed ${seed}`);
        s = stepFight(s, [one(s.tick), one(s.tick)]);
        for (const f of s.fighters)
          if (f.stamina < 0 || f.stamina > 1000 || f.composure < 0 || f.composure > 1000 || f.points < 0)
            throw new Error(`out of range seed ${seed} tick ${s.tick}`);
      }
      over++;
    }
    expect(over).toBe(10_000);
  }, 120_000);

  it("is deterministic and mirror-symmetric (swapped inputs → swapped result)", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rows = script(seed, 8_000);
      const go = (swap: boolean) => {
        let s = beginFight(createFight(["a", "b"]));
        while (s.phase !== "over") {
          const row = rows[s.tick]!;
          s = stepFight(s, swap ? [row[1], row[0]] : row);
        }
        return s;
      };
      const a = go(false);
      expect(hashFight(go(false))).toBe(hashFight(a));
      const m = go(true);
      const o = a.outcome!;
      const mo = m.outcome!;
      expect(mo.decision).toBe(o.decision);
      expect(mo.winner).toBe(o.winner === null ? null : 1 - o.winner);
      expect(mo.points).toEqual([o.points[1], o.points[0]]);
      expect(mo.knockdowns).toEqual([o.knockdowns[1], o.knockdowns[0]]);
      expect(m.tick).toBe(a.tick);
    }
  }, 120_000);
});
