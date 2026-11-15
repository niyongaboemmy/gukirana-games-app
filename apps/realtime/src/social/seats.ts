import { HELD_SEAT, isValidSeat, type HallId } from "@gukirana/contracts";

export type ClaimResult = "ok" | "taken" | "invalid";
const HELD_PREFIX = `${HELD_SEAT}:`;
const heldKey = (uid: string) => `${HELD_PREFIX}${uid}`;

/**
 * Server-claimed seats (hall chairs + plaza bench places): one person per seat, one seat per person.
 * Seat ids are validated against the shared list in @gukirana/contracts.
 */
export class SeatRegistry {
  private bySeat = new Map<string, string>();
  private bySession = new Map<string, string>();

  constructor(private readonly place: "plaza" | HallId) {}

  claim(seat: unknown, sessionId: string): ClaimResult {
    if (!isValidSeat(this.place, seat)) return "invalid";
    const holder = this.bySeat.get(seat);
    if (holder && holder !== sessionId) return "taken";
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

  /** seat → holder session (a held chair shows HELD_SEAT, never the account id) */
  snapshot(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [seat, holder] of this.bySeat) out[seat] = holder.startsWith(HELD_PREFIX) ? HELD_SEAT : holder;
    return out;
  }
}
