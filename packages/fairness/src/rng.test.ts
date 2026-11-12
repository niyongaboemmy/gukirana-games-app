import { describe, expect, it } from "vitest";
import { commitSeed, createFairRng, newSeed, verifyCommit } from "./rng.js";

describe("fair rng", () => {
  it("is deterministic for identical inputs", () => {
    const seed = "a".repeat(64);
    const a = createFairRng(seed, ["c1", "c2"], "match-1");
    const b = createFairRng(seed, ["c1", "c2"], "match-1");
    const rollsA = Array.from({ length: 100 }, () => a.int(1, 6));
    const rollsB = Array.from({ length: 100 }, () => b.int(1, 6));
    expect(rollsA).toEqual(rollsB);
  });

  it("changes when a client seed changes", () => {
    const seed = "b".repeat(64);
    const a = createFairRng(seed, ["c1", "c2"], "m");
    const b = createFairRng(seed, ["c1", "cX"], "m");
    const ra = Array.from({ length: 50 }, () => a.int(1, 6)).join("");
    const rb = Array.from({ length: 50 }, () => b.int(1, 6)).join("");
    expect(ra).not.toBe(rb);
  });

  it("produces uniform dice (chi-square, 60k rolls)", () => {
    const rng = createFairRng(newSeed(), ["x", "y"], "uniformity");
    const counts = [0, 0, 0, 0, 0, 0];
    const n = 60_000;
    for (let i = 0; i < n; i++) counts[rng.int(1, 6) - 1]!++;
    const expected = n / 6;
    const chi2 = counts.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
    expect(chi2).toBeLessThan(20.52); // p = 0.001, 5 degrees of freedom
  });

  it("verifies commits", () => {
    const seed = newSeed();
    expect(verifyCommit(seed, commitSeed(seed))).toBe(true);
    expect(verifyCommit(seed, commitSeed(newSeed()))).toBe(false);
  });
});
