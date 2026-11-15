import { describe, expect, it } from "vitest";
import { DEFAULT_FIGHT_RULES, type BoxingAction, type FightEvent, type FightInput, type FightRules } from "@gukirana/contracts";
import {
  auditFight,
  beginFight,
  BOT_PROFILES,
  boxingBotInput,
  createFight,
  hashFight,
  KNOCKDOWN_COUNT_TICKS,
  KO_COUNT_TICKS,
  LIFE,
  logStep,
  newFightLog,
  PUNCH_SPECS,
  replayFight,
  riseGap,
  riseNeed,
  snapshotOf,
  START_GAP,
  stepFight,
  ticks,
  type FighterState,
  type FightState,
  type TickInputs,
} from "./index.js";

/** Fighter life and recovery (P3-FGT-13, docs/FIGHT-REALISM-V3.md §5): the rules, one by one, with their numbers. */

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

function inRound(rules: FightRules = DEFAULT_FIGHT_RULES, life: 0 | 1 = 1): FightState {
  let s = beginFight(createFight(["a", "b"], rules, { life }));
  while (s.phase !== "round") s = stepFight(s, NONE);
  return s;
}
const place = (s: FightState, gapMm: number, guards: [boolean, boolean] = [false, false]): FightState => ({
  ...s,
  fighters: s.fighters.map((f, i) => ({ ...f, x: (i === 0 ? -1 : 1) * (gapMm >> 1), z: 0, vx: 0, vz: 0, guard: guards[i]! })) as [FighterState, FighterState],
});
const set = (s: FightState, i: 0 | 1, f: Partial<FighterState>): FightState => ({
  ...s,
  fighters: s.fighters.map((x, k) => (k === i ? { ...x, ...f } : x)) as [FighterState, FighterState],
});

type Press = { a?: BoxingAction; g?: boolean } | undefined;
/** play n ticks; presses by tick offset; every input carries a fresh seq */
function play(s0: FightState, n: number, at: (k: number, s: FightState) => [Press, Press] = () => [undefined, undefined]) {
  let s = s0;
  const events: FightEvent[] = [];
  for (let k = 0; k < n && s.phase !== "over"; k++) {
    const p = at(k, s);
    const inp = [0, 1].map((i) => {
      const x = p[i];
      if (!x) return null;
      const f = s.fighters[i]!;
      return { seq: f.seq + 1, g: x.g ?? f.guard, ...(x.a ? { a: x.a } : {}) } satisfies FightInput;
    }) as unknown as TickInputs;
    s = stepFight(s, inp);
    events.push(...s.events);
  }
  return { s, events };
}

describe("fighter life: old fights replay unchanged", () => {
  it("a log recorded before P3-FGT-13 (no life flag) replays with the P3-FGT-10 rules and the same canonical state", () => {
    const rules = { ...DEFAULT_FIGHT_RULES, rounds: 1, roundSeconds: 30, restSeconds: 2 };
    const log = { ...newFightLog(["a", "b"], rules, false) };
    delete (log as { life?: 1 }).life;
    let s = beginFight(createFight(["a", "b"], rules, { life: 0 }));
    log.ops.push({ o: "begin" });
    const ra = lcg(3);
    const rb = lcg(4);
    while (s.phase !== "over") {
      const inp: TickInputs = [boxingBotInput(s, 0, BOT_PROFILES[3], ra), boxingBotInput(s, 1, BOT_PROFILES[2], rb)];
      logStep(log, inp);
      s = stepFight(s, inp);
    }
    const r = replayFight(JSON.parse(JSON.stringify(log)));
    expect(hashFight(r)).toBe(hashFight(s));
    expect(hashFight(r)).not.toContain("struckAt");
    expect(r.life).toBeUndefined();
    expect(auditFight(s, log)).toEqual([]);
  }, 60_000);

  it("new logs carry the flag and replay with fighter life on", () => {
    const rules = { ...DEFAULT_FIGHT_RULES, rounds: 2, roundSeconds: 30, restSeconds: 3 };
    const log = newFightLog(["a", "b"], rules, true);
    expect(log.life).toBe(1);
    let s = beginFight(createFight(["a", "b"], rules, { staked: true }));
    expect(s.life).toBe(1);
    log.ops.push({ o: "begin" });
    const ra = lcg(8);
    const rb = lcg(9);
    while (s.phase !== "over") {
      const inp: TickInputs = [boxingBotInput(s, 0, BOT_PROFILES[5], ra), boxingBotInput(s, 1, BOT_PROFILES[1], rb)];
      logStep(log, inp);
      s = stepFight(s, inp);
    }
    expect(hashFight(replayFight(JSON.parse(JSON.stringify(log))))).toBe(hashFight(s));
    expect(auditFight(s, log)).toEqual([]);
  }, 60_000);
});

