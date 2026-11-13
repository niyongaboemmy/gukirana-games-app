"use client";
import { create } from "zustand";

interface RoomState {
  nearSeat: string | null;
  seated: string | null;
  doorOpen: boolean;
  /** the player asked to leave: the controller walks them out through the door */
  leaving: boolean;
  /** standing near the exit, inside */
  nearExit: boolean;
  set: (p: Partial<Omit<RoomState, "set">>) => void;
}
export const useRoom = create<RoomState>()((set) => ({ nearSeat: null, seated: null, doorOpen: false, leaving: false, nearExit: false, set }));
