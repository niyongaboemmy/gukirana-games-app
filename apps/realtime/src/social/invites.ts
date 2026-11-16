import type { GameId, MmPerson } from "@gukirana/contracts";

/**
 * Challenges between two accounts (P2-MM-05, docs/MATCHMAKING-V2.md §3.2). Pure state machine shared by every room,
 * so a challenge reaches the other person wherever they are (plaza, any hall). The room checks presence, blocks,
 * busy and eligibility before `send`; this class owns duplicates, crossed challenges, the open cap and the rate limit.
 *
 *   sent ──accept──▶ accepted (rendezvous)        sent ──decline──▶ declined (sender told)
 *   sent ──expiry──▶ expired (both told)          sent ──cancel / player gone──▶ closed (the other one told)
 */
export interface Invite {
  id: string;
  from: MmPerson;
  to: MmPerson;
  game: GameId;
  stake: number;
  venue?: { hall: string; roomId?: string; place?: string };
  expires: number;
}

export type SendError = "SELF" | "DUPLICATE" | "TOO_MANY_OPEN" | "RATE_LIMITED";
export type SendResult = { ok: true; invite: Invite } | { ok: false; reason: SendError } | { ok: false; reason: "CROSSED"; invite: Invite };

export class InviteBook {
  private open = new Map<string, Invite>();
  private sent = new Map<string, number[]>();
  private seq = 0;

  constructor(private readonly limits: { ttlMs: number; perMinute: number; open: number }) {}

  send(input: Omit<Invite, "id" | "expires">, now: number): SendResult {
    const { from, to } = input;
    if (from.uid === to.uid) return { ok: false, reason: "SELF" };
    const mine = [...this.open.values()].filter((i) => i.from.uid === from.uid);
    if (mine.some((i) => i.to.uid === to.uid)) return { ok: false, reason: "DUPLICATE" };
    // they already challenged me: the answer is to accept theirs (the UI offers it)
    const crossed = [...this.open.values()].find((i) => i.from.uid === to.uid && i.to.uid === from.uid);
    if (crossed) return { ok: false, reason: "CROSSED", invite: crossed };
    if (mine.length >= this.limits.open) return { ok: false, reason: "TOO_MANY_OPEN" };
    const recent = (this.sent.get(from.uid) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= this.limits.perMinute) return { ok: false, reason: "RATE_LIMITED" };
    recent.push(now);
    this.sent.set(from.uid, recent);
    const invite: Invite = { ...input, id: `i${++this.seq}`, expires: now + this.limits.ttlMs };
    this.open.set(invite.id, invite);
    return { ok: true, invite };
  }

  /** the invitee answers (null: not theirs / gone / expired) */
  respond(id: string, uid: string, now: number): Invite | null {
    const i = this.open.get(id);
    if (!i || i.to.uid !== uid || now > i.expires) return null;
    this.open.delete(id);
    return i;
  }

  /** the sender takes it back */
  cancel(id: string, uid: string): Invite | null {
    const i = this.open.get(id);
    if (!i || i.from.uid !== uid) return null;
    this.open.delete(id);
    return i;
  }

  sweep(now: number): Invite[] {
    const out: Invite[] = [];
    for (const i of [...this.open.values()])
      if (now > i.expires) {
        this.open.delete(i.id);
        out.push(i);
      }
    return out;
  }

  /** the account went offline / became busy: every challenge to or from it closes */
  forget(uid: string): Invite[] {
    const out = [...this.open.values()].filter((i) => i.from.uid === uid || i.to.uid === uid);
    for (const i of out) this.open.delete(i.id);
    return out;
  }
  /** a block between the two: their challenges close */
  forgetPair(a: string, b: string): Invite[] {
    const out = [...this.open.values()].filter((i) => (i.from.uid === a && i.to.uid === b) || (i.from.uid === b && i.to.uid === a));
    for (const i of out) this.open.delete(i.id);
    return out;
  }

  incoming(uid: string): Invite[] {
    return [...this.open.values()].filter((i) => i.to.uid === uid);
  }
  outgoing(uid: string): Invite[] {
    return [...this.open.values()].filter((i) => i.from.uid === uid);
  }
  get(id: string): Invite | undefined {
    return this.open.get(id);
  }
}
