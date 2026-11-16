/**
 * The hall instance the matchmaker reserved my place in (P2-MM-05): the next hall join for that game goes to this room
 * first (like a held place, lib/place-hold `heldRoomFor`), so I arrive where my table is kept. Session storage: it
 * survives the page change into the hall, never another tab; stale after the meeting's time.
 */
const KEY = "gk-mm-target";
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function setMmTarget(hall: string, roomId: string, ms: number): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ hall, roomId, until: Date.now() + ms }));
  } catch {
    /* private mode: the normal join (usually the same single hall instance) */
  }
}
export function clearMmTarget(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
export function mmRoomFor(hall: string | undefined): string | null {
  try {
    const t = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as { hall: string; roomId: string; until: number } | null;
    if (!t || t.hall !== hall || !ID.test(t.roomId) || Date.now() > t.until) return null;
    return t.roomId;
  } catch {
    return null;
  }
}
