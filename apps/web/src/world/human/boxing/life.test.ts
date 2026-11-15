import { describe, expect, it } from "vitest";
import { addRingLife, bounceHz, hash01 } from "./life";
import { fitRadius, limbRadius } from "./kit-fit";
import { reachScale } from "./motion";
import { GUARD, P, copyPose } from "./pose";

const life = { seed: 1234, energy: 1, tired: 0, move: 0 };

describe("ring life (P3-FGT-07)", () => {
  it("is deterministic and moves the stance over time", () => {
    const a = addRingLife(copyPose(GUARD), 3.21, life, 1, 1);
    const b = addRingLife(copyPose(GUARD), 3.21, life, 1, 1);
    expect([...a]).toEqual([...b]);
    const ys = [0, 0.1, 0.2, 0.3, 0.4, 0.5].map((t) => addRingLife(copyPose(GUARD), t, life, 1, 1)[P.hy]!);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.015);
  });
  it("weight 0 leaves the clip alone; the referee never bounces", () => {
    expect([...addRingLife(copyPose(GUARD), 2, life, 0, 1)]).toEqual([...GUARD]);
    const ref = [0, 0.15, 0.3].map((t) => addRingLife(copyPose(GUARD), t, { ...life, official: true }, 1, 0)[P.hy]!);
    expect(new Set(ref).size).toBe(1);
  });
  it("tired: slower rhythm, lower gloves", () => {
    expect(bounceHz(1, 0)).toBeGreaterThan(bounceHz(0.2, 1));
    const fresh = addRingLife(copyPose(GUARD), 1, life, 1, 0)[P.ly]!;
    const tired = addRingLife(copyPose(GUARD), 1, { ...life, tired: 1, energy: 0 }, 1, 0)[P.ly]!;
    expect(tired).toBeLessThan(fresh - 0.03);
  });
  it("shuffles the feet only while moving", () => {
    const still = [0.1, 0.3, 0.5].map((t) => addRingLife(copyPose(GUARD), t, life, 1, 1)[P.fLy]!);
    expect(still.every((y) => y === GUARD[P.fLy])).toBe(true);
    const lifts = Array.from({ length: 20 }, (_, i) => addRingLife(copyPose(GUARD), i * 0.05, { ...life, move: 0.6 }, 1, 1)[P.fLy]!);
    expect(Math.max(...lifts)).toBeGreaterThan(0.02);
  });
  it("hash01 is stable and in range", () => {
    expect(hash01(3, 9)).toBe(hash01(3, 9));
    expect(hash01(3, 9)).toBeGreaterThanOrEqual(0);
    expect(hash01(3, 9)).toBeLessThan(1);
  });
});

describe("kit body fit profile", () => {
  it("athletic limb radii taper towards the joints", () => {
    expect(limbRadius("thigh", 0)).toBeGreaterThan(limbRadius("thigh", 1));
    expect(limbRadius("calf", 0.3)).toBeGreaterThan(limbRadius("calf", 1));
    expect(limbRadius("foreArm", 1)).toBeLessThan(limbRadius("upperArm", 0));
  });
  it("pulls a baggy garment in, keeps a slim limb", () => {
    expect(fitRadius(0.14, 0.08)).toBeLessThan(0.1);
    expect(fitRadius(0.05, 0.08)).toBe(0.05);
  });
});

describe("punch reach fit", () => {
  it("scales the glove to the target, clamped; non-punches untouched", () => {
    expect(reachScale("jab", 0.78)).toBeCloseTo(1);
    expect(reachScale("jab", 0.4)).toBe(0.7);
    expect(reachScale("jab", 3)).toBe(1.25);
    expect(reachScale("guardIdle", 0.5)).toBe(1);
  });
});
