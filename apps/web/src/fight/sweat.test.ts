import { describe, expect, it } from "vitest";
import { sweatOf } from "./sweat";

/** P3-FGT-19B checklist 21: sweat is off at the first bell and rises with the rounds (and the work done) */
describe("fighter sweat", () => {
  it("is dry at the first bell (below the shader's 0.2 wet threshold plus a margin)", () => {
    expect(sweatOf(1000, 1)).toBeCloseTo(0.22);
    expect(sweatOf(1000, 1)).toBeLessThan(0.25);
  });
  it("rises with every round and with the work done, capped at 1", () => {
    expect(sweatOf(1000, 2)).toBeGreaterThan(sweatOf(1000, 1));
    expect(sweatOf(1000, 3)).toBeGreaterThan(sweatOf(1000, 2));
    expect(sweatOf(400, 1)).toBeGreaterThan(sweatOf(900, 1));
    expect(sweatOf(0, 3)).toBe(1);
  });
});
