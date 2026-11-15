import { describe, expect, it } from "vitest";
import { CORNER_REFRESH_PRICE_STARS, CORNER_REFRESH_STAMINA, cornerRefreshKey, cornerRefreshRefusal, refreshedStamina } from "./boosts.js";

describe("corner refresh (practice boost)", () => {
  const ok = { mode: "practice" as const, round: 2, usedThisRound: 0, stars: 500 };
  it("is an integer price and an integer stamina amount", () => {
    expect(Number.isSafeInteger(CORNER_REFRESH_PRICE_STARS)).toBe(true);
    expect(CORNER_REFRESH_PRICE_STARS).toBeGreaterThan(0);
    expect(Number.isSafeInteger(CORNER_REFRESH_STAMINA)).toBe(true);
  });
  it("is allowed once per round of a practice fight, never against a player", () => {
    expect(cornerRefreshRefusal(ok)).toBeNull();
    expect(cornerRefreshRefusal({ ...ok, mode: "live" })).toBe("NOT_PRACTICE");
    expect(cornerRefreshRefusal({ ...ok, usedThisRound: 1 })).toBe("USED_THIS_ROUND");
    expect(cornerRefreshRefusal({ ...ok, round: 0 })).toBe("NO_ROUND");
    expect(cornerRefreshRefusal({ ...ok, stars: CORNER_REFRESH_PRICE_STARS - 1 })).toBe("NOT_ENOUGH_STARS");
    expect(cornerRefreshRefusal({ ...ok, stars: CORNER_REFRESH_PRICE_STARS })).toBeNull();
  });
  it("caps the stamina at full", () => {
    expect(refreshedStamina(100)).toBe(100 + CORNER_REFRESH_STAMINA);
    expect(refreshedStamina(950)).toBe(1000);
  });
  it("keys one refresh per fight and round", () => {
    expect(cornerRefreshKey("u", "p", 1)).toBe(cornerRefreshKey("u", "p", 1));
    expect(cornerRefreshKey("u", "p", 1)).not.toBe(cornerRefreshKey("u", "p", 2));
  });
});
