import type { GameId, MmPerson } from "@gukirana/contracts";

/**
 * Find-an-opponent queue (P2-MM-05, docs/MATCHMAKING-V2.md §3.1). Pure state machine, one per process, shared by
 * every plaza / hall room: a ticket is an ACCOUNT looking for a GAME at any of its STAKES (preferred first) — not a
 * table, not a room. Two tickets match when the game is the same and they share a stake; the pair gets an offer
 * ("Opponent found") both must accept within the accept window.
 *
 *   searching ──pair──▶ offered ──both accept──▶ (rendezvous, outside this class)
 *       ▲                  │ decline / timeout
 *       └── requeued ◀─────┘ (only the one who accepted / did not decline; the original waiting time is kept)
 *
 * Fair order: the longest-waiting compatible ticket is paired first, and the stake is the first one in ITS preference
 * list the newcomer also accepts. No randomness, no bots: only real tickets are ever paired.
 */

export interface Ticket extends MmPerson {
  game: GameId;
  /** accepted stakes, preferred first */
  stakes: number[];
  /** when the search started (kept across a widen and a requeue) */
  since: number;
  /** where this player would like to play (hall room + table / ring), when they chose one */
  venue?: { roomId: string; place?: string };
}

export interface Offer {
  id: string;
  game: GameId;
  stake: number;
  a: Ticket;
  b: Ticket;
  expires: number;
  accepted: Set<string>;
}

export type RespondResult =
  | { kind: "pending"; offer: Offer }
  | { kind: "accepted"; offer: Offer }
  | { kind: "declined"; offer: Offer; by: string; requeued: string[] };

export interface ExpiredOffer {
  offer: Offer;
  /** accepted in time: back in the queue */
  requeued: string[];
  /** never answered: out of the queue */
  dropped: string[];
}

export class MatchFinder {
  private queue: Ticket[] = [];
  private offers = new Map<string, Offer>();
  private seq = 0;

  constructor(
    private readonly acceptMs: number,
    /** the two accounts may not be paired (a block either way) */
    private readonly separated: (a: string, b: string) => boolean = () => false,
  ) {}

  /** start (or replace) this account's search; it is out of any open offer first */
  join(t: Ticket): void {
    this.dropTicket(t.uid);
    this.queue.push({ ...t, stakes: uniq(t.stakes) });
  }

  /** a widened search: new stakes, same place in the queue, same waiting time */
  widen(uid: string, stakes: number[]): Ticket | null {
    const t = this.queue.find((x) => x.uid === uid);
    if (!t) return null;
    t.stakes = uniq(stakes);
    return t;
  }

  /** cancel: out of the queue; an open offer counts as declined (the other one goes back to the queue) */
  leave(uid: string, now: number): RespondResult | null {
    this.dropTicket(uid);
    const o = this.offerOf(uid);
    return o ? this.respond(o.id, uid, false, now) : null;
  }

  /** pair every compatible couple (oldest first); returns the new offers */
  pairAll(now: number): Offer[] {
    const out: Offer[] = [];
    const sorted = [...this.queue].sort((x, y) => x.since - y.since);
    const taken = new Set<string>();
    for (const older of sorted) {
      if (taken.has(older.uid)) continue;
      for (const newer of sorted) {
        if (newer === older || taken.has(newer.uid) || newer.uid === older.uid || newer.game !== older.game) continue;
        if (this.separated(older.uid, newer.uid)) continue;
        const stake = older.stakes.find((s) => newer.stakes.includes(s));
        if (stake === undefined) continue;
        taken.add(older.uid);
        taken.add(newer.uid);
        const offer: Offer = { id: `f${++this.seq}`, game: older.game, stake, a: older, b: newer, expires: now + this.acceptMs, accepted: new Set() };
        this.offers.set(offer.id, offer);
        out.push(offer);
        break;
      }
    }
    if (taken.size) this.queue = this.queue.filter((t) => !taken.has(t.uid));
    return out;
  }

  respond(id: string, uid: string, accept: boolean, now: number): RespondResult | null {
    const o = this.offers.get(id);
    if (!o || (o.a.uid !== uid && o.b.uid !== uid)) return null;
    if (now > o.expires) return null; // the sweep closes it
    if (!accept) {
      this.offers.delete(id);
      const other = o.a.uid === uid ? o.b : o.a;
      this.requeue(other);
      return { kind: "declined", offer: o, by: uid, requeued: [other.uid] };
    }
    o.accepted.add(uid);
    if (o.accepted.size < 2) return { kind: "pending", offer: o };
    this.offers.delete(id);
    return { kind: "accepted", offer: o };
  }

  /** offers past their accept window */
  sweep(now: number): ExpiredOffer[] {
    const out: ExpiredOffer[] = [];
    for (const o of [...this.offers.values()]) {
      if (now <= o.expires) continue;
      this.offers.delete(o.id);
      const requeued: string[] = [];
      const dropped: string[] = [];
      for (const t of [o.a, o.b]) {
        if (o.accepted.has(t.uid)) {
          this.requeue(t);
          requeued.push(t.uid);
        } else dropped.push(t.uid);
      }
      out.push({ offer: o, requeued, dropped });
    }
    return out;
  }

  ticketOf(uid: string): Ticket | undefined {
    return this.queue.find((t) => t.uid === uid);
  }
  offerOf(uid: string): Offer | undefined {
    for (const o of this.offers.values()) if (o.a.uid === uid || o.b.uid === uid) return o;
    return undefined;
  }
  /** searching or in an open offer */
  active(uid: string): boolean {
    return !!this.ticketOf(uid) || !!this.offerOf(uid);
  }

  /** people searching `game`, per stake they accept (a ticket accepting 3 stakes counts once under each) */
  counts(game: GameId, except?: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const t of this.queue) {
      if (t.game !== game || t.uid === except) continue;
      for (const s of t.stakes) out[s] = (out[s] ?? 0) + 1;
    }
    return out;
  }
  /** everyone searching (lobby counters, venues) */
  tickets(): readonly Ticket[] {
    return this.queue;
  }

  private requeue(t: Ticket) {
    this.dropTicket(t.uid);
    this.queue.push(t); // `since` kept: pairAll sorts by it, so they are first in line again
  }
  private dropTicket(uid: string) {
    this.queue = this.queue.filter((t) => t.uid !== uid);
  }
}

const uniq = (xs: number[]) => [...new Set(xs)];
