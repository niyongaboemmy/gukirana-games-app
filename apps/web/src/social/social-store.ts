"use client";
import { create } from "zustand";

/** Social UI state: chat tabs + DM threads, speech bubbles, the person menu, blocks, calls, notices. */
export interface DmLine {
  mid: string;
  mine: boolean;
  text: string;
  t: number;
  masked?: boolean;
}
export interface Thread {
  peer: string; // session id
  name: string;
  color: string;
  uid?: string;
  lines: DmLine[];
  unread: number;
  /** incoming = they asked to chat (Accept / Block); outgoing = waiting for them to accept */
  request: "incoming" | "outgoing" | null;
  gone?: boolean;
}
export interface PersonCard {
  id: string;
  name: string;
  color: string;
  level: number;
  uid?: string;
}
export interface BlockedPerson {
  key: string; // u:<uid> | s:<sid>
  name: string;
  uid?: string;
}
export type ChatTab = "nearby" | "room" | "private";
export interface CallState {
  status: "idle" | "outgoing" | "incoming" | "active";
  id?: string;
  peer?: PersonCard;
  since?: number;
}
export interface Notice {
  id: number;
  text: string;
  /** optional quick action (e.g. Wave back) */
  action?: { label: string; run: () => void };
}

interface SocialState {
  chatOpen: boolean;
  tab: ChatTab;
  thread: string | null;
  threads: Record<string, Thread>;
  bubbles: Record<string, { text: string; t: number }>;
  menu: string | null;
  peopleOpen: boolean;
  blocked: BlockedPerson[];
  volume: Record<string, number>;
  call: CallState;
  notices: Notice[];
  emoteReadyAt: number;
  /** plaza bench: my seat and the nearest free place */
  seated: string | null;
  nearSeat: string | null;
  nearbyCount: number;
  /** someone to challenge (opens the MatchmakingPanel sheet) */
  challenge: { id: string; name: string } | null;
  set: (p: Partial<SocialState>) => void;
}

export const useSocial = create<SocialState>()((set) => ({
  chatOpen: false,
  tab: "nearby",
  thread: null,
  threads: {},
  bubbles: {},
  menu: null,
  peopleOpen: false,
  blocked: [],
  volume: {},
  call: { status: "idle" },
  notices: [],
  emoteReadyAt: 0,
  seated: null,
  nearSeat: null,
  nearbyCount: 0,
  challenge: null,
  set: (p) => set(p),
}));

let noticeSeq = 0;
export function notify(text: string, action?: Notice["action"], ms = 5000): void {
  const id = ++noticeSeq;
  useSocial.setState((s) => ({ notices: [...s.notices.slice(-2), { id, text, action }] }));
  setTimeout(() => useSocial.setState((s) => ({ notices: s.notices.filter((n) => n.id !== id) })), ms);
}

export function addDm(peer: { id: string; name: string; color: string; uid?: string }, line: DmLine, request: Thread["request"] | undefined): void {
  useSocial.setState((s) => {
    const prev = s.threads[peer.id];
    const viewing = s.chatOpen && s.tab === "private" && s.thread === peer.id;
    const t: Thread = {
      peer: peer.id,
      name: peer.name || prev?.name || "",
      color: peer.color || prev?.color || "#3DA9FC",
      uid: peer.uid ?? prev?.uid,
      lines: [...(prev?.lines ?? []), line].slice(-100),
      unread: (prev?.unread ?? 0) + (line.mine || viewing ? 0 : 1),
      request: request === undefined ? (prev?.request ?? null) : request,
    };
    return { threads: { ...s.threads, [peer.id]: t } };
  });
}

export function openThread(peer: { id: string; name: string; color: string; uid?: string }): void {
  useSocial.setState((s) => {
    const prev = s.threads[peer.id];
    const t: Thread = prev ? { ...prev, unread: 0 } : { peer: peer.id, name: peer.name, color: peer.color, uid: peer.uid, lines: [], unread: 0, request: null };
    return { threads: { ...s.threads, [peer.id]: t }, chatOpen: true, tab: "private", thread: peer.id, menu: null };
  });
}

export const totalUnread = (threads: Record<string, Thread>) => Object.values(threads).reduce((n, t) => n + t.unread, 0);

export function showBubble(id: string, text: string): void {
  useSocial.setState((s) => ({ bubbles: { ...s.bubbles, [id]: { text, t: Date.now() } } }));
}

/** Blocked list persists per device for guests and as a cache for signed-in users (the API is the source). */
const BLOCK_KEY = "gk-blocked";
export function loadLocalBlocks(): BlockedPerson[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(BLOCK_KEY) ?? "[]") as BlockedPerson[];
    return Array.isArray(v) ? v.filter((b) => typeof b?.key === "string").slice(0, 500) : [];
  } catch {
    return [];
  }
}
export function saveLocalBlocks(list: BlockedPerson[]): void {
  try {
    // guests' session-only blocks are not worth keeping across sessions
    window.localStorage.setItem(BLOCK_KEY, JSON.stringify(list.filter((b) => b.key.startsWith("u:"))));
  } catch {
    /* private mode */
  }
}
