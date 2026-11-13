"use client";
import { create } from "zustand";

/**
 * Walk-through door transition: the player controller sets `entering` when the avatar crosses an open arena
 * doorway; the world overlay fades to black and navigates to the room route.
 */
interface TransitionState {
  entering: string | null;
  enter: (href: string) => void;
  reset: () => void;
}

export const useTransition = create<TransitionState>()((set, get) => ({
  entering: null,
  enter: (href) => {
    if (!get().entering) set({ entering: href });
  },
  reset: () => set({ entering: null }),
}));

/** Per-door open amount (0 closed … 1 open), written by the doors, read by the player's collision code. */
export const doorOpen: Record<string, number> = {};

/** Per-door "keep open until" (performance.now ms): a person about to step out of that hall (the sensor can't see them). */
export const doorHold: Record<string, number> = {};
