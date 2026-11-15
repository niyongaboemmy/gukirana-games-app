"use client";
import { create } from "zustand";
import type { RingId } from "@gukirana/contracts";

/** world-side UI state of the Boxing hall (which ring you stand by, camera choices) */
interface FightUi {
  /** the ring whose steps / rail you stand at (prompt target) */
  near: RingId | null;
  /** watching a ring: the camera you picked (null = your normal follow camera) */
  watchCam: "rail" | "overhead" | null;
  /** in your own fight: the side broadcast camera (default), over the shoulder, or auto (P3-FGT-09) */
  fightCam: "fight" | "behind" | "auto";
  set: (p: Partial<Omit<FightUi, "set">>) => void;
}
export const useFightUi = create<FightUi>()((set) => ({ near: null, watchCam: null, fightCam: "fight", set }));
