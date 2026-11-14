import { create } from "zustand";
import type { BoxingOutcome, FightEvent } from "@gukirana/contracts";
import type { FgKey } from "./strings";

/**
 * HUD-only state of the boxing client (not part of the bridge): the event feed the HUD shows (round cards, combo /
 * counter pops, warnings) and short local hints ("Too tired"). Filled by the practice loop and by the live client.
 */
export interface FightUi {
  /** recent events for the HUD (newest last) with a local receive time */
  feed: { e: FightEvent; at: number; id: number }[];
  /** the outcome once an `over` event arrived (result card) */
  result: BoxingOutcome | null;
  hintKey: FgKey | null;
  hintAt: number;
  push: (events: FightEvent[]) => void;
  hint: (k: FgKey) => void;
  clear: () => void;
}
let nextId = 1;
export const useFightUi = create<FightUi>()((set) => ({
  feed: [],
  result: null,
  hintKey: null,
  hintAt: 0,
  push: (events) =>
    set((s) => {
      const at = typeof performance !== "undefined" ? performance.now() : 0;
      const over = events.find((e) => e.k === "over");
      return {
        feed: [...s.feed, ...events.map((e) => ({ e, at, id: nextId++ }))].slice(-24),
        result: over && over.k === "over" ? over.result : s.result,
      };
    }),
  hint: (hintKey) => set({ hintKey, hintAt: typeof performance !== "undefined" ? performance.now() : 0 }),
  clear: () => set({ feed: [], result: null, hintKey: null, hintAt: 0 }),
}));
