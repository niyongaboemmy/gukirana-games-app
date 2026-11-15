import { describe, expect, it } from "vitest";
import { DEFAULT_FIGHT_RULES, type BoxingAction, type FightEvent, type FightInput, type FightRules, type Punch } from "@gukirana/contracts";
import {
  auditFight,
  beginFight,
  BODY_SEP,
  BOT_PROFILES,
  boxingBotInput,
  BREAK_GAP,
  CLINCH_TICKS,
  createFight,
  fightStatsOf,
  gapOf,
  hashFight,
  isqrt,
  logStep,
  MOVE,
  newFightLog,
  PUNCH_SPECS,
  replayAny,
  replayFight,
  RING_MM,
  snapshotOf,
  START_GAP,
  stepFight,
  v1,
  windupOf,
  type FighterState,
  type FightState,
  type TickInputs,
} from "./index.js";

/**
 * Engine v2 (P3-FGT-10, docs/FIGHT-GAME-V2.md §4): free footwork, solid bodies, the ropes, the punch / defence
 * matrix, counters, feints, the clinch, determinism, and the v1 → v2 migration (v1 logs still verify).
 */
const NONE: TickInputs = [null, null];
const lcg = (seed: number) => {
  let x = seed >>> 0 || 1;
  return {
    int(min: number, max: number) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      return min + ((x >>> 8) % (max - min + 1));
    },
  };
};

function inRound(gapMm = START_GAP, rules: FightRules = DEFAULT_FIGHT_RULES): FightState {
  let s = beginFight(createFight(["a", "b"], rules));
  while (s.phase !== "round") s = stepFight(s, NONE);
  return place(s, gapMm);
}
const place = (s: FightState, gapMm: number, guards: [boolean, boolean] = [false, false]): FightState => ({
  ...s,
  fighters: s.fighters.map((f, i) => ({ ...f, x: (i === 0 ? -1 : 1) * (gapMm >> 1), z: 0, vx: 0, vz: 0, guard: guards[i]! })) as [FighterState, FighterState],
});
interface Press {
  a?: BoxingAction;
  b?: boolean;
  mv?: [number, number];
  g?: boolean;
}
/** play n ticks; `at(k)` gives each fighter's input at tick offset k (undefined = nothing new) */
function play(s0: FightState, n: number, at: (k: number) => [Press | undefined, Press | undefined] = () => [undefined, undefined]) {
  let s = s0;
  const events: FightEvent[] = [];
  const trace: FightState[] = [];
  for (let k = 0; k < n && s.phase !== "over"; k++) {
    const p = at(k);
    const inp = [0, 1].map((i) => {
      const x = p[i];
      if (!x) return null;
      return { seq: s.fighters[i]!.seq + 1, g: x.g ?? s.fighters[i]!.guard, ...(x.a ? { a: x.a } : {}), ...(x.b ? { b: true } : {}), ...(x.mv ? { mv: x.mv } : {}) };
    }) as unknown as TickInputs;
    s = stepFight(s, inp);
    events.push(...s.events);
    trace.push(s);
  }
  return { s, events, trace };
}

