import { HttpException, HttpStatus, Injectable } from "@nestjs/common";

/**
 * Rate limits on staff actions (P2-CON-02), per actor (staff account id or `admin-token:<name>`), in memory per API
 * instance. Generous for real work, tight enough that a stolen staff session or a stuck script can't mass-suspend,
 * mass-export or reveal contacts in bulk. A refusal is 429 RATE_LIMITED with the seconds to wait.
 */
export const STAFF_LIMITS = {
  /** any account / role / report change */
  mutate: { max: 30, windowMs: 60_000 },
  /** CSV export of the people list */
  export: { max: 5, windowMs: 10 * 60_000 },
  /** showing one full contact (super admin) */
  reveal: { max: 10, windowMs: 60 * 60_000 },
} as const;
export type StaffLimitKind = keyof typeof STAFF_LIMITS;

@Injectable()
export class StaffLimits {
  private readonly hits = new Map<string, number[]>();

  /** count one action; throws 429 when the actor is over the limit for this kind */
  hit(actor: string, kind: StaffLimitKind, now = Date.now()): void {
    const { max, windowMs } = STAFF_LIMITS[kind];
    const key = `${kind}:${actor}`;
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (list.length >= max) {
      this.hits.set(key, list);
      const retryAfter = Math.max(1, Math.ceil((list[0]! + windowMs - now) / 1000));
      throw new HttpException({ code: "RATE_LIMITED", retryAfter }, HttpStatus.TOO_MANY_REQUESTS);
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 5_000) for (const [k, v] of this.hits) if (!v.length || now - v[v.length - 1]! > 3_600_000) this.hits.delete(k);
  }

  reset(): void {
    this.hits.clear();
  }
}
