"use client";
import { useEffect, useState } from "react";
import { create } from "zustand";
import type { PlaceKind, PlaceMsg, PlaceState, SeatHolds } from "@gukirana/contracts";
import { notify } from "@/social/social-store";
import { useSession } from "./session";
import { pfill } from "./place-strings";

/**
 * Holding your place through a reload (P2-NET-06, docs/GAME-EXIT-RULES.md "Holding your place"). The SERVER keeps a
 * signed-in player's table chair / Boxing ring for a short hold when the connection ends without a deliberate leave;
 * this side only remembers where that was (`localStorage["gk-place"]`: hall, room id, chair or ring, state, stake, AI
 * level, times — no secrets), asks the server on load (`GET <realtime>/place`), goes back to that hall and starts the
 * player on that place. The hall room's `place` message (restored / released / none) has the last word.
 * Cleared on every deliberate leave (stand up, Leave, Cancel, step out), on a release and when a match starts.
 *
 * Kill switch: NEXT_PUBLIC_FF_PLACE_HOLD=0 (no restore on load; the server holds unless FF_PLACE_HOLD=0 there).
 */
export const PLACE_HOLD_ON = process.env.NEXT_PUBLIC_FF_PLACE_HOLD !== "0";

export interface PlaceRef {
  hall: string;
  roomId: string;
  kind: PlaceKind;
  /** chair id (t3s1) or ring id (R7) */
  place: string;
  state: PlaceState;
  stake?: number;
  game?: string;
  /** Boxing practice: the AI level */
  level?: number;
  /** when the player started waiting (this device's clock) */
  since: number;
  /** last saved / when the page went away (this device's clock) */
  at: number;
}
const KEY = "gk-place";
/** longer than any hold: a stale record is ignored */
const MAX_AGE_MS = 15 * 60_000;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const PLACE = /^(t\d{1,2}s\d|R\d{1,2})$/;

export function loadPlace(): PlaceRef | null {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? "null") as PlaceRef | null;
    if (!r || !ID.test(r.roomId) || !ID.test(r.hall) || !PLACE.test(r.place) || Date.now() - r.at > MAX_AGE_MS) return null;
    return r;
  } catch {
    return null;
  }
}
export function savePlace(ref: Omit<PlaceRef, "at" | "since"> & { since?: number }): void {
  if (!PLACE_HOLD_ON) return;
  const prev = loadPlace();
  const same = prev && prev.hall === ref.hall && prev.place === ref.place && prev.state === ref.state;
  const next: PlaceRef = { ...ref, since: ref.since ?? (same ? prev.since : Date.now()), at: Date.now() };
  if (same && prev.roomId === next.roomId && prev.stake === next.stake && prev.level === next.level && prev.since === next.since && Date.now() - prev.at < 5000) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
}
export function clearPlace(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
// the page goes away (reload, tab closed): stamp the time, so the hold is counted from here
if (typeof window !== "undefined")
  window.addEventListener("pagehide", () => {
    const r = loadPlace();
    if (r)
      try {
        localStorage.setItem(KEY, JSON.stringify({ ...r, at: Date.now() }));
      } catch {
        /* ignore */
      }
  });

/** what the server last said about my place, held chairs of this hall (local countdown ends) */
interface PlaceStore {
  /** the answer to `GET /place` on this page load (null = not asked / no answer yet) */
  checked: PlaceMsg | null;
  /** the hall room's `place` message on the current connection */
  joined: PlaceMsg | null;
  /** held chair → when its hold ends (this device's clock) */
  seatHolds: Record<string, number>;
}
export const usePlace = create<PlaceStore>()(() => ({ checked: null, joined: null, seatHolds: {} }));

/** "Table 4" / "Ring 7" */
export const placeName = (kind: PlaceKind, place: string) =>
  kind === "ring" ? pfill("place.ring", { n: place.slice(1) }) : pfill("place.table", { n: Number(place.slice(1, place.indexOf("s"))) + 1 });

function releasedText(m: Extract<PlaceMsg, { status: "released" }>): string {
  const place = placeName(m.kind, m.place);
  return m.reason === "LIMIT" ? pfill("place.releasedLimit", { place }) : pfill("place.released", { place, s: m.heldS });
}

/** the hall room's answer on join (lib/realtime) */
export function onPlaceMsg(m: PlaceMsg, hall: string | undefined): void {
  usePlace.setState({ joined: m });
  const local = loadPlace();
  if (m.status === "restored") {
    savePlace({ hall: m.hall, roomId: m.roomId, kind: m.kind, place: m.place, state: m.state, stake: m.stake, game: m.game, level: local?.place === m.place ? local.level : undefined, since: Date.now() - m.waitedMs });
    return;
  }
  // the notice once: only while this device still remembered the place (the page-load check may have shown it)
  if (m.status === "released" && local && local.place === m.place) notify(releasedText(m), undefined, 7000);
  if (local && (!hall || local.hall === hall)) clearPlace();
}

/** `seat-holds` (lib/realtime): ms left → local end times */
export function onSeatHolds(m: SeatHolds): void {
  const now = Date.now();
  const out: Record<string, number> = {};
  for (const [seat, ms] of Object.entries(m)) if (typeof ms === "number") out[seat] = now + ms;
  usePlace.setState({ seatHolds: out });
}

/** the hall room to rejoin first (the instance that holds my place), or null */
export function heldRoomFor(hall: string | undefined): string | null {
  const r = PLACE_HOLD_ON ? loadPlace() : null;
  return r && hall && r.hall === hall ? r.roomId : null;
}

function placeUrl(): string {
  const ws = process.env.NEXT_PUBLIC_REALTIME_URL ?? `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:2567`;
  return `${ws.replace(/^ws/, "http").replace(/\/$/, "")}/place`;
}

/** ask the realtime server whether I still hold a place (null: no answer) */
export async function findPlace(): Promise<PlaceMsg | null> {
  const token = useSession.getState().accessToken;
  if (!token) return null;
  const r = await fetch(placeUrl(), { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(4000) });
  if (!r.ok) return null;
  return (await r.json()) as PlaceMsg;
}

/**
 * Page load (root layout, after the live-match check): this device remembers a place → ask the server; still held →
 * the path of its hall (the hall then puts me on it); released → the notice. Returns the path to go to, or null.
 */
export async function resumePlace(path: string | null): Promise<string | null> {
  if (!PLACE_HOLD_ON) return null;
  const local = loadPlace();
  if (!local) return null;
  const m = await findPlace().catch(() => null);
  if (!m) return null;
  usePlace.setState({ checked: m });
  if (m.status === "held") {
    const to = `/room/${m.hall}`;
    return path === to ? null : to;
  }
  if (m.status === "released" && local.place === m.place) notify(releasedText(m), undefined, 7000);
  clearPlace();
  return null;
}

/**
 * Where to start in this hall after a reload: my place (still held as far as we know), or null (the door).
 * The server's page-load answer wins; without one, this device's record inside its hold time.
 */
export function placeToRestore(hall: string, holdMs: (r: PlaceRef) => number): PlaceRef | null {
  if (!PLACE_HOLD_ON) return null;
  const local = loadPlace();
  if (!local || local.hall !== hall) return null;
  const c = usePlace.getState().checked;
  if (c) return c.status === "held" && c.hall === hall && c.place === local.place ? local : null;
  return Date.now() - local.at < holdMs(local) ? local : null;
}

/** a clock that ticks every `ms` while `on` (countdowns) */
export function useNow(on: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [on, ms]);
  return now;
}
