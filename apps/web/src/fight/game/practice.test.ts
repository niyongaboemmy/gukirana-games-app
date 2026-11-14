import { describe, expect, it } from "vitest";
import { useFightBridge } from "../bridge";
import { GLOVE_UP_TICKS, PracticeSession } from "./practice";

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
    expect(scores.length).toBeGreaterThanOrEqual(1);
  });
});
