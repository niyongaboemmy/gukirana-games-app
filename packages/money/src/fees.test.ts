import { describe, expect, it } from "vitest";
import { coins, coinsToRwf, rwfToCoins } from "./coins.js";
import { computeTableFee, quoteChallenge } from "./fees.js";

describe("computeTableFee", () => {
  it.each([
    [20, 2],
    [100, 8],
    [500, 30],
    [2000, 100],
    [10000, 200],
  ])("stake %i → fee %i", (stake, fee) => {
    expect(computeTableFee(coins(stake))).toBe(fee);
  });

  it("applies the premium discount with a 3% floor", () => {
    expect(computeTableFee(coins(100), undefined, 200)).toBe(6);
    expect(computeTableFee(coins(2000), undefined, 500)).toBe(60);
  });

  it("rejects stakes below the minimum", () => {
    expect(() => computeTableFee(coins(5))).toThrow(RangeError);
  });

  it("always returns a positive integer for every valid stake", () => {
    for (let s = 10; s <= 20000; s += 10) {
      const fee = computeTableFee(coins(s));
      expect(Number.isSafeInteger(fee)).toBe(true);
      expect(fee).toBeGreaterThan(0);
      expect(fee).toBeLessThanOrEqual(200);
    }
  });
});

describe("quoteChallenge", () => {
  it("winner gets exactly 2× the stake; fee is a separate line", () => {
    expect(quoteChallenge(coins(100))).toEqual({ stake: 100, fee: 8, totalToPay: 108, pot: 200 });
  });
});

describe("coin conversion", () => {
  it("1 coin = 10 RWF", () => {
    expect(coinsToRwf(coins(100))).toBe(1000);
    expect(rwfToCoins(1000)).toBe(100);
  });
  it("rejects non-integers", () => {
    expect(() => coins(1.5)).toThrow(RangeError);
    expect(() => rwfToCoins(1005)).toThrow(RangeError);
  });
});
