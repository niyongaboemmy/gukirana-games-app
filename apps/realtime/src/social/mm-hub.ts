import type { MmPerson, VenueStatus } from "@gukirana/contracts";

/**
 * Who is where, across every plaza / hall room of this process (P2-MM-05). Rooms register each signed-in session and
 * each game hall; the matchmaking service (matchmaker-v2.ts) reaches an account in whatever room it is in, checks
 * blocks between two accounts, and reserves a table / ring in a hall. In-process for now, like the v1 queue (a
 * multi-node deployment moves this to Valkey, P1-MM-01).
 */
export interface SessionPort {
  sid: string;
  roomId: string;
  /** the hall this session is in (null = the plaza) */
  hall: string | null;
  send(type: string, msg: unknown): void;
  /** this session's block keys (`u:<accountId>` / `s:<sessionId>`) */
  blocks(): Iterable<string>;
  person(): MmPerson;
}

export interface Reservation {
  table: string;
  /** account → its chair at that table */
  seats: Record<string, string>;
  /** accounts already sitting on their chair */
  seated: string[];
}

export interface HallPort {
  roomId: string;
  game: "igisoro" | "ludo" | "pool" | "boxing";
  /** table / ring id → status (missing = free) */
  places(): Record<string, VenueStatus>;
  /** table halls: reserve a table for these accounts (preferring `want`, then a table one of them sits at) */
  reserve?(uids: string[], want?: string): Reservation | null;
  /** table halls: free the reserved chairs of these accounts */
  release?(uids: string[]): void;
  /** Boxing: a free ring + the fight for these two accounts (both must be in this hall); throws the refusal */
  assignBoxing?(a: string, b: string, stake: number): Promise<unknown>;
  /** keep the room alive while it holds a reservation */
  keepAlive(on: boolean): void;
}

export class MmHub {
  private sessions = new Map<string, Map<string, SessionPort>>();
  private halls = new Map<string, HallPort>();

  register(uid: string, port: SessionPort): () => void {
    let m = this.sessions.get(uid);
    if (!m) this.sessions.set(uid, (m = new Map()));
    m.set(port.sid, port);
    return () => {
      const s = this.sessions.get(uid);
      if (!s || s.get(port.sid) !== port) return;
      s.delete(port.sid);
      if (!s.size) this.sessions.delete(uid);
    };
  }
  addHall(port: HallPort): () => void {
    this.halls.set(port.roomId, port);
    return () => {
      if (this.halls.get(port.roomId) === port) this.halls.delete(port.roomId);
    };
  }

  online(uid: string): boolean {
    return (this.sessions.get(uid)?.size ?? 0) > 0;
  }
  /** the account's sessions (several tabs / a hall change in flight) */
  sessionsOf(uid: string): SessionPort[] {
    return [...(this.sessions.get(uid)?.values() ?? [])];
  }
  /** the most recent session (its room is "where they are") */
  latest(uid: string): SessionPort | undefined {
    return this.sessionsOf(uid).at(-1);
  }
  inRoom(uid: string, roomId: string): SessionPort | undefined {
    return this.sessionsOf(uid).find((s) => s.roomId === roomId);
  }
  send(uid: string, type: string, msg: unknown): void {
    for (const s of this.sessionsOf(uid)) s.send(type, msg);
  }
  person(uid: string): MmPerson | undefined {
    return this.latest(uid)?.person();
  }
  /** either account blocked the other (any of their sessions) */
  separated(a: string, b: string): boolean {
    const has = (x: string, key: string) => this.sessionsOf(x).some((s) => [...s.blocks()].includes(key));
    return has(a, `u:${b}`) || has(b, `u:${a}`);
  }
  accounts(): string[] {
    return [...this.sessions.keys()];
  }

  hall(roomId: string): HallPort | undefined {
    return this.halls.get(roomId);
  }
  hallsOf(game: string): HallPort[] {
    return [...this.halls.values()].filter((h) => h.game === game);
  }
}
