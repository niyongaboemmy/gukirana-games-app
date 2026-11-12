import { describe, expect, it } from "vitest";
import { eloUpdate, levelForXp, totalXpForLevel, xpForMatch } from "./xp.js";

describe("levels", () => {
  it("level curve", () => {
    expect([0, 50, 2250, 247500].map(levelForXp)).toEqual([1, 2, 10, 100]);
    expect(totalXpForLevel(25)).toBe(15000);
  });
  it("xp per match with caps", () => {
    expect(xpForMatch({ outcome: "win", beatHigherRated: true, firstWinToday: true, sameOpponentCountToday: 0 }, 0)).toBe(45);
    expect(xpForMatch({ outcome: "loss", beatHigherRated: false, firstWinToday: false, sameOpponentCountToday: 0 }, 395)).toBe(5);
    expect(xpForMatch({ outcome: "win", beatHigherRated: false, firstWinToday: false, sameOpponentCountToday: 5 }, 0)).toBe(0);
    expect(xpForMatch({ outcome: "forfeit", beatHigherRated: false, firstWinToday: false, sameOpponentCountToday: 0 }, 0)).toBe(0);
  });
  it("elo is zero-sum for equal players", () => {
    const r = eloUpdate([{ id: "a", rating: 1500, rank: 1 }, { id: "b", rating: 1500, rank: 2 }]);
    expect(r).toEqual({ a: 1516, b: 1484 });
  });
});
