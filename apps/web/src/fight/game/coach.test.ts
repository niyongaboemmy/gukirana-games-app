import { describe, expect, it } from "vitest";
import type { FightEvent, FighterView } from "@gukirana/contracts";
import { COACH_GAP_MS, COACH_REPEAT_MS, COACH_SHOW_MS, coachMayShow, coachTip, type CoachInput } from "./coach";
import { FG } from "./strings";

const fv = (p: Partial<FighterView> = {}): FighterView => ({ id: "a", corner: "red", act: "idle", actT: 0, stage: "none", guard: false, stamina: 900, composure: 900, points: 0, knockdowns: 0, warnings: 0, connected: true, ...p });
const input = (p: Partial<CoachInput> = {}, dist = 100, me: Partial<FighterView> = {}): CoachInput => ({
  snap: { phase: "round", dist, fighters: [fv(me), fv({ corner: "blue" })] },
  me: 0,
  feed: [],
  now: 10_000,
  lastPress: 9_000,
  roundAge: 10_000,
  ...p,
});
const ev = (e: FightEvent, at = 9_500) => ({ e, at });

describe("fight coach (P3-FGT-07)", () => {
  it("is quiet while the player is doing fine, and outside rounds", () => {
    expect(coachTip(input())).toBeNull();
    expect(coachTip(input({ snap: { phase: "rest", dist: 150, fighters: [fv(), fv()] } }))).toBeNull();
    expect(coachTip(input({ roundAge: 1000, lastPress: 0 }))).toBeNull();
  });
  it("nudges an idle player: step in when far, jab when in range", () => {
    expect(coachTip(input({ lastPress: 0 }, 300))).toBe("coach.stepIn");
    expect(coachTip(input({ lastPress: 0 }, 100))).toBe("coach.jab"); // engine v2: 1.0 m apart is jab range (1.18 m)
  });
  it("explains repeated misses, blocks, slips, hits taken and fatigue", () => {
    const whiff = ev({ k: "whiff", t: 1, by: 0, punch: "jab" });
    expect(coachTip(input({ feed: [whiff, whiff] }, 300))).toBe("coach.stepIn");
    const block = ev({ k: "block", t: 1, by: 0, punch: "cross" });
    expect(coachTip(input({ feed: [block, block, block] }))).toBe("coach.mixUp");
    const taken = ev({ k: "hit", t: 1, by: 1, punch: "jab", points: 1, counter: false, combo: 1 });
    expect(coachTip(input({ feed: [taken, taken, taken] }))).toBe("coach.guardUp");
    expect(coachTip(input({}, 150, { stamina: 100 }))).toBe("coach.tired");
    // old events are forgotten
    expect(coachTip(input({ feed: [ev({ k: "whiff", t: 1, by: 0, punch: "jab" }, 0), ev({ k: "whiff", t: 1, by: 0, punch: "jab" }, 0)] }, 300))).toBeNull();
  });
  it("rate limit: one at a time, a gap, no quick repeats", () => {
    const last = { tip: "coach.jab" as const, at: 0 };
    expect(coachMayShow("coach.stepIn", COACH_SHOW_MS, last, {})).toBe(false);
    expect(coachMayShow("coach.stepIn", COACH_SHOW_MS + COACH_GAP_MS + 1, last, {})).toBe(true);
    expect(coachMayShow("coach.jab", COACH_SHOW_MS + COACH_GAP_MS + 1, last, { "coach.jab": 0 })).toBe(false);
    expect(coachMayShow("coach.jab", COACH_REPEAT_MS + 1, last, { "coach.jab": 0 })).toBe(true);
  });
  it("every tip has text", () => {
    for (const k of ["coach.stepIn", "coach.jab", "coach.timing", "coach.mixUp", "coach.feint", "coach.guardUp", "coach.defend", "coach.tired"] as const) expect(FG[k].length).toBeGreaterThan(5);
  });
});
