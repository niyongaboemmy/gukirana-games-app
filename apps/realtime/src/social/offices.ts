export type Via = "role" | "invite";

export interface Knock {
  id: string;
  office: string;
  /** knocker's session id */
  from: string;
  expires: number;
}

/**
 * Who is inside which Administrative Block office (by session; one office at a time) and the open knocks.
 * Pure state — the room does the access checks, messages and timers.
 */
export class OfficeRegistry {
  private inside = new Map<string, Map<string, Via>>(); // office → session → via
  private where = new Map<string, string>(); // session → office
  private knocks = new Map<string, Knock>();
  private lastKnock = new Map<string, number>(); // `${sid}|${office}` → time
  private seq = 0;

  officeOf(sid: string): string | undefined {
    return this.where.get(sid);
  }
  viaOf(sid: string): Via | undefined {
    const o = this.where.get(sid);
    return o ? this.inside.get(o)?.get(sid) : undefined;
  }

  /** Puts the session in `office`; returns the office it left (if another). */
  enter(sid: string, office: string, via: Via): string | undefined {
    const prev = this.where.get(sid);
    if (prev && prev !== office) this.leave(sid);
    let m = this.inside.get(office);
    if (!m) this.inside.set(office, (m = new Map()));
    m.set(sid, via);
    this.where.set(sid, office);
    return prev && prev !== office ? prev : undefined;
  }

  /** Takes the session out of its office; returns that office. */
  leave(sid: string): string | undefined {
    const o = this.where.get(sid);
    if (!o) return undefined;
    this.where.delete(sid);
    const m = this.inside.get(o);
    m?.delete(sid);
    if (m && !m.size) this.inside.delete(o);
    return o;
  }

  occupants(office: string): string[] {
    return [...(this.inside.get(office)?.keys() ?? [])];
  }
  /** people who walked in on their role (the ones who can answer the door, subject to a fresh role check) */
  staff(office: string): string[] {
    return [...(this.inside.get(office)?.entries() ?? [])].filter(([, v]) => v === "role").map(([s]) => s);
  }
  /** staff count per office (door lamps + reception directory) */
  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const o of this.inside.keys()) {
      const n = this.staff(o).length;
      if (n) out[o] = n;
    }
    return out;
  }

  // ---------------------------------------------------------------- knocks
  openKnockFrom(sid: string, office: string): Knock | undefined {
    for (const k of this.knocks.values()) if (k.from === sid && k.office === office) return k;
    return undefined;
  }
  knocksBy(sid: string): Knock[] {
    return [...this.knocks.values()].filter((k) => k.from === sid);
  }
  knocksTo(office: string): Knock[] {
    return [...this.knocks.values()].filter((k) => k.office === office);
  }
  get(id: string): Knock | undefined {
    return this.knocks.get(id);
  }

  /** Rate limit: one knock per door per `gapMs`, at most `maxOpen` open knocks per session. */
  mayKnock(sid: string, office: string, now: number, gapMs: number, maxOpen: number): boolean {
    if (now - (this.lastKnock.get(`${sid}|${office}`) ?? -Infinity) < gapMs) return false;
    return this.knocksBy(sid).length < maxOpen;
  }

  knock(sid: string, office: string, now: number, ttlMs: number): Knock {
    const k: Knock = { id: `k${++this.seq}`, office, from: sid, expires: now + ttlMs };
    this.knocks.set(k.id, k);
    this.lastKnock.set(`${sid}|${office}`, now);
    return k;
  }

  /** Closes a knock; returns it if it was still open. */
  take(id: string): Knock | undefined {
    const k = this.knocks.get(id);
    if (k) this.knocks.delete(id);
    return k;
  }

  /** Session gone: drop its knocks and rate-limit marks (its office is left via `leave`). */
  forget(sid: string): void {
    for (const k of this.knocksBy(sid)) this.knocks.delete(k.id);
    for (const key of [...this.lastKnock.keys()]) if (key.startsWith(`${sid}|`)) this.lastKnock.delete(key);
  }
}
