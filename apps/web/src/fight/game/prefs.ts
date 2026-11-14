"use client";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Boxing settings on this device (FIGHT-GAMES-PLAN §2.9). Presentation and controls only: nothing here changes the
 * rules. `speed` (training speed) applies to practice only; live fights always tick at 30 Hz.
 */
export type ButtonSize = "s" | "m" | "l";
export type TrainingSpeed = "slow" | "normal";
export interface FightPrefsData {
  sound: boolean;
  vibration: boolean;
  /** tap the guard pad to toggle instead of holding it */
  guardToggle: boolean;
  buttonSize: ButtonSize;
  /** mirror the pads: punches on the left thumb, guard on the right */
  leftHanded: boolean;
  /** no camera shake / hit zoom (W reads it for the fight camera) */
  reducedMotion: boolean;
  speed: TrainingSpeed;
}
interface FightPrefs extends FightPrefsData {
  set: (p: Partial<FightPrefsData>) => void;
}
export const DEFAULT_FIGHT_PREFS: FightPrefsData = {
  sound: true,
  vibration: true,
  guardToggle: false,
  buttonSize: "l",
  leftHanded: false,
  reducedMotion: false,
  speed: "normal",
};

export const useFightPrefs = create<FightPrefs>()(
  persist((set) => ({ ...DEFAULT_FIGHT_PREFS, set: (p) => set(p) }), {
    name: "gk-fight-prefs",
    storage: createJSONStorage(() => localStorage),
    partialize: ({ set: _set, ...rest }) => rest,
  }),
);

/** practice tick rate in wall time (rules per tick are the same; only the pace changes) */
export const practiceHz = (speed: TrainingSpeed): number => (speed === "slow" ? 20 : 30);
/** pad button sizes (px) — large by default for phones */
export const BUTTON_PX: Record<ButtonSize, number> = { s: 64, m: 78, l: 92 };
