"use client";
import { create } from "zustand";
import type { FightLeaderboard, FightRating, FightRatingChange, FightStatLine } from "@gukirana/contracts";
import { api } from "@/lib/session";

/**
 * Who is better (P3-FGT-10, docs/FIGHT-GAME-V2.md §7): the boxing Glicko-2 rating, the skill report and the
 * leaderboard on the client. Read-only: the rating is computed by the API on settlement from the signed result; the
 * client never sends a score. Behind NEXT_PUBLIC_FF_FIGHT_RATING (on unless "0").
 */
export const RATING_ON = process.env.NEXT_PUBLIC_FF_FIGHT_RATING !== "0";

export interface SkillPair {
  mine: FightStatLine;
  theirs: FightStatLine;
}

interface RatingStore {
  me: FightRating | null;
  board: FightLeaderboard | null;
  boardState: "idle" | "loading" | "error";
  open: boolean;
  /** the last live fight's rating change (from the settlement) */
  change: FightRatingChange | null;
  setChange: (c: FightRatingChange | null) => void;
  loadMe: () => Promise<void>;
  loadBoard: () => Promise<void>;
  setOpen: (o: boolean) => void;
}

export const useFightRating = create<RatingStore>()((set, get) => ({
  me: null,
  board: null,
  boardState: "idle",
  open: false,
  change: null,
  setChange: (change) => set({ change }),
  loadMe: async () => {
    if (!RATING_ON) return;
    try {
      set({ me: await api<FightRating>("/fight/rating/me") });
    } catch {
      // a guest / the API down: the card just shows no rating line
    }
  },
  loadBoard: async () => {
    if (!RATING_ON || get().boardState === "loading") return;
    set({ boardState: "loading" });
    try {
      set({ board: await api<FightLeaderboard>("/fight/leaderboard?limit=50"), boardState: "idle" });
    } catch {
      set({ boardState: "error" });
    }
  },
  setOpen: (open) => {
    set({ open });
    if (open) void get().loadBoard();
  },
}));

/** the rows of the skill report: label key, how to show a value, and whether higher is better */
export const SKILL_ROWS = [
  { k: "accuracy", label: "skill.accuracy", fmt: "pct", up: true },
  { k: "defencePct", label: "skill.defence", fmt: "pct", up: true },
  { k: "counters", label: "skill.counters", fmt: "n", up: true },
  { k: "controlS", label: "skill.control", fmt: "secs", up: true },
  { k: "perMin", label: "skill.output", fmt: "perMin", up: true },
  { k: "gassedS", label: "skill.stamina", fmt: "secs", up: false },
  { k: "diff", label: "skill.diff", fmt: "signed", up: true },
] as const;
export type SkillRow = (typeof SKILL_ROWS)[number];

/** how many skill rows I won against the opponent (ties don't count) */
export function skillEdge(p: SkillPair): { better: number; total: number } {
  let better = 0;
  for (const r of SKILL_ROWS) {
    if (r.k === "diff") continue;
    const a = p.mine[r.k];
    const b = p.theirs[r.k];
    if (r.up ? a > b : a < b) better++;
  }
  return { better, total: SKILL_ROWS.length - 1 };
}
