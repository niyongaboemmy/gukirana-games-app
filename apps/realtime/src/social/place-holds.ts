import { PLACE_HOLD, type HallId, type PlaceInfo, type PlaceKind, type PlaceMsg, type PlaceReleaseReason, type PlaceState } from "@gukirana/contracts";


/**
 * Holding your place through a reload (P2-NET-06, docs/GAME-EXIT-RULES.md "Holding your place"): one in-process
 * registry of the places kept for signed-in players whose hall connection ended without a deliberate leave.
 *
 * Keyed by ACCOUNT id (never a session): only the same user gets the place back. The hall rooms do the effects
 * (seat map, ring registry, timers); this registry is the shared truth they and `GET /place` read: the hold itself,
 * the per-account abuse counter (PLACE_HOLD.maxHolds in windowMinutes) and the recent releases for the notice.
 * Holds never touch money: nothing here (or in the rooms' hold paths) creates a match or locks a stake.
 */

/** knobs tests shorten / switch (FF_PLACE_HOLD=0 turns holds off: every leave releases at once, as before) */
export const placeHoldConfig = {
  enabled: process.env.FF_PLACE_HOLD !== "0",
  seatMs: PLACE_HOLD.seatSeconds * 1000,
  ringWaitingMs: PLACE_HOLD.ringWaitingSeconds * 1000,
  ringPracticeMs: PLACE_HOLD.ringPracticeSeconds * 1000,
  maxHolds: PLACE_HOLD.maxHolds as number,
  windowMs: PLACE_HOLD.windowMinutes * 60_000,
  noticeMs: PLACE_HOLD.noticeMinutes * 60_000,
  /** back within this time (a plain reload): the hold is not counted against the abuse limit */
  quickMs: PLACE_HOLD.quickReturnSeconds * 1000,
};

/** the hold time for a place in this state */
export function holdMsFor(kind: PlaceKind, state: PlaceState): number {
  if (kind === "seat") return placeHoldConfig.seatMs;
  return state === "practice" ? placeHoldConfig.ringPracticeMs : placeHoldConfig.ringWaitingMs;
}

export interface Hold extends Omit<PlaceInfo, "waitedMs"> {
  uid: string;
  /** when the player took the place / started waiting (server ms) */
  since: number;
  /** when the hold began and ends (server ms) */
  at: number;
  until: number;
}
interface Released {
  hall: HallId;
  kind: PlaceKind;
  place: string;
  reason: PlaceReleaseReason;
  heldS: number;
  at: number;
}

export class PlaceHolds {
  private holds = new Map<string, Hold>();
  private history = new Map<string, number[]>();
  private released = new Map<string, Released>();

  /** may this account start another hold now? (counts it when yes) */
  allow(uid: string, now = Date.now()): boolean {
    const w = placeHoldConfig.windowMs;
    const xs = (this.history.get(uid) ?? []).filter((t) => now - t < w);
    if (xs.length >= placeHoldConfig.maxHolds) {
      this.history.set(uid, xs);
      return false;
    }
    xs.push(now);
    this.history.set(uid, xs);
    return true;
  }

  put(h: Hold): void {
    this.holds.set(h.uid, h);
    this.released.delete(h.uid);
  }

  /** the account's live hold (an expired one is dropped here too) */
  of(uid: string, now = Date.now()): Hold | undefined {
    const h = this.holds.get(uid);
    if (h && h.until <= now) return undefined; // the room's timer releases it (and records the notice)
    return h;
  }

  /**
   * take the hold back (the player is here again); undefined when there is none in this room. A quick return (a plain
   * reload, within quickMs) blocked nothing, so it does not count against the abuse limit.
   */
  take(uid: string, roomId: string, now = Date.now()): Hold | undefined {
    const h = this.of(uid, now);
    if (!h || h.roomId !== roomId) return undefined;
    this.holds.delete(uid);
    if (now - h.at <= placeHoldConfig.quickMs) {
      const xs = this.history.get(uid) ?? [];
      const i = xs.findLastIndex((t) => Math.abs(t - h.at) < 1000); // counted by allow() just before the hold began
      if (i >= 0) xs.splice(i, 1);
    }
    return h;
  }

  /** drop the hold (ran out / released by the room); the room records the notice with `noteReleased` */
  drop(uid: string, only?: Hold): Hold | undefined {
    const h = this.holds.get(uid);
    if (!h || (only && h !== only)) return undefined;
    this.holds.delete(uid);
    return h;
  }

  /** remember a released place for the notice (expiry, or the abuse limit at the leave itself) */
  noteReleased(uid: string, r: Omit<Released, "at">, now = Date.now()): void {
    this.released.set(uid, { ...r, at: now });
  }

  /** the notice for a returning player, once (null when nothing was released recently) */
  takeReleased(uid: string, now = Date.now()): Omit<Released, "at"> | null {
    const r = this.released.get(uid);
    if (!r) return null;
    this.released.delete(uid);
    if (now - r.at > placeHoldConfig.noticeMs) return null;
    const { at: _at, ...rest } = r;
    void _at;
    return rest;
  }
  peekReleased(uid: string, now = Date.now()): Omit<Released, "at"> | null {
    const r = this.released.get(uid);
    if (!r || now - r.at > placeHoldConfig.noticeMs) return null;
    const { at: _at, ...rest } = r;
    void _at;
    return rest;
  }

  /** holds kept by one room (it stays alive while there are any) */
  inRoom(roomId: string): number {
    let n = 0;
    for (const h of this.holds.values()) if (h.roomId === roomId) n++;
    return n;
  }

  /** `GET /place`: what the server keeps for this account right now */
  view(uid: string, now = Date.now()): PlaceMsg {
    const h = this.of(uid, now);
    if (h) return { status: "held", ms: h.until - now, ...info(h, now) };
    const r = this.peekReleased(uid, now);
    if (r) return { status: "released", ...r };
    return { status: "none" };
  }

  /** tests */
  reset(): void {
    this.holds.clear();
    this.history.clear();
    this.released.clear();
  }
}

/** the wire shape of a hold (no account id) */
export function info(h: Hold, now = Date.now()): PlaceInfo {
  return {
    hall: h.hall,
    roomId: h.roomId,
    kind: h.kind,
    place: h.place,
    state: h.state,
    ...(h.stake !== undefined ? { stake: h.stake } : {}),
    ...(h.game !== undefined ? { game: h.game } : {}),
    waitedMs: Math.max(0, now - h.since),
  };
}

export const placeHolds = new PlaceHolds();
