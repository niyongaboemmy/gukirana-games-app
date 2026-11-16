import { HELD_SEAT, isValidSeat, RESERVED_SEAT_PREFIX, type HallId } from "@gukirana/contracts";

export type ClaimResult = "ok" | "taken" | "invalid";
const HELD_PREFIX = `${HELD_SEAT}:`;
const heldKey = (uid: string) => `${HELD_PREFIX}${uid}`;
/** P2-MM-05: a chair kept for a matched player on their way to the table (`~res:<uid>`, shown as-is in the map) */
const resKey = (uid: string) => `${RESERVED_SEAT_PREFIX}${uid}`;

/**
 * Server-claimed seats (hall chairs + plaza bench places): one person per seat, one seat per person.
 * Seat ids are validated against the shared list in @gukirana/contracts.
 */
export class SeatRegistry {
  private bySeat = new Map<string, string>();
  private bySession = new Map<string, string>();

  constructor(private readonly place: "plaza" | HallId) {}

  claim(seat: unknown, sessionId: string, uid?: string): ClaimResult {
    if (!isValidSeat(this.place, seat)) return "invalid";
    const holder = this.bySeat.get(seat);
    // a chair reserved for this account (matched, walking here) is theirs to take; nobody else's
    const mine = !!uid && holder === resKey(uid);
    if (holder && holder !== sessionId && !mine) return "taken";
    if (mine) {
      this.bySession.delete(resKey(uid));
      this.bySeat.delete(seat);
    }
    this.release(sessionId);
    this.bySeat.set(seat, sessionId);
    this.bySession.set(sessionId, seat);
    return "ok";
  }

  /** Frees the seat held by this session; true when something changed. */
  release(sessionId: string): boolean {
    const seat = this.bySession.get(sessionId);
    if (!seat) return false;
    this.bySession.delete(sessionId);
    this.bySeat.delete(seat);
    return true;
  }

  seatOf(sessionId: string): string | undefined {
    return this.bySession.get(sessionId);
  }

  /**
   * P2-NET-06: the session's chair is kept for its account (`~held:<uid>` holds it, so nobody else can claim it).
   * Returns the seat, or undefined when the session had none.
   */
  hold(sessionId: string, uid: string): string | undefined {
    const seat = this.bySession.get(sessionId);
    if (!seat) return undefined;
    const key = heldKey(uid);
    this.release(key);
    this.bySession.delete(sessionId);
    this.bySeat.set(seat, key);
    this.bySession.set(key, seat);
    return seat;
  }
  /** the account is back: its held chair belongs to the new session (undefined when nothing was held) */
  restore(uid: string, sessionId: string): string | undefined {
    const key = heldKey(uid);
    const seat = this.bySession.get(key);
    if (!seat) return undefined;
    this.release(sessionId);
    this.bySession.delete(key);
    this.bySeat.set(seat, sessionId);
    this.bySession.set(sessionId, seat);
    return seat;
  }
  /** the hold ran out: the chair is free again (true when something changed) */
  releaseHeld(uid: string): boolean {
    return this.release(heldKey(uid));
  }

  /** P2-MM-05: keep `seat` for `uid` (only a free chair, or the one already kept for them) */
  reserve(seat: string, uid: string): boolean {
    if (!isValidSeat(this.place, seat)) return false;
    const holder = this.bySeat.get(seat);
    if (holder && holder !== resKey(uid)) return false;
    this.release(resKey(uid));
    this.bySeat.set(seat, resKey(uid));
    this.bySession.set(resKey(uid), seat);
    return true;
  }
  /** the reservation ended (match started / called off): the chair is free again unless its player sits on it */
  releaseReserved(uid: string): boolean {
    return this.release(resKey(uid));
  }
  /** who holds `seat`: a session id, `~held:<uid>`, `~res:<uid>` or undefined */
  holderOf(seat: string): string | undefined {
    return this.bySeat.get(seat);
  }

  /** seat → holder session (a held chair shows HELD_SEAT, never the account id) */
  snapshot(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [seat, holder] of this.bySeat) out[seat] = holder.startsWith(HELD_PREFIX) ? HELD_SEAT : holder;
    return out;
  }
}
