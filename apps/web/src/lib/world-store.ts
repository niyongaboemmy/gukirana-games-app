"use client";
import { create } from "zustand";

export interface RemotePlayer {
  id: string;
  name: string;
  color: string;
  level: number;
  x: number;
  z: number;
  yaw: number;
  anim: number;
  emoteUntil?: number;
  /** Optional encoded avatar look (world/outfits.ts encodeLook); absent on older servers/clients. */
  look?: string;
  /** Server-side verified account (OTP); unverified players are not offered as interaction targets. */
  verified?: boolean;
  bodyType?: string;
}

export interface ChatLine {
  id: string;
  name: string;
  color: string;
  text: string;
  t: number;
  masked?: boolean;
  system?: boolean;
}

export type PortalId = "pool" | "ludo" | "igisoro" | "arena" | "soon-left" | "soon-right";

interface WorldState {
  connected: boolean;
  you: string | null;
  players: Record<string, RemotePlayer>;
  chat: ChatLine[];
  nearPortal: PortalId | null;
  nearPlayer: string | null;
  input: { x: number; y: number; run: boolean };
  emote: { id: number; until: number } | null;
  set: (p: Partial<WorldState>) => void;
  upsertPlayer: (p: Partial<RemotePlayer> & { id: string }) => void;
  removePlayer: (id: string) => void;
  pushChat: (c: ChatLine) => void;
}

export const useWorld = create<WorldState>()((set, get) => ({
  connected: false,
  you: null,
  players: {},
  chat: [],
  nearPortal: null,
  nearPlayer: null,
  input: { x: 0, y: 0, run: false },
  emote: null,
  set: (p) => set(p),
  upsertPlayer: (p) =>
    set({ players: { ...get().players, [p.id]: { ...(get().players[p.id] as RemotePlayer), ...p } } }),
  removePlayer: (id) => {
    const players = { ...get().players };
    delete players[id];
    set({ players });
  },
  pushChat: (c) => set({ chat: [...get().chat.slice(-49), c] }),
}));
