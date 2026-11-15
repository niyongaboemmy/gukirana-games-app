import { describe, expect, it } from "vitest";
import type { BoxingOutcome, FightEvent } from "@gukirana/contracts";
import { accuracy, judgeGoal, levelGoal, liveRound, newStats, punchVerdict, roundsWon, roundVerdict, tallyStats } from "./outcome";

const hit = (by: 0 | 1, punch: "jab" | "cross" | "hook" | "uppercut" = "jab", points = 1): FightEvent => ({ k: "hit", t: 1, by, punch, points, counter: false, combo: 1 });
const outcome = (o: Partial<BoxingOutcome>): BoxingOutcome => ({ decision: "points", winner: 0, points: [10, 5], knockdowns: [0, 0], power: [0, 0], rounds: [[5, 2], [5, 3]], ...o });

describe("punch outcome", () => {
  it("names every punch outcome with a tone from my side", () => {
    expect(punchVerdict(hit(0), 0)).toMatchObject({ outcome: "landed", mine: true, good: true });
    expect(punchVerdict(hit(1), 0)).toMatchObject({ outcome: "landed", mine: false, good: false });
    expect(punchVerdict({ k: "block", t: 1, by: 0, punch: "jab" }, 0)).toMatchObject({ outcome: "blocked", good: false });
    expect(punchVerdict({ k: "evade", t: 1, by: 1, punch: "hook" }, 0)).toMatchObject({ outcome: "slipped", mine: false, good: true });
    expect(punchVerdict({ k: "whiff", t: 1, by: 0, punch: "cross" }, 0)).toMatchObject({ outcome: "missed", good: false });
    expect(punchVerdict({ k: "bell", t: 1, round: 1 }, 0)).toBeNull();
  });
});

describe("fight stats", () => {
  it("tallies thrown / landed / power / knockdowns / fouls per fighter and per round", () => {
    let st = newStats();
    st = tallyStats(st, [{ k: "bell", t: 0, round: 1 }, hit(0), hit(0, "hook", 3), { k: "whiff", t: 2, by: 0, punch: "jab" }, { k: "block", t: 3, by: 1, punch: "cross" }]);
    st = tallyStats(st, [{ k: "knockdown", t: 4, to: 1, points: 0 }, { k: "warning", t: 5, to: 0, foul: "HOLDING" as never, penalty: 1 }]);
    st = tallyStats(st, [{ k: "bell", t: 9, round: 2 }, hit(1, "cross", 2)]);
    expect(st.sides[0]).toMatchObject({ thrown: 3, landed: 2, powerLanded: 1, missed: 1, knockdowns: 1, warnings: 1, points: 4 });
    expect(st.sides[1]).toMatchObject({ thrown: 2, landed: 1, blocked: 1, powerLanded: 1 });
    expect(accuracy(st.sides[0])).toBe(67);
    expect(st.rounds.map((r) => r.sides[0].landed)).toEqual([2, 0]);
    expect(liveRound(st, 0)).toEqual({ round: 2, mine: 0, theirs: 2 });
  });
  it("does not change its input", () => {
    const st = newStats();
    tallyStats(st, [hit(0)]);
    expect(st.sides[0].thrown).toBe(0);
  });
});

describe("round verdict", () => {
  it("counts the judges (deductions applied) and gives the clearest reasons", () => {
    const st = tallyStats(newStats(), [{ k: "bell", t: 0, round: 1 }, hit(0), hit(0), hit(1)]);
    const v = roundVerdict({ k: "roundEnd", t: 9, round: 1, points: [2, 1], card: { round: 1, judges: [[10, 9], [10, 9], [9, 10], [10, 9], [10, 10]], deductions: [0, 0], knockdowns: [0, 0] } }, st.rounds[0], 0);
    expect(v.winner).toBe("me");
    expect(v.votes).toEqual([3, 1, 1]);
    expect(v.reasons[0]).toEqual({ k: "landed", mine: 2, theirs: 1 });
    const flipped = roundVerdict({ k: "roundEnd", t: 9, round: 1, points: [2, 1], card: { round: 1, judges: [[10, 9], [10, 9], [10, 9]], deductions: [2, 0], knockdowns: [0, 0] } }, undefined, 0);
    expect(flipped.winner).toBe("them");
  });
});

describe("practice level goals", () => {
  it("has a goal per level, from landing punches to a clear win", () => {
    expect([1, 2, 3, 4, 5].map((l) => levelGoal(l).kind)).toEqual(["land", "land", "winRound", "win", "winClear"]);
    expect(levelGoal(9).level).toBe(5);
  });
  it("passes / fails a landing goal on the clean punches landed, with stars and tips", () => {
    const st = tallyStats(newStats(), Array.from({ length: 12 }, () => hit(0)));
    const pass = judgeGoal(levelGoal(1), outcome({ winner: 1 }), st, 0);
    expect(pass.pass).toBe(true);
    expect(pass.progress).toEqual({ have: 10, need: 10 });
    expect(pass.stars).toBe(2); // the goal + accuracy, not the win
    const fail = judgeGoal(levelGoal(2), outcome({ winner: 1 }), st, 0);
    expect(fail.pass).toBe(false);
    expect(fail.stars).toBe(0);
    expect(fail.progress).toEqual({ have: 12, need: 20 });
  });
  it("a clear win needs KO / RSC / unanimous; a split decision fails it", () => {
    const st = tallyStats(newStats(), [hit(0)]);
    expect(judgeGoal(levelGoal(5), outcome({ method: "UD" }), st, 0).pass).toBe(true);
    expect(judgeGoal(levelGoal(5), outcome({ method: "SD" }), st, 0).pass).toBe(false);
    expect(judgeGoal(levelGoal(4), outcome({ method: "SD" }), st, 0).pass).toBe(true);
    expect(judgeGoal(levelGoal(4), outcome({ winner: 1, method: "KO", decision: "stoppage" }), st, 0).tips[0]).toBe("tip.stamina");
  });
  it("counts rounds won on the cards", () => {
    const o = outcome({
      cards: [
        { round: 1, judges: [[10, 9], [10, 9], [9, 10]], deductions: [0, 0], knockdowns: [0, 0] },
        { round: 2, judges: [[9, 10], [9, 10], [9, 10]], deductions: [0, 0], knockdowns: [0, 0] },
      ],
    });
    expect(roundsWon(o, 0)).toBe(1);
    expect(roundsWon(o, 1)).toBe(1);
  });
});
