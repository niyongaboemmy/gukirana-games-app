"use client";
import { create } from "zustand";
import type { ArrivalKind } from "./arrival";

interface RoomState {
  nearSeat: string | null;
  seated: string | null;
  doorOpen: boolean;
  /** the player asked to leave: the controller walks them out through the door */
  leaving: boolean;
  /** standing near the exit, inside */
  nearExit: boolean;
  /** how you came into the hall on screen (rooms/arrival): the HUD's welcome hint is for walking IN only */
  arrival: ArrivalKind | null;
  set: (p: Partial<Omit<RoomState, "set">>) => void;
}
export const useRoom = create<RoomState>()((set) => ({ nearSeat: null, seated: null, doorOpen: false, leaving: false, nearExit: false, arrival: null, set }));
