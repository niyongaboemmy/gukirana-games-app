"use client";
import { create } from "zustand";

interface RoomState {
  nearSeat: string | null;
  seated: string | null;
  doorOpen: boolean;
  set: (p: Partial<Omit<RoomState, "set">>) => void;
}
export const useRoom = create<RoomState>()((set) => ({ nearSeat: null, seated: null, doorOpen: false, set }));
