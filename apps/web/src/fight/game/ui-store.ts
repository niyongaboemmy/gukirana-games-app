import { create } from "zustand";
import type { BoxingAction, BoxingOutcome, FightEvent } from "@gukirana/contracts";
import type { FgKey } from "./strings";

/**
 * HUD-only state of the boxing client (not part of the bridge): the event feed the HUD shows (round cards, combo /
 * counter pops, warnings), short local hints ("Too tired"), and the press feedback (P3-FGT-05): every press shows at
 * once (pending), then turns confirmed when the engine shows the act, or dropped when it never does.
 */
export type PressState = "pending" | "confirmed" | "buffered" | "dropped";
export interface PressFx {
  a: BoxingAction | "guard";
  at: number;
  n: number;
  state: PressState;
  /** the device that sent it (tutorial / analytics of the scheme) */
  via: "key" | "mouse" | "pad" | "touch";
}
export interface FightUi {
  /** recent events for the HUD (newest last) with a local receive time */
  feed: { e: FightEvent; at: number; id: number }[];
  /** the outcome once an `over` event arrived (result card) */
  result: BoxingOutcome | null;
  hintKey: FgKey | null;
  hintAt: number;
  press: PressFx | null;
  /** the last referee / corner line (captions; spoken too when voices are on) */
  caption: { text: string; who: "referee" | "corner"; at: number } | null;
  captionSet: (text: string, who: "referee" | "corner") => void;
  /** actions the player has done this session (tutorial steps) */
  done: Partial<Record<BoxingAction | "guard", number>>;
  push: (events: FightEvent[]) => void;
  hint: (k: FgKey) => void;
  pressed: (a: BoxingAction | "guard", via: PressFx["via"]) => void;
  confirm: (state: PressState) => void;
  clear: () => void;
}
let nextId = 1;
let pressN = 0;
const clock = () => (typeof performance !== "undefined" ? performance.now() : 0);
export const useFightUi = create<FightUi>()((set) => ({
  feed: [],
  result: null,
  hintKey: null,
  hintAt: 0,
  press: null,
  done: {},
  push: (events) =>
    set((s) => {
      const at = clock();
      const over = events.find((e) => e.k === "over");
      return {
        feed: [...s.feed, ...events.map((e) => ({ e, at, id: nextId++ }))].slice(-24),
        result: over && over.k === "over" ? over.result : s.result,
      };
    }),
  hint: (hintKey) => set({ hintKey, hintAt: clock() }),
  caption: null,
  captionSet: (text, who) => set({ caption: { text, who, at: clock() } }),
  pressed: (a, via) => set((s) => ({ press: { a, at: clock(), n: ++pressN, state: "pending", via }, done: { ...s.done, [a]: (s.done[a] ?? 0) + 1 } })),
  confirm: (state) => set((s) => (s.press && s.press.state !== state ? { press: { ...s.press, state } } : s)),
  clear: () => set({ feed: [], result: null, hintKey: null, hintAt: 0, press: null, caption: null }),
}));