describe("engine v2: footwork, bodies, ropes", () => {
  it("isqrt is exact", () => {
    for (const n of [0, 1, 2, 3, 4, 15, 16, 17, 99_999_999, 4_000_000_000_000]) {
      const r = isqrt(n);
      expect(r * r <= n && (r + 1) * (r + 1) > n).toBe(true);
    }
  });

  it("walking forward closes the distance with weight (accelerates), then the bodies meet and never overlap", () => {
    const r = play(inRound(), 120, () => [{ mv: [0, 1] }, { mv: [0, 1] }]);
    const gaps = r.trace.map((s) => gapOf(s.fighters[0], s.fighters[1]));
    // not an instant full speed: the first tick moves less than the third
    expect(START_GAP - gaps[0]!).toBeLessThan(gaps[1]! - gaps[3]!);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(BODY_SEP);
    expect(gaps.slice(0, 80).at(-1)).toBeLessThanOrEqual(BODY_SEP + 5);
    // chest to chest without a punch for 3 s: the referee breaks them
    expect(r.events.some((e) => e.k === "break")).toBe(true);
  });

  it("pressure: walking into a standing boxer pushes him back to the ropes, never through him or out of the ring", () => {
    const r = play(inRound(), 400, () => [{ mv: [0, 1] }, undefined]);
    const [a, b] = r.s.fighters;
    expect(gapOf(a, b)).toBeGreaterThanOrEqual(BODY_SEP);
    expect(b.x).toBe(RING_MM.limit);
    expect(a.x).toBeLessThan(b.x);
  });

  it("the ropes are walls: backing up stops at the limit", () => {
    const r = play(inRound(), 300, () => [{ mv: [0, -1] }, undefined]);
    expect(r.s.fighters[0].x).toBe(-RING_MM.limit);
  });

  it("lateral steps circle the opponent at a constant distance (an arc, not a drift away)", () => {
    const s0 = inRound(1100);
    const r = play(s0, 45, () => [{ mv: [1, 0] }, undefined]);
    const g = gapOf(r.s.fighters[0], r.s.fighters[1]);
    expect(Math.abs(g - 1100)).toBeLessThan(25);
    expect(Math.abs(r.s.fighters[0].z)).toBeGreaterThan(500); // moved round a good way
    expect(r.s.orbit).not.toBe(s0.orbit);
  });

  it("random inputs: the bodies never overlap and nobody leaves the ropes (300 fights)", () => {
    const acts: BoxingAction[] = ["jab", "cross", "hook", "rhook", "uppercut", "slipL", "slipR", "duck", "parry", "stepIn", "stepOut", "pivotL", "pivotR", "clinch", "feint"];
    for (let seed = 1; seed <= 300; seed++) {
      const r = lcg(seed);
      let s = beginFight(createFight(["a", "b"], { ...DEFAULT_FIGHT_RULES, rounds: 1, roundSeconds: 30 }));
      while (s.phase !== "over") {
        const one = (i: number): FightInput | null =>
          r.int(0, 3) === 0 ? { seq: s.fighters[i]!.seq + 1, g: r.int(0, 1) === 1, mv: [r.int(-1, 1), r.int(-1, 1)], ...(r.int(0, 2) === 0 ? { a: acts[r.int(0, acts.length - 1)]! } : {}) } : null;
        s = stepFight(s, [one(0), one(1)]);
        if (s.phase === "round" || s.phase === "knockdown") {
          if (gapOf(s.fighters[0], s.fighters[1]) < BODY_SEP) throw new Error(`overlap seed ${seed} tick ${s.tick}`);
          for (const f of s.fighters) if (Math.abs(f.x) > RING_MM.limit || Math.abs(f.z) > RING_MM.limit) throw new Error(`out seed ${seed}`);
        }
      }
    }
  }, 120_000);

  it("cornered: pinned in a corner by a walking opponent, the two still keep apart", () => {
    let s = inRound();
    s = { ...s, fighters: [{ ...s.fighters[0], x: RING_MM.limit - 700, z: RING_MM.limit - 700 }, { ...s.fighters[1], x: RING_MM.limit, z: RING_MM.limit }] };
    const r = play(s, 200, () => [{ mv: [0, 1] }, { mv: [1, 1] }]);
    for (const t of r.trace) expect(gapOf(t.fighters[0], t.fighters[1])).toBeGreaterThanOrEqual(BODY_SEP);
  });
});

/** one exchange: fighter 0 throws `p`, fighter 1 answers with `d` timed to cover the impact */
function exchange(p: Punch, d: BoxingAction | "guard" | null, opts: { gap?: number; body?: boolean } = {}) {
  const gap = opts.gap ?? PUNCH_SPECS[p].reach - (opts.body ? 100 : 40);
  let s = place(inRound(), gap, [false, d === "guard"]);
  const wind = windupOf(s.fighters[0], p, !!opts.body);
  const w = d === "slipL" || d === "slipR" ? MOVE.slip : d === "duck" ? MOVE.duck : d === "parry" ? MOVE.parry : { from: 0 };
  const dAt = Math.max(0, wind - w.from - 1);
  const r = play(s, 30, (k) => [k === 0 ? { a: p, b: opts.body } : undefined, d && d !== "guard" && k === dAt ? { a: d } : undefined]);
  s = r.s;
  const e = r.events.find((x) => x.k === "hit" || x.k === "block" || x.k === "evade" || x.k === "whiff" || x.k === "parry");
  return { e, s, events: r.events };
}

