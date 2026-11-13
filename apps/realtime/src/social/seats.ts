import { isValidSeat, type HallId } from "@gukirana/contracts";

export type ClaimResult = "ok" | "taken" | "invalid";

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

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.bySeat);
  }
}
