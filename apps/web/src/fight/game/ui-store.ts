import { create } from "zustand";
import type { FightEvent } from "@gukirana/contracts";
import type { FgKey } from "./strings";

/**
 * HUD-only state of the boxing client (not part of the bridge): the event feed the HUD shows (round cards, combo /
 * counter pops, warnings) and short local hints ("Too tired"). Filled by the practice loop and by the live client.
 */
export interface FightUi {
  /** recent events for the HUD (newest last) with a local receive time */
  feed: { e: FightEvent; at: number; id: number }[];
  hintKey: FgKey | null;
  hintAt: number;
  push: (events: FightEvent[]) => void;
  hint: (k: FgKey) => void;
  clear: () => void;
}
let nextId = 1;
export const useFightUi = create<FightUi>()((set) => ({
  feed: [],
  hintKey: null,
  hintAt: 0,
  push: (events) =>
    set((s) => {
      const at = typeof performance !== "undefined" ? performance.now() : 0;
      return { feed: [...s.feed, ...events.map((e) => ({ e, at, id: nextId++ }))].slice(-24) };
    }),
  hint: (hintKey) => set({ hintKey, hintAt: typeof performance !== "undefined" ? performance.now() : 0 }),
  clear: () => set({ feed: [], hintKey: null, hintAt: 0 }),
}));
