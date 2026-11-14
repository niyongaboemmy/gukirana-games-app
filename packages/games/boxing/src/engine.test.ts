import { describe, expect, it } from "vitest";
import { DEFAULT_FIGHT_RULES, TICK_HZ, type FightInput } from "@gukirana/contracts";
import {
  beginFight,
  COUNTDOWN_TICKS,
  createFight,
  forfeitFight,
  hashFight,
  matchResultOf,
  stepFight,
  type FightState,
  type TickInputs,
} from "./index.js";

const NONE: TickInputs = [null, null];
function run(s: FightState, inputs: (t: number) => TickInputs = () => NONE, guard = 100_000): FightState {
  while (s.phase !== "over" && guard-- > 0) s = stepFight(s, inputs(s.tick));
  return s;
}

describe("boxing engine (stub)", () => {
  it("runs the rounds and rests on the fixed tick, then decides (no punches → draw)", () => {
    const r = DEFAULT_FIGHT_RULES;
    const end = run(beginFight(createFight(["a", "b"], r)));
    expect(end.phase).toBe("over");
    expect(end.tick).toBe(
      COUNTDOWN_TICKS + r.rounds * r.roundSeconds * TICK_HZ + (r.rounds - 1) * r.restSeconds * TICK_HZ,
    );
    expect(end.rounds).toHaveLength(r.rounds);
    expect(end.outcome).toMatchObject({ decision: "draw", winner: null });
    expect(matchResultOf(end).ranks).toEqual({ a: 1, b: 1 });
  });

  it("is deterministic: the same inputs give the same fight", () => {
    const script = (t: number): TickInputs => [
      t % 7 === 0 ? ({ seq: t, g: t % 2 === 0 } satisfies FightInput) : null,
      null,
    ];
    const a = run(beginFight(createFight(["a", "b"])), script);
    const b = run(beginFight(createFight(["a", "b"])), script);
    expect(hashFight(a)).toBe(hashFight(b));
  });

  it("a forfeit goes to the other fighter", () => {
    const s = forfeitFight(beginFight(createFight(["a", "b"])), 0);
    expect(s.outcome).toMatchObject({ decision: "forfeit", winner: 1 });
    expect(matchResultOf(s)).toMatchObject({ ranks: { a: 2, b: 1 }, reason: "forfeit" });
  });
});
