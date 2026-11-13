import { coins, type Coins } from "./coins.js";

/**
 * Coins ↔ money in any currency (FR-CUR-01..04). Integer-only: money is held in MINOR units (cents, RWF has none),
 * rates are fixed-point integers and all arithmetic runs on BigInt, so a conversion never drifts or loses a unit.
 *
 * Rate: `minorPerCoinMicro` = minor units of the currency per 1 coin, × 1_000_000.
 *   RWF (exponent 0), 1 coin = 10 RWF          → 10_000_000
 *   USD (exponent 2), 1 USD ≈ 1 400 RWF        → 1 coin = 0.714286 ¢ → 714_286
 * Spreads are basis points (1% = 100 bp): the platform buys coins back a little lower than it sells them.
 */
export interface CurrencyRate {
  code: string; // ISO 4217
  exponent: number; // minor-unit exponent (RWF 0, USD/EUR 2)
  minorPerCoinMicro: number;
  buySpreadBp: number; // added to the price when a player BUYS coins
  sellSpreadBp: number; // taken off when a player CASHES OUT coins
  cashoutFeeMinor: number; // flat fee per cash-out, in minor units
  minTxnMinor: number;
  maxTxnMinor: number;
  enabled: boolean;
}

const MICRO = 1_000_000n;
const BP = 10_000n;

function rate(r: CurrencyRate): bigint {
  if (!Number.isSafeInteger(r.minorPerCoinMicro) || r.minorPerCoinMicro <= 0) throw new RangeError(`BAD_RATE: ${r.code}`);
  return BigInt(r.minorPerCoinMicro);
}

/** Mid-market value of some coins in a currency's minor units (rounded half up). For display / reports only. */
export function coinsToMinor(amount: Coins, r: CurrencyRate): number {
  const v = (BigInt(amount) * rate(r) + MICRO / 2n) / MICRO;
  return Number(v);
}

/** Mid-market coins for an amount of money (rounded down: never credit a fraction of a coin). Display only. */
export function minorToCoins(minor: number, r: CurrencyRate): Coins {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new RangeError(`BAD_AMOUNT: ${minor}`);
  return coins(Number((BigInt(minor) * MICRO) / rate(r)));
}

export interface BuyQuote {
  payMinor: number; // what the player pays
  coins: Coins; // what they receive
  spreadMinor: number; // platform margin inside the price
}

/** Player pays `payMinor` of money → receives coins at the mid rate marked up by the buy spread (floor). */
export function quoteBuy(payMinor: number, r: CurrencyRate): BuyQuote {
  if (!r.enabled) throw new RangeError(`CURRENCY_DISABLED: ${r.code}`);
  if (!Number.isSafeInteger(payMinor) || payMinor < r.minTxnMinor || payMinor > r.maxTxnMinor) throw new RangeError(`AMOUNT_OUT_OF_RANGE: ${payMinor}`);
  const pricePerCoin = rate(r) * (BP + BigInt(r.buySpreadBp)); // minor × MICRO × BP
  const got = (BigInt(payMinor) * MICRO * BP) / pricePerCoin;
  const midValue = coinsToMinor(coins(Number(got)), r);
  return { payMinor, coins: coins(Number(got)), spreadMinor: payMinor - midValue };
}

export interface CashoutQuote {
  coins: Coins; // coins given up
  receiveMinor: number; // money paid out to the player
  spreadMinor: number;
  feeMinor: number;
}

/** Player cashes out coins → money at the mid rate less the sell spread (floor), minus the flat fee. */
export function quoteCashout(amount: Coins, r: CurrencyRate): CashoutQuote {
  if (!r.enabled) throw new RangeError(`CURRENCY_DISABLED: ${r.code}`);
  const gross = (BigInt(amount) * rate(r) * (BP - BigInt(r.sellSpreadBp))) / (MICRO * BP);
  const mid = coinsToMinor(amount, r);
  const receive = Number(gross) - r.cashoutFeeMinor;
  if (receive < r.minTxnMinor || receive > r.maxTxnMinor) throw new RangeError(`AMOUNT_OUT_OF_RANGE: ${receive}`);
  return { coins: amount, receiveMinor: receive, spreadMinor: mid - Number(gross), feeMinor: r.cashoutFeeMinor };
}

/** "1 234,56 €"-style formatting from minor units, using the user's locale. */
export function formatMinor(minor: number, r: Pick<CurrencyRate, "code" | "exponent">, locale = "en"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: r.code, minimumFractionDigits: r.exponent, maximumFractionDigits: r.exponent }).format(
    minor / 10 ** r.exponent,
  );
}
