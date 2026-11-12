import { describe, expect, it } from "vitest";
import { facingPits, igisoroBotMove, initIgisoro, legalPits, playIgisoro, totalSeeds } from "./index.js";

describe("igisoro engine", () => {
  it("starts with 64 seeds and 16 legal moves", () => {
    const s = initIgisoro(["a", "b"]);
    expect(totalSeeds(s)).toBe(64);
    expect(legalPits(s)).toHaveLength(16);
  });

  it("maps facing pits by column", () => {
    expect(facingPits(0)).toEqual({ inner: 7, outer: 8 });
    expect(facingPits(7)).toEqual({ inner: 0, outer: 15 });
  });

  it("conserves seeds and always terminates (bot vs bot simulations)", () => {
    for (let game = 0; game < 40; game++) {
      let s = initIgisoro(["a", "b"]);
      // vary the opening deterministically
      s = playIgisoro(s, legalPits(s)[game % 16]!);
      let guard = 0;
      while (s.winner === null && guard++ < 500) {
        s = playIgisoro(s, igisoroBotMove(s, 1 + (guard % 2)));
        expect(totalSeeds(s)).toBe(64);
      }
      expect(guard).toBeLessThan(500);
    }
  });

  it("bot only plays legal pits", () => {
    const s = initIgisoro(["a", "b"]);
    expect(legalPits(s)).toContain(igisoroBotMove(s, 2));
  });
});
