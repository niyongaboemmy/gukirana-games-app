import { describe, expect, it } from "vitest";
import {
  beginFight,
  boxingBotInput,
  createFight,
  stepFight,
  type BotLevel,
  type FightState,
} from "./index.js";

/** seeded test rng (tests only; practice seeds the bot from @gukirana/fairness) */
const lcg = (seed: number) => {
  let x = seed >>> 0 || 1;
  return {
    int(min: number, max: number) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      return min + ((x >>> 8) % (max - min + 1));
    },
  };
};

function botFight(red: BotLevel, blue: BotLevel, seed: number): FightState {
  const ra = lcg(seed * 2 + 1);
  const rb = lcg(seed * 2 + 7919);
  let s = beginFight(createFight(["red", "blue"]));
  while (s.phase !== "over")
    s = stepFight(s, [boxingBotInput(s, 0, red, ra), boxingBotInput(s, 1, blue, rb)]);
  return s;
}

describe("boxing practice bot", () => {
  it("is deterministic given the rng", () => {
    expect(botFight(3, 4, 9).outcome).toEqual(botFight(3, 4, 9).outcome);
  });

  it("level n+1 beats level n in ≥ 60 % of 500 fights (corners alternate)", () => {
    for (const n of [1, 2, 3, 4] as const) {
      const up = (n + 1) as BotLevel;
      let wins = 0;
      for (let i = 0; i < 500; i++) {
        const upIsRed = i % 2 === 0;
        const s = upIsRed ? botFight(up, n, i) : botFight(n, up, i);
        if (s.outcome!.winner === (upIsRed ? 0 : 1)) wins++;
      }
      expect(wins / 500, `L${up} vs L${n}`).toBeGreaterThanOrEqual(0.6);
    }
  }, 120_000);
});