describe("engine v2: the punch / defence matrix", () => {
  it("clean hits on an open boxer, at the punch's own range", () => {
    for (const p of ["jab", "cross", "hook", "rhook", "uppercut"] as const) expect(exchange(p, null).e).toMatchObject({ k: "hit", punch: p, combo: 1 });
  });
  it("out of range: a whiff (the puncher overreaches: longer recovery, more stamina)", () => {
    const { e } = exchange("hook", null, { gap: PUNCH_SPECS.hook.reach + 150 });
    expect(e).toMatchObject({ k: "whiff" });
  });
  it("slip beats the straights and the uppercut; a hook catches a slip (a counter)", () => {
    expect(exchange("jab", "slipL", { gap: 1100 }).e).toMatchObject({ k: "evade", how: "slip" });
    expect(exchange("cross", "slipR").e).toMatchObject({ k: "evade", how: "slip" });
    expect(exchange("uppercut", "slipL").e).toMatchObject({ k: "evade", how: "slip" });
    expect(exchange("hook", "slipL").e).toMatchObject({ k: "hit", counter: true });
  });
  it("the duck rolls under hooks and straights; an uppercut catches a duck (a counter)", () => {
    expect(exchange("hook", "duck").e).toMatchObject({ k: "evade", how: "duck" });
    expect(exchange("rhook", "duck").e).toMatchObject({ k: "evade", how: "duck" });
    expect(exchange("cross", "duck").e).toMatchObject({ k: "evade", how: "duck" });
    expect(exchange("uppercut", "duck").e).toMatchObject({ k: "hit", counter: true });
  });
  it("the parry turns a straight aside and throws the puncher off balance; it does nothing against a hook", () => {
    const r = exchange("cross", "parry");
    expect(r.e).toMatchObject({ k: "parry", punch: "cross" });
    expect(exchange("hook", "parry").e).toMatchObject({ k: "hit" });
  });
  it("the high guard blocks head punches; the uppercut splits it and body shots go under it (partial)", () => {
    expect(exchange("cross", "guard").e).toMatchObject({ k: "block" });
    expect(exchange("rhook", "guard").e).toMatchObject({ k: "block" });
    expect(exchange("uppercut", "guard").e).toMatchObject({ k: "hit", combo: 0, points: 1 });
    const body = exchange("hook", "guard", { body: true });
    expect(body.e).toMatchObject({ k: "hit", combo: 0, body: true });
  });
  it("body shots: slips don't avoid them, they drain stamina and wear the stamina ceiling", () => {
    const r = exchange("rhook", "slipL", { body: true });
    expect(r.e).toMatchObject({ k: "hit", body: true });
    expect(r.s.fighters[1].stamina).toBeLessThan(1000 - MOVE.slip.stamina - 50);
    expect(r.s.fighters[1].bodyWear).toBeGreaterThan(0);
  });
  it("straights are smothered up close (partial); inside you work hooks and uppercuts", () => {
    expect(exchange("cross", null, { gap: 680 }).e).toMatchObject({ k: "hit", combo: 0 });
    expect(exchange("hook", null, { gap: 680 }).e).toMatchObject({ k: "hit", combo: 1 });
  });
  it("slip, then counter: the punch goes at once (the rest of the slip is cut short) and scores the counter bonus", () => {
    const s = place(inRound(), 1080);
    const wind = windupOf(s.fighters[1], "cross", false);
    const dAt = wind - MOVE.slip.from - 1;
    const r = play(s, 40, (k) => [k === dAt ? { a: "slipL" } : k === wind + 1 ? { a: "cross" } : undefined, k === 0 ? { a: "cross" } : undefined]);
    const hit = r.events.find((e) => e.k === "hit");
    expect(r.events.find((e) => e.k === "evade")).toMatchObject({ by: 1 });
    expect(hit).toMatchObject({ by: 0, counter: true, points: PUNCH_SPECS.cross.points + 1 });
    void s;
  });
  it("footwork beats punches: pivoting off the line during a cross makes it miss (the aim line)", () => {
    const s = place(inRound(), 1050);
    const r = play(s, 30, (k) => [k === 1 ? { a: "pivotR" } : undefined, k === 0 ? { a: "cross" } : undefined]);
    expect(r.events.find((e) => e.k === "evade" || e.k === "hit")).toMatchObject({ k: "evade", how: "step", by: 1 });
  });
});

