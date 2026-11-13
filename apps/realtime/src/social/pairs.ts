import { PAIR_ACT, PAIR_ALIGN_MS, PAIR_INVITE_MS, PAIR_MS, PAIR_RANGE, isContactAction, pairPlacement, type PairKind } from "@gukirana/contracts";

/**
 * Two-person contact actions (handshake, fist bump, hug: P1-COM-04). Contact needs consent: one person asks, the
 * other accepts. Only then does the server pair them, tell both where to stand (face to face at the action's
 * distance) and allow the contact `anim` code in their pose updates for the duration of the action.
 */
export interface PairInvite {
  id: string;
  from: string;
  to: string;
  kind: PairKind;
  at: number;
}
export interface ActivePair {
  id: string;
  a: string;
  b: string;
  kind: PairKind;
  /** contact allowed in `anim` until this time (ms) */
  until: number;
}
export type PairError = "SELF" | "FAR" | "BUSY" | "TARGET_BUSY";

export class PairRegistry {
  private invites = new Map<string, PairInvite>();
  private active = new Map<string, ActivePair>();
  private seq = 0;

  private busy(sid: string, now: number): boolean {
    for (const p of this.active.values()) if (p.until > now && (p.a === sid || p.b === sid)) return true;
    return false;
  }

  /** A asks B. Replaces A's earlier pending invitation. */
  request(from: string, to: string, kind: PairKind, dist: number, now: number): PairInvite | PairError {
    if (from === to) return "SELF";
    if (dist > PAIR_RANGE) return "FAR";
    if (this.busy(from, now)) return "BUSY";
    if (this.busy(to, now)) return "TARGET_BUSY";
    for (const [id, inv] of this.invites) if (inv.from === from) this.invites.delete(id);
    const inv: PairInvite = { id: `p${++this.seq}`, from, to, kind, at: now };
    this.invites.set(inv.id, inv);
    return inv;
  }

  /**
   * Only the invited person answers. Accept (still within reach) → active pair with both placements.
   * Returns null when there is no such invitation for `by`.
   */
  respond(
    id: string,
    by: string,
    accept: boolean,
    pos: (sid: string) => { x: number; z: number } | undefined,
    now: number,
  ): { invite: PairInvite; result: "DECLINED" | "FAR" | "BUSY" | "EXPIRED" } | { invite: PairInvite; pair: ActivePair; place: ReturnType<typeof pairPlacement>; alignMs: number } | null {
    const inv = this.invites.get(id);
    if (!inv || inv.to !== by) return null;
    this.invites.delete(id);
    if (now - inv.at > PAIR_INVITE_MS) return { invite: inv, result: "EXPIRED" };
    if (!accept) return { invite: inv, result: "DECLINED" };
    const a = pos(inv.from);
    const b = pos(inv.to);
    if (!a || !b || Math.hypot(a.x - b.x, a.z - b.z) > PAIR_RANGE + 0.5) return { invite: inv, result: "FAR" };
    if (this.busy(inv.from, now) || this.busy(inv.to, now)) return { invite: inv, result: "BUSY" };
    const place = pairPlacement(inv.kind, a, b);
    // time to walk into place at a calm ~1.15 m/s (both start the contact at the same moment)
    const walk = Math.max(Math.hypot(place.a.x - a.x, place.a.z - a.z), Math.hypot(place.b.x - b.x, place.b.z - b.z));
    const alignMs = Math.round(Math.min(2200, Math.max(PAIR_ALIGN_MS, (walk / 1.15) * 1000 + 300)));
    const pair: ActivePair = { id: inv.id, a: inv.from, b: inv.to, kind: inv.kind, until: now + alignMs + PAIR_MS[inv.kind] + 1500 };
    this.active.set(pair.id, pair);
    return { invite: inv, pair, place, alignMs };
  }

  /**
   * The `anim` a person may show: contact codes only during their active pair (and only that pair's code);
   * everything else passes through unchanged.
   */
  allowAnim(sid: string, anim: number, now: number): number {
    if (!isContactAction(anim)) return anim;
    for (const p of this.active.values()) if (p.until > now && (p.a === sid || p.b === sid) && PAIR_ACT[p.kind] === anim) return anim;
    return 0;
  }

  /** Drop stale invitations and finished pairs; returns the expired invitations (to tell the asker). */
  sweep(now: number): PairInvite[] {
    const out: PairInvite[] = [];
    for (const [id, inv] of this.invites)
      if (now - inv.at > PAIR_INVITE_MS) {
        this.invites.delete(id);
        out.push(inv);
      }
    for (const [id, p] of this.active) if (p.until <= now) this.active.delete(id);
    return out;
  }

  /** Leave / block: forget everything involving this person (invitations they sent or received, pairs). */
  forget(sid: string, other?: string): PairInvite[] {
    const dropped: PairInvite[] = [];
    const hit = (x: string, y: string) => (other ? (x === sid && y === other) || (x === other && y === sid) : x === sid || y === sid);
    for (const [id, inv] of this.invites)
      if (hit(inv.from, inv.to)) {
        this.invites.delete(id);
        dropped.push(inv);
      }
    for (const [id, p] of this.active) if (hit(p.a, p.b)) this.active.delete(id);
    return dropped;
  }
}
