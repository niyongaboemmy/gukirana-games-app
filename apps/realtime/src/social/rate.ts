/** Fixed-window rate limiter keyed by session + action (flood guards for chat, DMs, calls, signalling). */
export class RateLimiter {
  private buckets = new Map<string, { at: number; n: number }>();

  /** true when the action is allowed (at most `max` per `windowMs`) */
  allow(key: string, max: number, windowMs: number, now: number): boolean {
    const b = this.buckets.get(key);
    if (!b || now - b.at >= windowMs) {
      this.buckets.set(key, { at: now, n: 1 });
      return true;
    }
    if (b.n >= max) return false;
    b.n++;
    return true;
  }

  forget(prefix: string): void {
    for (const k of [...this.buckets.keys()]) if (k.startsWith(prefix)) this.buckets.delete(k);
  }
}