describe("fighter life: recovery", () => {
  it("defence gives balance back: a blocked jab +6, a slipped straight +14 balance and +6 stamina", () => {
    let s = place(inRound(), 1000, [false, true]);
    s = set(s, 1, { composure: 500, stamina: 500 });
    const blocked = play(s, 12, (k) => [k === 0 ? { a: "jab" } : undefined, undefined]);
    expect(blocked.events.some((e) => e.k === "block")).toBe(true);
    // (+6 for the block, −10 stamina for taking it on the gloves; the regular regen meanwhile)
    const noLife = play({ ...s, life: undefined }, 12, (k) => [k === 0 ? { a: "jab" } : undefined, undefined]);
    expect(blocked.s.fighters[1].composure - noLife.s.fighters[1].composure).toBe(LIFE.defend.block);

    let e = place(inRound(), 1000);
    e = set(e, 1, { composure: 500, stamina: 500 });
    const slip = play(e, 14, (k) => [k === 0 ? { a: "cross" } : undefined, k === 4 ? { a: "slipL" } : undefined]);
    const noLifeSlip = play({ ...e, life: undefined }, 14, (k) => [k === 0 ? { a: "cross" } : undefined, k === 4 ? { a: "slipL" } : undefined]);
    expect(slip.events.some((x) => x.k === "evade")).toBe(true);
    expect(slip.s.fighters[1].composure - noLifeSlip.s.fighters[1].composure).toBe(LIFE.defend.evade);
    expect(slip.s.fighters[1].stamina - noLifeSlip.s.fighters[1].stamina).toBe(LIFE.defend.evadeStamina);
  });

  it("breathing on the move: out of range and off the ropes, stamina and balance come back faster; on the ropes they do not", () => {
    const far = PUNCH_SPECS.jab.reach + LIFE.breathe.margin + 300;
    let s = place(inRound(), far);
    s = set(set(s, 0, { stamina: 300, composure: 400 }), 1, { stamina: 300, composure: 400 });
    const walk = (k: number, st: FightState): [Press, Press] => [k % 10 === 0 ? { g: st.fighters[0].guard } : undefined, undefined];
    const withLife = play(s, 60, walk).s;
    const without = play({ ...s, life: undefined }, 60, walk).s;
    expect(withLife.fighters[0].stamina - without.fighters[0].stamina).toBe(60 * LIFE.breathe.stamina);
    expect(withLife.fighters[0].composure).toBeGreaterThan(without.fighters[0].composure + 20);
    // pinned on the ropes: no breather
    const ropes = set(s, 0, { x: -1790, z: 0 });
    const pinned = play(ropes, 60, walk).s;
    const pinnedOff = play({ ...ropes, life: undefined }, 60, walk).s;
    expect(pinned.fighters[0].stamina).toBe(pinnedOff.fighters[0].stamina);
  });

  it("the corner gives back 60 % of the missing stamina and 75 % of the missing balance over the rest, and treats a little damage", () => {
    const rules = { ...DEFAULT_FIGHT_RULES, rounds: 2, roundSeconds: 30, restSeconds: 15 };
    let s = place(inRound(rules), START_GAP);
    s = { ...s, left: 1 };
    s = set(s, 0, { stamina: 200, composure: 300, wear: 200, bodyWear: 100 });
    s = stepFight(s, NONE);
    expect(s.phase).toBe("rest");
    const f0 = s.fighters[0];
    expect(f0.wear).toBe(200 - LIFE.corner.headHeal);
    expect(f0.bodyWear).toBe(100 - LIFE.corner.bodyHeal);
    const [s0, c0] = f0.cornerWork!;
    while (s.phase === "rest") s = stepFight(s, NONE);
    const f = s.fighters[0];
    // ceilings after treatment: stamina 1000 − 70/2 = 965, balance 1000 − 160/2 = 920 (from the values at the bell)
    expect(f.stamina).toBe(s0 + Math.trunc(((965 - s0) * LIFE.corner.staminaPct) / 100));
    expect(f.composure).toBe(c0 + Math.trunc(((920 - c0) * LIFE.corner.composurePct) / 100));
    // the P3-FGT-10 corner filled everything
    let o = { ...place(inRound(rules, 0), START_GAP), left: 1 };
    o = set(o, 0, { stamina: 200, composure: 300 });
    o = stepFight(o, NONE);
    while (o.phase === "rest") o = stepFight(o, NONE);
    expect(o.fighters[0].stamina).toBe(1000);
  });
});

