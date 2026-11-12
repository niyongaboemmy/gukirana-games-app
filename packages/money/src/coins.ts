/**
 * Coins are the internal unit of a player's real-money balance (SRS §6.1).
 * 1 Coin = 10 RWF. Coins are always safe integers — never floats (plan §4.3).
 */
export type Coins = number & { readonly __brand: "Coins" };

/** Default peg. The live value comes from the CoinPeg config (FR-CUR-01). */
export const COIN_VALUE_RWF = 10;

export function coins(value: number): Coins {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Coins must be a safe integer, got ${value}`);
  }
  return value as Coins;
}

export function coinsToRwf(amount: Coins, coinValueRwf = COIN_VALUE_RWF): number {
  return amount * coinValueRwf;
}

/** Converts RWF to whole coins. Throws if the amount is not an exact multiple of the peg. */
export function rwfToCoins(rwf: number, coinValueRwf = COIN_VALUE_RWF): Coins {
  if (!Number.isSafeInteger(rwf) || rwf % coinValueRwf !== 0) {
    throw new RangeError(`RWF amount ${rwf} is not a whole number of coins`);
  }
  return coins(rwf / coinValueRwf);
}

export function addCoins(...amounts: Coins[]): Coins {
  return coins(amounts.reduce((sum, a) => sum + a, 0));
}
