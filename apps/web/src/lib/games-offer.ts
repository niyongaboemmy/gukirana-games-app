"use client";
import { create } from "zustand";
import type { GameId, GameOffer, PlayerOffer, StakeOption } from "@gukirana/contracts";
import { api, useSession } from "./session";

/**
 * What this player may start right now, per game (GET /games/offer, P1-GAME-06): the stakes the game offers with the
 * fee, whether each is affordable / allowed and why not, and the friendly games left today. The challenge sheet,
 * quick match, the hall seat panel and incoming challenges all read it, so the UI shows the same reason the server
 * would give — the server still checks everything again.
 */
interface OfferState {
  offer: PlayerOffer | null;
  at: number;
  loading: boolean;
  load: (force?: boolean) => Promise<void>;
}

const FRESH_MS = 15_000;

export const useGameOffer = create<OfferState>()((set, get) => ({
  offer: null,
  at: 0,
  loading: false,
  load: async (force = false) => {
    if (useSession.getState().status !== "authenticated") return;
    if (get().loading || (!force && Date.now() - get().at < FRESH_MS)) return;
    set({ loading: true });
    try {
      set({ offer: await api<PlayerOffer>("/games/offer"), at: Date.now() });
    } catch {
      /* the server re-checks; without an offer the sheets fall back to the Stars balance */
    } finally {
      set({ loading: false });
    }
  },
}));

export const gameOffer = (offer: PlayerOffer | null, game: GameId): GameOffer | undefined => offer?.games.find((g) => g.game === game);

/** one option (0 = Friendly) as the UI shows it; unknown (no offer yet) = allowed, the server decides */
export interface Choice {
  stake: number;
  ok: boolean;
  reason?: string;
  limit?: number;
  fee: number;
  total: number;
}

export function choicesFor(offer: PlayerOffer | null, game: GameId, stars: number, fallback: readonly number[]): Choice[] {
  const g = gameOffer(offer, game);
  if (!g) return fallback.map((s) => ({ stake: s, fee: 0, total: s, ok: s === 0 || s <= stars, ...(s > stars ? { reason: "INSUFFICIENT_FUNDS" } : {}) }));
  const friendly: Choice = { stake: 0, fee: 0, total: 0, ok: g.friendly.ok, ...(g.friendly.reason ? { reason: g.friendly.reason, limit: g.friendly.limit } : {}) };
  return [friendly, ...g.stakes.map((s: StakeOption) => ({ stake: s.stake, fee: s.fee, total: s.total, ok: s.ok, ...(s.reason ? { reason: s.reason } : {}) }))];
}