describe("fighter life: the count and getting up", () => {
  /** knock fighter 1 down with a jab and return the state at the start of the count */
  function knockdown(f1: Partial<FighterState> = {}): FightState {
    let s = place(inRound(), 1000);
    s = set(s, 1, { composure: 20, stamina: 900, wear: 0, ...f1 });
    const r = play(s, 12, (k) => [k === 0 ? { a: "jab" } : undefined, undefined]);
    expect(r.s.phase).toBe("knockdown");
    return r.s;
  }

  it("the task: 4 steady presses on a first knockdown, more with head damage, earlier knockdowns and exhaustion", () => {
    expect(riseNeed({ knockdowns: 1, wear: 0, stamina: 900 })).toBe(4);
    expect(riseNeed({ knockdowns: 2, wear: 0, stamina: 900 })).toBe(7);
    expect(riseNeed({ knockdowns: 1, wear: 660, stamina: 900 })).toBe(8);
    expect(riseNeed({ knockdowns: 1, wear: 0, stamina: 50 })).toBe(7);
    expect(riseGap({ stamina: 900 })).toBe(LIFE.rise.gap);
    expect(riseGap({ stamina: 200 })).toBe(LIFE.rise.gap + LIFE.rise.tiredGap);
    const s = knockdown();
    expect(s.fighters[1].rise).toMatchObject({ got: 0, need: 4 });
    expect(snapshotOf(s, "R1").fighters[1].rise).toEqual({ got: 0, need: 4 });
    expect(snapshotOf(s, "R1").counted).toEqual({ to: 1, standing: false });
  });

  it("steady presses → up at the mandatory 8 with a composed bonus; the round goes on", () => {
    let s = knockdown();
    const r = play(s, KO_COUNT_TICKS + 5, (k) => [undefined, k >= LIFE.rise.from && k % 10 === 0 ? { a: "jab" } : undefined]);
    s = r.s;
    expect(r.events.filter((e) => e.k === "rise" && e.ok).length).toBe(4);
    const up = r.events.find((e) => e.k === "up");
    expect(up).toBeDefined();
    expect(s.phase).toBe("round");
    expect(r.events.filter((e) => e.k === "count").at(-1)).toMatchObject({ n: 8 });
    expect(s.fighters[1].composure).toBeGreaterThanOrEqual(650);
  });

  it("no presses → counted out at 10 (KO); panic presses (too fast) cost progress and also end in a KO", () => {
    const quiet = play(knockdown(), KO_COUNT_TICKS + 5);
    expect(quiet.s.outcome).toMatchObject({ decision: "stoppage", method: "KO", winner: 0 });
    expect(quiet.events.filter((e) => e.k === "count").at(-1)).toMatchObject({ n: 10 });
    const mash = play(knockdown(), KO_COUNT_TICKS + 5, (k) => [undefined, k >= LIFE.rise.from ? { a: "jab" } : undefined]);
    expect(mash.events.some((e) => e.k === "rise" && !e.ok)).toBe(true);
    expect(mash.s.outcome).toMatchObject({ method: "KO", winner: 0 });
  });

  it("a slow get-up after 8 still counts if it is done before 10", () => {
    const s = knockdown({ wear: 700 });
    const need = s.fighters[1].rise!.need;
    expect(need).toBe(8);
    // one press every 16 ticks from tick 150: done at ~262 (count 9)
    const r = play(s, KO_COUNT_TICKS + 5, (k) => [undefined, k >= 150 && (k - 150) % 16 === 0 ? { a: "jab" } : undefined]);
    const up = r.events.find((e) => e.k === "up")!;
    expect(up).toBeDefined();
    expect(up.t - s.tick).toBeGreaterThan(KNOCKDOWN_COUNT_TICKS);
    expect(r.s.phase).toBe("round");
  });

  it("too much head damage: the referee will not let the fighter continue (counted out, presses ignored)", () => {
    const s = knockdown({ wear: 900 });
    expect(s.ko).toBe(1);
    expect(s.fighters[1].rise).toBeNull();
    const r = play(s, KO_COUNT_TICKS + 5, (k) => [undefined, k % 10 === 0 ? { a: "jab" } : undefined]);
    expect(r.s.outcome).toMatchObject({ method: "KO", winner: 0 });
  });

  it("the standing count: four clean punches in a row with the balance low → a standing 8 (a knockdown on the cards), then a breather", () => {
    let s = place(inRound(), 1000);
    s = set(s, 1, { composure: 320, stamina: 900 });
    // four jabs with fighter 1 not answering (balance 320 − 4 × 45 ≈ 140 after the fourth)
    const r = play(s, 70, (k) => [k % 14 === 0 ? { a: "jab" } : undefined, undefined]);
    const kd = r.events.find((e) => e.k === "knockdown");
    expect(kd).toMatchObject({ to: 1, standing: true, points: LIFE.standing.points });
    expect(r.s.phase).toBe("knockdown");
    expect(r.s.counted).toEqual({ to: 1, standing: true });
    expect(r.s.fighters[1].act).not.toBe("down");
    const after = play(r.s, KNOCKDOWN_COUNT_TICKS + 2);
    expect(after.s.phase).toBe("round");
    expect(after.s.fighters[1].composure).toBeGreaterThanOrEqual(LIFE.standing.to);
    expect(after.s.fighters[1].knockdowns).toBe(1);
  });

  it("second wind: once a round, late, after defending well and not being hit clean", () => {
    let s = place(inRound(), START_GAP);
    s = { ...s, left: LIFE.secondWind.left - 1, tally: [{ ...s.tally[0], defended: 11 }, s.tally[1]] };
    s = set(s, 0, { stamina: 300, composure: 600 });
    const r = play(s, 3);
    expect(r.events.filter((e) => e.k === "secondWind")).toEqual([expect.objectContaining({ to: 0 })]);
    expect(r.s.fighters[0].stamina).toBeGreaterThanOrEqual(300 + LIFE.secondWind.stamina);
    expect(r.s.fighters[0].wind2).toBe(true);
    // not twice in a round
    const again = play(set(r.s, 0, { stamina: 200 }), 30);
    expect(again.events.some((e) => e.k === "secondWind")).toBe(false);
    // not without the defence
    const lazy = play({ ...s, tally: [{ ...s.tally[0], defended: 2 }, s.tally[1]] }, 3);
    expect(lazy.events.some((e) => e.k === "secondWind")).toBe(false);
    // not when out-landed in the round
    const beaten = play({ ...s, tally: [s.tally[0] && { ...s.tally[0], defended: 11, landed: 2 }, { ...s.tally[1], landed: 6 }] }, 3);
    expect(beaten.events.some((e) => e.k === "secondWind")).toBe(false);
  });
});

