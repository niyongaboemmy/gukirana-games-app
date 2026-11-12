import { coins, type Coins } from "./coins.js";

/** A fee band from the fee schedule (SRS §6.7.3). Rates are in basis points (1% = 100 bp). */
export interface FeeBand {
  minStake: number;
  maxStake: number | null;
  rateBp: number;
  minFee: number;
  cap: number | null;
}

export const DEFAULT_FEE_BANDS: readonly FeeBand[] = [
  { minStake: 10, maxStake: 49, rateBp: 1000, minFee: 1, cap: null }, // 10%
  { minStake: 50, maxStake: 199, rateBp: 800, minFee: 1, cap: null }, // 8%
  { minStake: 200, maxStake: 999, rateBp: 600, minFee: 1, cap: null }, // 6%
  { minStake: 1000, maxStake: null, rateBp: 500, minFee: 1, cap: 200 }, // 5%, capped
];

export const MIN_FEE_RATE_BP = 300;

/**
 * Table fee paid by EACH player on top of the stake. The winner always receives exactly
 * the sum of the stakes (FR-ESC-03). Integer-only, rounded half up to the nearest coin.
 */
export function computeTableFee(
  stake: Coins,
  bands: readonly FeeBand[] = DEFAULT_FEE_BANDS,
  premiumDiscountBp = 0,
): Coins {
  const band = bands.find((b) => stake >= b.minStake && (b.maxStake === null || stake <= b.maxStake));
  if (!band) throw new RangeError(`STAKE_OUT_OF_RANGE: ${stake}`);
  const rateBp = Math.max(band.rateBp - premiumDiscountBp, MIN_FEE_RATE_BP);
  let fee = Math.floor((stake * rateBp + 5000) / 10000);
  fee = Math.max(fee, band.minFee);
  if (band.cap !== null) fee = Math.min(fee, band.cap);
  return coins(fee);
}

export interface ChallengeQuote {
  stake: Coins;
  fee: Coins;
  totalToPay: Coins;
  pot: Coins;
}

/** What a player sees on the confirmation sheet (UI-12). Shown amount === posted amount. */
export function quoteChallenge(stake: Coins, players = 2, premiumDiscountBp = 0): ChallengeQuote {
  const fee = computeTableFee(stake, DEFAULT_FEE_BANDS, premiumDiscountBp);
  return { stake, fee, totalToPay: coins(stake + fee), pot: coins(stake * players) };
}
