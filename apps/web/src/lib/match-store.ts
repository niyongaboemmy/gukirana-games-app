"use client";
import { create } from "zustand";

export type GameId = "igisoro" | "ludo" | "pool";
export const STAKES = [0, 25, 50, 100, 200] as const;

export interface IncomingProposal {
  id: string;
  from: { id: string; name: string; level: number; color: string };
  game: GameId;
  stake: number;
  expires: number;
}

interface MatchState {
  incoming: IncomingProposal[];
  outgoing: { id: string; to?: string; game: GameId; stake: number; expires: number } | null;
  quick: { status: "idle" | "waiting" | "error"; game?: GameId; stake?: number; reason?: string };
  ready: { roomId: string; matchId: string; game: GameId; stake: number } | null;
  notice: string | null;
}

export const useMatch = create<MatchState>()(() => ({ incoming: [], outgoing: null, quick: { status: "idle" }, ready: null, notice: null }));

export const GAME_LABEL: Record<GameId, string> = { igisoro: "Igisoro", ludo: "Ludo", pool: "8-Ball Pool" };
const REASONS: Record<string, string> = {
  INSUFFICIENT_FUNDS: "Not enough Stars for that stake.",
  LOGIN_REQUIRED: "Sign in to challenge players.",
  PLAYER_UNAVAILABLE: "That player can't be challenged right now.",
  TOO_MANY_OPEN: "You already have 3 open challenges.",
  DECLINED: "Challenge declined.",
  EXPIRED: "Challenge expired.",
  PLAYER_LEFT: "The other player left.",
};
export const reasonText = (r?: string) => (r && REASONS[r]) || "Something went wrong. Try again.";