describe("fighter life: competition (simulations)", () => {
  const RULES: FightRules = { ...DEFAULT_FIGHT_RULES, rounds: 3, roundSeconds: 60, restSeconds: 15, idleSeconds: 20 };
  function duel(a: (typeof BOT_PROFILES)[1], b: (typeof BOT_PROFILES)[1], seed: number) {
    const ra = lcg(seed * 2 + 1);
    const rb = lcg(seed * 2 + 2);
    let s = beginFight(createFight(["a", "b"], RULES));
    let n = 0;
    while (s.phase !== "over") {
      s = stepFight(s, [boxingBotInput(s, 0, a, ra), boxingBotInput(s, 1, b, rb)]);
      n++;
    }
    return { s, n };
  }

  it("fights always end in time, KOs and stoppages stay possible, and the better boxer still wins", () => {
    let kos = 0;
    let stops = 0;
    let wins = 0;
    let maxTicks = 0;
    const N = 24;
    for (let k = 0; k < N; k++) {
      const swap = k % 2 === 1;
      const { s, n } = swap ? duel(BOT_PROFILES[1], BOT_PROFILES[5], 300 + k) : duel(BOT_PROFILES[5], BOT_PROFILES[1], 300 + k);
      maxTicks = Math.max(maxTicks, n);
      if (s.outcome!.method === "KO") kos++;
      if (s.outcome!.decision === "stoppage") stops++;
      if (s.outcome!.winner === (swap ? 1 : 0)) wins++;
    }
    console.log(`L5 vs L1 (fighter life): ${wins}/${N} wins, ${stops} stoppages (${kos} KO), longest ${Math.round(maxTicks / 30)} s`);
    expect(wins).toBe(N);
    expect(stops).toBeGreaterThan(0);
    expect(maxTicks).toBeLessThan(ticks(3 * 60 + 2 * 15) + 8 * KO_COUNT_TICKS);
  }, 300_000);

  it("a fighter who panics on the canvas is counted out: KOs stay possible in bot fights", () => {
    let kos = 0;
    for (let k = 0; k < 16; k++) {
      const { s } = duel(BOT_PROFILES[5], { ...BOT_PROFILES[1], steady: 5 }, 500 + k);
      if (s.outcome!.method === "KO") kos++;
    }
    console.log(`L5 vs a panicky L1 (steady 5): ${kos}/16 KO`);
    expect(kos).toBeGreaterThan(0);
  }, 300_000);
  // (symmetry with fighter life on: scoring.test.ts "mirrored inputs give mirrored cards" runs 10k seeded fights with
  // the default rules, which now include fighter life; the bots themselves are not mirror-symmetric agents)
});
