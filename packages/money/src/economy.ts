import { coins, type Coins } from "./coins.js";
import { DEFAULT_FEE_BANDS, MIN_FEE_RATE_BP, computeTableFee, type FeeBand } from "./fees.js";
import type { CurrencyRate } from "./currency.js";

/**
 * Economy settings — stored versioned in the database (economy_settings) and edited by admins. Every money-moving
 * post records the version in effect, so a past result can always be recomputed exactly. Nothing here is retroactive.
 */
export interface EconomySettings {
  version: number;
  effectiveFrom: string; // ISO timestamp
  feeBands: FeeBand[];
  minFeeRateBp: number;
  /** practice Stars (no cash value): daily claim, level-up gift, daily-streak bonus by consecutive day */
  dailyStars: number;
  levelUpStars: number;
  streakStars: number[]; // index 0 = day 2 of a streak, …; the last value repeats
  currencies: CurrencyRate[];
  /** real-money pilot (licensed markets only); off = Stars only */
  pilotEnabled: boolean;
  /** tournament prize pools: platform share of the entry pool, payout split of the remainder (bp, sums to 10 000) */
  tournamentRakeBp: number;
  tournamentPayoutBp: number[];
}

export const DEFAULT_ECONOMY: EconomySettings = {
  version: 1,
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  feeBands: [...DEFAULT_FEE_BANDS],
  minFeeRateBp: MIN_FEE_RATE_BP,
  dailyStars: 200,
  levelUpStars: 100,
  streakStars: [20, 40, 60, 80, 100],
  currencies: [
    { code: "RWF", exponent: 0, minorPerCoinMicro: 10_000_000, buySpreadBp: 0, sellSpreadBp: 0, cashoutFeeMinor: 0, minTxnMinor: 500, maxTxnMinor: 2_000_000, enabled: true },
    { code: "USD", exponent: 2, minorPerCoinMicro: 714_286, buySpreadBp: 150, sellSpreadBp: 150, cashoutFeeMinor: 0, minTxnMinor: 100, maxTxnMinor: 200_000, enabled: true },
    { code: "EUR", exponent: 2, minorPerCoinMicro: 657_895, buySpreadBp: 150, sellSpreadBp: 150, cashoutFeeMinor: 0, minTxnMinor: 100, maxTxnMinor: 200_000, enabled: true },
  ],
  pilotEnabled: false,
  tournamentRakeBp: 1000,
  tournamentPayoutBp: [6000, 3000, 1000],
};

/** Validation for admin edits. Returns a list of problems (empty = valid). */
export function validateEconomy(s: EconomySettings): string[] {
  const errs: string[] = [];
  const int = (n: number, name: string, min = 0) => (!Number.isSafeInteger(n) || n < min) && errs.push(`${name} must be an integer ≥ ${min}`);
  int(s.dailyStars, "dailyStars");
  int(s.levelUpStars, "levelUpStars");
  s.streakStars.forEach((v, i) => int(v, `streakStars[${i}]`));
  int(s.minFeeRateBp, "minFeeRateBp");
  if (!s.feeBands.length) errs.push("feeBands must not be empty");
  const sorted = [...s.feeBands].sort((a, b) => a.minStake - b.minStake);
  sorted.forEach((b, i) => {
    int(b.minStake, `feeBands[${i}].minStake`, 1);
    int(b.rateBp, `feeBands[${i}].rateBp`);
    if (b.rateBp > 2000) errs.push(`feeBands[${i}].rateBp above 20% is not allowed`);
    const next = sorted[i + 1];
    if (next && (b.maxStake === null || b.maxStake + 1 !== next.minStake)) errs.push(`feeBands must be contiguous at ${b.maxStake}`);
  });
  if (sorted.at(-1)?.maxStake !== null) errs.push("the last fee band must be open-ended (maxStake null)");
  for (const c of s.currencies) {
    if (!/^[A-Z]{3}$/.test(c.code)) errs.push(`${c.code}: not an ISO 4217 code`);
    int(c.exponent, `${c.code}.exponent`);
    int(c.minorPerCoinMicro, `${c.code}.minorPerCoinMicro`, 1);
    int(c.buySpreadBp, `${c.code}.buySpreadBp`);
    int(c.sellSpreadBp, `${c.code}.sellSpreadBp`);
    if (c.buySpreadBp > 1000 || c.sellSpreadBp > 1000) errs.push(`${c.code}: spreads above 10% are not allowed`);
    if (c.minTxnMinor > c.maxTxnMinor) errs.push(`${c.code}: minTxn > maxTxn`);
  }
  int(s.tournamentRakeBp, "tournamentRakeBp");
  if (s.tournamentPayoutBp.reduce((a, b) => a + b, 0) !== 10_000) errs.push("tournamentPayoutBp must sum to 10000");
  return errs;
}

/* ---------------- transparent analytics (docs/ECONOMY-ANALYSIS.md) ---------------- */

/** Platform revenue from one 2-player match at `stake`: each player pays the table fee on top of the stake. */
export function revenuePerMatch(stake: Coins, s: Pick<EconomySettings, "feeBands"> = DEFAULT_ECONOMY): Coins {
  return coins(2 * computeTableFee(stake, s.feeBands));
}

/**
 * Expected value per match for a player with win probability `pWin` (skill). The winner receives both stakes; both pay
 * the fee. EV = pWin·stake − (1−pWin)·stake − fee  →  for an even match (0.5): EV = −fee. Returned in coins (float).
 */
export function playerExpectedValue(stake: Coins, pWin: number, s: Pick<EconomySettings, "feeBands"> = DEFAULT_ECONOMY): number {
  const fee = computeTableFee(stake, s.feeBands);
  return pWin * stake - (1 - pWin) * stake - fee;
}

/** Effective fee as a share of the amount a player puts in (stake + fee), in bp. */
export function effectiveFeeBp(stake: Coins, s: Pick<EconomySettings, "feeBands"> = DEFAULT_ECONOMY): number {
  const fee = computeTableFee(stake, s.feeBands);
  return Math.round((fee * 10_000) / (stake + fee));
}

/** Tournament: entries × players, the platform keeps its rake, the rest is split by place (floor; remainder → 1st). */
export function tournamentPrizes(entry: Coins, players: number, s: Pick<EconomySettings, "tournamentRakeBp" | "tournamentPayoutBp"> = DEFAULT_ECONOMY) {
  const pool = entry * players;
  const rake = Math.floor((pool * s.tournamentRakeBp) / 10_000);
  const net = pool - rake;
  const prizes = s.tournamentPayoutBp.map((bp) => Math.floor((net * bp) / 10_000));
  prizes[0]! += net - prizes.reduce((a, b) => a + b, 0);
  return { pool: coins(pool), rake: coins(rake), prizes: prizes.map((p) => coins(p)) };
}

/** Streak bonus Stars for consecutive day `day` (1 = first day: no bonus). */
export function streakBonus(day: number, s: Pick<EconomySettings, "streakStars"> = DEFAULT_ECONOMY): number {
  if (day <= 1 || !s.streakStars.length) return 0;
  return s.streakStars[Math.min(day - 2, s.streakStars.length - 1)]!;
}
