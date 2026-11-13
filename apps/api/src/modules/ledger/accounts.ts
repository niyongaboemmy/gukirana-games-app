/** Well-known platform account owners (fixed ids so unique constraints work). */
export const PLATFORM_ID = "00000000-0000-0000-0000-000000000001";

export type Currency = "STAR" | "COIN";

export interface AccountRef {
  ownerType: "user" | "platform" | "escrow" | "fee_held" | "tax" | "provider" | "promo";
  ownerId: string;
  kind: "available" | "bonus" | "locked" | "pending" | "stars" | "revenue" | "payable" | "clearing" | "budget";
  currency: Currency;
  allowNegative?: boolean;
}

/** Real-money coins (licensed pilot only). */
export const userCoins = (userId: string): AccountRef => ({ ownerType: "user", ownerId: userId, kind: "available", currency: "COIN" });
export const userStars = (userId: string): AccountRef => ({ ownerType: "user", ownerId: userId, kind: "stars", currency: "STAR" });
/** Source of practice Stars (no cash value). Contra account, may go negative. */
export const starsBudget = (): AccountRef => ({ ownerType: "platform", ownerId: PLATFORM_ID, kind: "budget", currency: "STAR", allowNegative: true });
export const matchEscrow = (matchId: string, currency: Currency): AccountRef => ({ ownerType: "escrow", ownerId: matchId, kind: "locked", currency });
