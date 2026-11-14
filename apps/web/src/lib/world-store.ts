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
  /** Account id of signed-in players (public profile lookups, persistent blocks). */
  uid?: string;
}

export interface ChatLine {
  id: string;
  name: string;
  color: string;
  text: string;
  t: number;
  masked?: boolean;
  system?: boolean;
  /** "nearby" (≈12 m, speech bubbles) or "room" (whole plaza / hall); system lines have none */
  scope?: "nearby" | "room";
}

/**
 * Local avatar pose, written every frame by the player controller (non-reactive, for audio).
 * Remote players' `x`/`z` in `players` are kept equal to their RENDERED (interpolated) pose by social/motion.ts,
 * updated in place so movement never re-renders React; reactive consumers only re-render on join/leave/meta.
 */
export const selfPose = { x: 0, z: 16, yaw: Math.PI };

export type PortalId = "pool" | "ludo" | "igisoro" | "admin" | "arena" | "soon-left" | "soon-right" | "soon-sw" | "soon-se";

interface WorldState {
  connected: boolean;
  you: string | null;
  players: Record<string, RemotePlayer>;
  chat: ChatLine[];
  nearPortal: PortalId | null;
  nearPlayer: string | null;
  /** Local player stands at the exit / sign-out kiosk inside the plaza entry gate. */
  nearGateExit: boolean;
  input: { x: number; y: number; run: boolean };
  emote: { id: number; until: number } | null;
  /** walking pace chosen by the player (persisted) */
  speed: "slow" | "normal" | "fast";
  /** hall interiors: seatId → sessionId */
  seats: Record<string, string>;
  seatTaken: number;
  set: (p: Partial<WorldState>) => void;
  upsertPlayer: (p: Partial<RemotePlayer> & { id: string }) => void;
  removePlayer: (id: string) => void;
  pushChat: (c: ChatLine) => void;
}

/** Walking pace saved in the browser (guarded: Node 25 exposes a non-functional localStorage during SSR). */
function savedSpeed(): "slow" | "normal" | "fast" {
  try {
    if (typeof window === "undefined") return "slow";
    const v = window.localStorage.getItem("gk-speed");
    return v === "normal" || v === "fast" ? v : "slow";
  } catch {
    return "slow";
  }
}

export const useWorld = create<WorldState>()((set, get) => ({
  connected: false,
  you: null,
  players: {},
  chat: [],
  nearPortal: null,
  nearPlayer: null,
  nearGateExit: false,
  input: { x: 0, y: 0, run: false },
  emote: null,
  seats: {},
  seatTaken: 0,
  speed: savedSpeed(),
  set: (p) => set(p),
  upsertPlayer: (p) =>
    set({ players: { ...get().players, [p.id]: { ...(get().players[p.id] as RemotePlayer), ...p } } }),
  removePlayer: (id) => {
    const players = { ...get().players };
    delete players[id];
    set({ players });
  },
  pushChat: (c) => set({ chat: [...get().chat.slice(-119), c] }),
}));
