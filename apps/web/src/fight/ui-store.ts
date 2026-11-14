"use client";
import { create } from "zustand";
import type { RingId } from "@gukirana/contracts";

/** world-side UI state of the Boxing hall (which ring you stand by, camera choices) */
interface FightUi {
  /** the ring whose steps / rail you stand at (prompt target) */
  near: RingId | null;
  /** watching a ring: the camera you picked (null = your normal follow camera) */
  watchCam: "rail" | "overhead" | null;
  /** in your own fight: the fight camera or the over-the-shoulder one */
  fightCam: "fight" | "behind";
  set: (p: Partial<Omit<FightUi, "set">>) => void;
}
export const useFightUi = create<FightUi>()((set) => ({ near: null, watchCam: null, fightCam: "fight", set }));
