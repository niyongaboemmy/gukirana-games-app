"use client";
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ActiveMatch, GameId } from "@gukirana/contracts";
import { api, useSession } from "./session";
import { rememberBeforeGame } from "./return-point";

/**
 * Resume after a reload, a closed tab or a lost connection (P2-NET-05). The match I am seated in is remembered in
 * localStorage (game, match id, room id, seat — no secrets: the Colyseus reconnection token stays in sessionStorage,
 * per tab, see LiveMatch) and cleared when the match ends. On every page load `useResume()` asks the API which live
 * match I am in (`GET /games/active`, my own seat only) and puts me straight back: a table game opens /match/<room>,
 * a fight goes to the Boxing hall (the hall re-sends my fight). The room's own checks decide the rest: the
 * reconnection token inside the wait, else a join with my access token (the room admits only the match's players).
 *
 * Kill switch: NEXT_PUBLIC_FF_RESUME=0.
 */
export const RESUME_ON = process.env.NEXT_PUBLIC_FF_RESUME !== "0";

export interface ActiveRef {
  matchId: string;
  roomId: string;
  game: GameId;
  seat?: number;
  /** when it was saved (ms); refs older than the longest match are ignored */
  at: number;
}
const KEY = "gk-active-match";
const MAX_AGE_MS = 4 * 3600_000;

export function saveActive(ref: Omit<ActiveRef, "at">): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...ref, at: Date.now() }));
  } catch {
    /* private mode */
  }
}
export function loadActive(): ActiveRef | null {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? "null") as ActiveRef | null;
    if (!r || typeof r.roomId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(r.roomId) || Date.now() - r.at > MAX_AGE_MS) return null;
    return r;
  } catch {
    return null;
  }
}
export function clearActive(matchId?: string): void {
  try {
    if (matchId && loadActive()?.matchId !== matchId) return;
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** where a live match is played */
export const matchPath = (game: GameId, roomId: string, stake?: number): string =>
  game === "boxing" ? "/room/boxing" : `/match/${roomId}?game=${game}${stake !== undefined ? `&stake=${stake}` : ""}`;

/** ask the server for my live match; the local ref fills in a room id the API doesn't have yet */
export async function findActive(): Promise<{ path: string; game: GameId } | null> {
  const r = await api<{ match: ActiveMatch | null }>("/games/active");
  const m = r.match;
  if (!m) {
    clearActive();
    return null;
  }
  const local = loadActive();
  const roomId = m.roomId ?? (local?.matchId === m.matchId ? local.roomId : null);
  if (!roomId && m.game !== "boxing") return null;
  return { path: matchPath(m.game, roomId ?? "", m.stake), game: m.game };
}

/** root layout: once per page load (and per sign-in), put the player back into their live match */
export function useResume(): void {
  const router = useRouter();
  const path = usePathname();
  const status = useSession((s) => s.status);
  const uid = useSession((s) => s.me?.id);
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!RESUME_ON || status !== "authenticated" || !uid || done.current === uid) return;
    done.current = uid;
    // already in the match (a reload of /match/<room>) or the hall that holds the fight: nothing to do
    if (path?.startsWith("/match/") || path === "/gate" || path?.startsWith("/console")) return;
    void findActive()
      .then((hit) => {
        if (!hit) return;
        if (hit.game === "boxing" && path === "/room/boxing") return;
        rememberBeforeGame();
        router.replace(hit.path);
      })
      .catch(() => undefined);
  }, [status, uid, path, router]);
}
