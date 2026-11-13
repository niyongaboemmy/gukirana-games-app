import { describe, expect, it } from "vitest";
import { coins } from "./coins.js";
import { coinsToMinor, minorToCoins, quoteBuy, quoteCashout, type CurrencyRate } from "./currency.js";
import { DEFAULT_ECONOMY, effectiveFeeBp, playerExpectedValue, revenuePerMatch, streakBonus, tournamentPrizes, validateEconomy } from "./economy.js";

const rwf = DEFAULT_ECONOMY.currencies.find((c) => c.code === "RWF")!;
const usd = DEFAULT_ECONOMY.currencies.find((c) => c.code === "USD")!;

describe("currency conversion (integer, no drift)", () => {
  it("RWF peg: 1 coin = 10 RWF both ways", () => {
    expect(coinsToMinor(coins(25), rwf)).toBe(250);
    expect(minorToCoins(250, rwf)).toBe(25);
    expect(minorToCoins(259, rwf)).toBe(25); // never credits a fraction of a coin
  });

  it("USD: 1 coin ≈ 0.714 ¢; 1 000 coins ≈ $7.14", () => {
    expect(coinsToMinor(coins(1000), usd)).toBe(714);
  });

  it("buy never gives more than the mid value, cash-out never pays more than it", () => {
    for (const pay of [100, 999, 12_345, 200_000]) {
      const q = quoteBuy(pay, usd);
      expect(coinsToMinor(q.coins, usd)).toBeLessThanOrEqual(pay);
      expect(q.spreadMinor).toBeGreaterThanOrEqual(0);
    }
    const c = quoteCashout(coins(100_000), usd);
    expect(c.receiveMinor + c.spreadMinor + c.feeMinor).toBe(coinsToMinor(coins(100_000), usd));
  });

  it("buy then cash out loses exactly the two spreads (no hidden drift)", () => {
    const b = quoteBuy(100_000, usd); // $1 000
    const s = quoteCashout(b.coins, usd);
    const lost = 100_000 - s.receiveMinor;
    // ≈ 1.5% + 1.5% of $1 000 = $30 (± rounding of one coin's worth)
    expect(lost).toBeGreaterThanOrEqual(2950);
    expect(lost).toBeLessThanOrEqual(3010);
  });

  it("rejects disabled currencies and out-of-range amounts", () => {
    const off: CurrencyRate = { ...usd, enabled: false };
    expect(() => quoteBuy(1000, off)).toThrow(/DISABLED/);
    expect(() => quoteBuy(10, usd)).toThrow(/OUT_OF_RANGE/);
  });
});

describe("transparent economy analytics", () => {
  it("revenue per match = 2 × table fee", () => {
    expect(revenuePerMatch(coins(25))).toBe(6); // 10% of 25 = 2.5 → 3 each (half up)
    expect(revenuePerMatch(coins(100))).toBe(16); // 8% → 8 each
    expect(revenuePerMatch(coins(1000))).toBe(100); // 5% → 50 each
    expect(revenuePerMatch(coins(10_000))).toBe(400); // 5% capped at 200 each
  });

  it("an even match has EV = −fee; a stronger player can be positive", () => {
    expect(playerExpectedValue(coins(100), 0.5)).toBe(-8);
    expect(playerExpectedValue(coins(100), 0.6)).toBeCloseTo(12, 6);
  });

  it("effective fee falls with stake size", () => {
    expect(effectiveFeeBp(coins(25))).toBeGreaterThan(effectiveFeeBp(coins(1000)));
  });

  it("tournament prizes add up to the pool minus rake", () => {
    const t = tournamentPrizes(coins(100), 16);
    expect(t.pool).toBe(1600);
    expect(t.rake).toBe(160);
    expect(t.prizes.reduce((a, b) => a + b, 0)).toBe(1440);
  });

  it("streak bonus grows and then repeats", () => {
    expect(streakBonus(1)).toBe(0);
    expect(streakBonus(2)).toBe(20);
    expect(streakBonus(30)).toBe(100);
  });

  it("default settings are valid; bad edits are rejected", () => {
    expect(validateEconomy(DEFAULT_ECONOMY)).toEqual([]);
    expect(validateEconomy({ ...DEFAULT_ECONOMY, tournamentPayoutBp: [5000, 3000] }).join()).toMatch(/sum to 10000/);
    expect(validateEconomy({ ...DEFAULT_ECONOMY, feeBands: [{ minStake: 10, maxStake: 49, rateBp: 3000, minFee: 1, cap: null }] }).join()).toMatch(/above 20%|open-ended/);
  });
});
