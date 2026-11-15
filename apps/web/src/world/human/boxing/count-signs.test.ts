import { describe, expect, it } from "vitest";
import { countSign, fingersShown } from "./count-signs";
import { BOXING_CLIPS } from "./clips";

describe("the referee's finger count (P3-FGT-14)", () => {
  it("shows exactly n fingers for every count 1…10, one hand up to 5, both from 6", () => {
    for (let n = 1; n <= 10; n++) {
      const s = countSign(n);
      expect(fingersShown(s), `count ${n}`).toBe(n);
      expect(s.both).toBe(n >= 6);
    }
  });
  it("counts in the usual order: index first, the thumb last (five = the open hand)", () => {
    expect(countSign(1).first).toEqual([0, 1, 0, 0, 0]);
    expect(countSign(4).first).toEqual([0, 1, 1, 1, 1]);
    expect(countSign(5).first).toEqual([1, 1, 1, 1, 1]);
    expect(countSign(7).first).toEqual([1, 1, 1, 1, 1]);
    expect(countSign(7).second).toEqual([0, 1, 1, 0, 0]);
  });
  it("no count is a closed hand; out-of-range counts clamp", () => {
    expect(fingersShown(countSign(0))).toBe(0);
    expect(fingersShown(countSign(undefined))).toBe(0);
    expect(fingersShown(countSign(14))).toBe(10);
  });
  it("both count clips beat once a second (one number per beat)", () => {
    for (const c of ["refCount", "refCount2"] as const) {
      expect(BOXING_CLIPS[c].duration).toBe(1);
      expect(BOXING_CLIPS[c].loop).toBe(true);
    }
  });
});
