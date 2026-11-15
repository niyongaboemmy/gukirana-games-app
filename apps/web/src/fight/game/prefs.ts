"use client";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { KeyBinds } from "./input-map";

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
  /** the player's own key bindings (P3-FGT-05; the defaults stay where free) */
  keys: KeyBinds;
  /** the first-fight tutorial was finished or skipped */
  tutorialDone: boolean;
  /** referee / corner voice lines (spoken, with captions) */
  voice: boolean;
  /** in-fight coach tips (idle, missing, hitting the guard, out of breath; P3-FGT-07) */
  coach: boolean;
  /** the crowd ambience */
  crowd: boolean;
  /** Easy mode in practice (P3-FGT-09): auto-guard, forgiving timing, step in to punch. Never in live fights. */
  assist: boolean;
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
  keys: {},
  tutorialDone: false,
  voice: true,
  crowd: true,
  coach: true,
  assist: true,
};

export const useFightPrefs = create<FightPrefs>()(
  persist((set) => ({ ...DEFAULT_FIGHT_PREFS, set: (p) => set(p) }), {
    name: "gk-fight-prefs",
    storage: createJSONStorage(() => localStorage),
    partialize: (s): FightPrefsData => ({
      sound: s.sound,
      vibration: s.vibration,
      guardToggle: s.guardToggle,
      buttonSize: s.buttonSize,
      leftHanded: s.leftHanded,
      reducedMotion: s.reducedMotion,
      speed: s.speed,
      keys: s.keys,
      tutorialDone: s.tutorialDone,
      voice: s.voice,
      crowd: s.crowd,
      coach: s.coach,
      assist: s.assist,
    }),
  }),
);

/** practice tick rate in wall time (rules per tick are the same; only the pace changes) */
export const practiceHz = (speed: TrainingSpeed): number => (speed === "slow" ? 20 : 30);
/** pad button sizes (px) — large by default for phones */
export const BUTTON_PX: Record<ButtonSize, number> = { s: 64, m: 78, l: 92 };
