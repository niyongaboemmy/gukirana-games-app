"use client";
import { create } from "zustand";
import { fill, REASON_WORDS } from "@/match/strings";

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
/**
 * A server refusal code in plain words (match/strings.ts). `ctx.game` / `ctx.limit` come with the refusal (or from the
 * sheet) so "You've played your 20 friendly games of Ludo today" names the real game and limit.
 */
export const reasonText = (r?: string, ctx: { game?: string; limit?: number } = {}) => {
  const words = r ? REASON_WORDS[r] : undefined;
  if (!words) return "Something went wrong. Try again.";
  const game = ctx.game && ctx.game in GAME_LABEL ? GAME_LABEL[ctx.game as GameId] : "this game";
  return fill(words, { game, limit: ctx.limit ?? "daily" });
};
