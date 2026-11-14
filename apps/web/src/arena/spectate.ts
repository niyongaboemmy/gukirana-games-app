"use client";
import { create } from "zustand";

/**
 * Spectator view while seated in the arena: "eye" puts the camera at your own eyes, aimed at the stage (your avatar
 * is hidden so nothing blocks the view); drag looks around, pinch / wheel zooms; "focus" zooms in on the podium.
 * Off = the usual over-the-shoulder view. A per-device choice.
 */
interface SpectateState {
  eye: boolean;
  focus: boolean;
  set: (p: Partial<Omit<SpectateState, "set">>) => void;
}
export const useSpectate = create<SpectateState>()((set) => ({ eye: true, focus: false, set }));
