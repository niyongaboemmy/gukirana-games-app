import { describe, expect, it } from "vitest";
import { useFightBridge } from "../bridge";
import { DEFAULT_FIGHT_RULES } from "@gukirana/contracts";
import { createFight, PUNCH_SPECS } from "@gukirana/boxing";
import { ASSIST_HOLD, assistStep, GLOVE_UP_TICKS, PracticeSession } from "./practice";
import { DRILL_SECONDS, drillDone } from "./Tutorial";

const lcg = (seed: number) => {
  let x = seed >>> 0 || 1;
  return {
    int(min: number, max: number) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      return min + ((x >>> 8) % (max - min + 1));
    },
  };
};

describe("boxing practice session", () => {
  it("writes the bridge, predicts my press, and plays a full fight against the AI", () => {
    const scores: number[] = [];
    const s = new PracticeSession({
      ring: "R7",
      level: 2,
      rng: lcg(3),
      name: "Aline",
      rules: { rounds: 2, roundSeconds: 30, restSeconds: 10, idleSeconds: 20 },
      onRoundEnd: (round) => scores.push(round),
    });
    expect(useFightBridge.getState().mine).toMatchObject({ ring: "R7", mode: "practice", corner: "red", level: 2 });
    for (let i = 0; i < GLOVE_UP_TICKS + 100; i++) s.tick();
    expect(s.state.phase).toBe("round");

    s.pressAction("jab", 1);
    expect(useFightBridge.getState().mine?.predicted).toMatchObject({ act: "jab" });
    s.tick();
    expect(s.state.fighters[0].act).toBe("jab");
    expect(useFightBridge.getState().mine?.begun).toBe(true);

    let guard = 0;
    while (!s.over && guard++ < 20_000) {
      if (guard % 20 === 0) s.pressAction("jab");
      if (guard % 33 === 0) s.pressAction("stepIn");
      s.tick();
    }
    expect(s.over).toBe(true);
    expect(useFightBridge.getState().mine?.snap?.phase).toBe("over");
    expect(useFightBridge.getState().myEvents.some((e) => e.k === "over")).toBe(true);
    // (a jab-only player who never defends may be stopped inside the first round: fighter life, P3-FGT-13)
    expect(scores.length >= 1 || s.state.outcome?.decision === "stoppage").toBe(true);
  });
});

describe("Easy mode (practice only)", () => {
  const base = () => {
    const f = createFight(["me", "ai"], DEFAULT_FIGHT_RULES);
    return { ...f, phase: "round" as const, fighters: [{ ...f.fighters[0], act: "idle" as const }, { ...f.fighters[1], act: "idle" as const }] as typeof f.fighters };
  };
  it("raises the guard while their punch is on its way, not otherwise", () => {
    const s = base();
    expect(assistStep(s, 0, false, null).guard).toBe(false);
    const incoming = { ...s, fighters: [s.fighters[0], { ...s.fighters[1], act: "cross" as const, resolved: false }] as typeof s.fighters };
    expect(assistStep(incoming, 0, false, null).guard).toBe(true);
    expect(assistStep(incoming, 0, true, null).guard).toBe(true);
  });
  it("steps in for a punch pressed out of range, then throws it; a busy press waits, then expires", () => {
    const far = { ...base(), dist: (PUNCH_SPECS.jab.reach + 40) / 10 };
    const a = assistStep(far, 0, false, { a: "jab", age: 0 });
    expect(a.send).toBe("stepIn");
    expect(a.pending?.a).toBe("jab");
    const near = { ...base(), dist: (PUNCH_SPECS.jab.reach - 100) / 10 };
    expect(assistStep(near, 0, false, a.pending).send).toBe("jab");
    const busy = { ...near, fighters: [{ ...near.fighters[0], act: "jab" as const }, near.fighters[1]] as typeof near.fighters };
    expect(assistStep(busy, 0, false, { a: "cross", age: 0 })).toMatchObject({ send: null, pending: { a: "cross", age: 1 } });
    expect(assistStep(busy, 0, false, { a: "cross", age: ASSIST_HOLD }).pending).toBeNull();
  });
});

describe("training drill", () => {
  it("ticks each step from what the fight showed", () => {
    expect(drillDone({ jabs: 0, blocked: 0, slipped: 0, combo: false })).toEqual({ jab: false, block: false, slip: false, combo: false });
    expect(drillDone({ jabs: 2, blocked: 1, slipped: 0, combo: true })).toEqual({ jab: true, block: true, slip: false, combo: true });
    expect(DRILL_SECONDS).toBe(60);
  });
});