describe("engine v2: feints, clinch, knockdowns", () => {
  it("a feint looks exactly like a cross to everyone; biting on it gives the feinter a counter", () => {
    let s = place(inRound(), 1050);
    const r = play(s, 3, () => [{ a: "feint" }, undefined]);
    s = r.s;
    const snap = snapshotOf(s, "R1");
    expect(snap.fighters[0].act).toBe("cross");
    expect(snap.fighters[0].stage).toBe("windup");
    const bite = play(s, 20, (k) => [k === 6 ? { a: "jab" } : undefined, k === 0 ? { a: "slipL" } : undefined]);
    expect(bite.events.find((e) => e.k === "hit" && e.by === 0)).toMatchObject({ counter: true });
  });

  it("the clinch ties both up (no punches), the clincher recovers, then the referee breaks them apart", () => {
    let s = place(inRound(), 800);
    s = { ...s, fighters: [{ ...s.fighters[0], stamina: 300 }, s.fighters[1]] };
    const r = play(s, CLINCH_TICKS + 20, (k) => [k === 0 ? { a: "clinch" } : undefined, k > 5 && k < 30 ? { a: "hook" } : undefined]);
    expect(r.events.find((e) => e.k === "clinch")).toMatchObject({ by: 0 });
    const brk = r.events.findIndex((e) => e.k === "break");
    expect(brk).toBeGreaterThan(0);
    expect(r.events.slice(0, brk).some((e) => e.k === "hit")).toBe(false);
    const after = r.trace.find((t) => t.events.some((e) => e.k === "break"))!;
    expect(Math.abs(gapOf(after.fighters[0], after.fighters[1]) - BREAK_GAP)).toBeLessThan(5);
    expect(after.fighters[0].stamina).toBeGreaterThan(300 + 100);
  });

  it("three knockdowns in a round stop the fight (RSC); the count separates them and they box on (P3-FGT-10 rules)", () => {
    // (fighter life off: the downed fighter rises at 8 on its own; tests/life.test.ts covers the get-up task)
    let s = place({ ...inRound(), life: undefined }, 1000);
    let downs = 0;
    for (let n = 0; n < 6 && s.phase !== "over"; n++) {
      s = { ...s, fighters: [s.fighters[0], { ...s.fighters[1], composure: 20, stamina: 900, wear: 0 }] };
      const r = play(s, 30, (k) => [k === 0 ? { a: "jab" } : undefined, undefined]);
      s = r.s;
      if (r.events.some((e) => e.k === "knockdown")) downs++;
      while (s.phase === "knockdown") s = stepFight(s, NONE);
      if (s.phase === "round") s = place(s, 1000);
    }
    expect(downs).toBe(3);
    expect(s.outcome).toMatchObject({ method: "RSC", winner: 0 });
  });
});

describe("engine v2: determinism, the log, the v1 → v2 migration", () => {
  it("a bot fight replays from its log to the identical state; the audit passes", () => {
    const rules = { ...DEFAULT_FIGHT_RULES, rounds: 2, roundSeconds: 30, restSeconds: 2 };
    const log = newFightLog(["a", "b"], rules, true);
    expect(log.engine).toBe(2);
    let s = beginFight(createFight(["a", "b"], rules, { staked: true }));
    log.ops.push({ o: "begin" });
    const ra = lcg(5);
    const rb = lcg(6);
    while (s.phase !== "over") {
      const inp: TickInputs = [boxingBotInput(s, 0, BOT_PROFILES[4], ra), boxingBotInput(s, 1, BOT_PROFILES[3], rb)];
      logStep(log, inp);
      s = stepFight(s, inp);
    }
    const r = replayFight(JSON.parse(JSON.stringify(log)));
    expect(hashFight(r)).toBe(hashFight(s));
    expect(auditFight(s, log)).toEqual([]);
    const [a, b] = fightStatsOf(s);
    expect(a.thrown).toBeGreaterThan(20);
    expect(a.landed + b.landed).toBeGreaterThan(10);
  }, 60_000);

  it("a v1 fight log (recorded before P3-FGT-10) still replays with the frozen v1 engine and verifies", () => {
    const rules = { ...DEFAULT_FIGHT_RULES, rounds: 1, roundSeconds: 30 };
    const log: v1.FightLog = v1.newFightLog(["a", "b"], rules, false);
    expect((log as { engine?: number }).engine).toBeUndefined();
    let s = v1.beginFight(v1.createFight(["a", "b"], rules));
    log.ops.push({ o: "begin" });
    const ra = lcg(11);
    const rb = lcg(12);
    while (s.phase !== "over") {
      const inp: v1.TickInputs = [v1.boxingBotInput(s, 0, 4, ra), v1.boxingBotInput(s, 1, 2, rb)];
      v1.logStep(log, inp);
      s = v1.stepFight(s, inp);
    }
    const back = replayAny(JSON.parse(JSON.stringify(log)));
    expect(v1.hashFight(back as v1.FightState)).toBe(v1.hashFight(s));
    expect(auditFight(s, log)).toEqual([]);
    // a log claiming the other engine never verifies
    expect(auditFight(s, { ...log, engine: 2 })).toEqual(["ENGINE_MISMATCH"]);
  });
});
