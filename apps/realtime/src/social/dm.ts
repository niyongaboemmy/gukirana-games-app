/**
 * 1:1 private messages (SRS FR-COM-04: "friends or after an accepted chat request").
 * The first message to someone is delivered as a chat *request* (shown with Accept / Block). Until the other
 * person accepts — explicitly or by replying — the sender cannot send more. Accepted threads flow freely.
 * State is per room session (no stored history; P1 adds friends + persisted threads).
 */
export type DmRoute = "deliver" | "request" | "wait";

const pair = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export class DmRouter {
  private open = new Set<string>();
  /** pair → session id that sent the pending request */
  private pending = new Map<string, string>();

  route(from: string, to: string): DmRoute {
    const k = pair(from, to);
    if (this.open.has(k)) return "deliver";
    const requester = this.pending.get(k);
    if (requester === undefined) {
      this.pending.set(k, from);
      return "request";
    }
    if (requester === from) return "wait";
    // the other side replies → the thread is accepted
    this.accept(from, to);
    return "deliver";
  }

  /** `by` accepts the request that `from` sent; true when there was a request to accept. */
  accept(by: string, from: string): boolean {
    const k = pair(by, from);
    if (this.open.has(k)) return true;
    if (this.pending.get(k) !== from) return false;
    this.pending.delete(k);
    this.open.add(k);
    return true;
  }

  isOpen(a: string, b: string): boolean {
    return this.open.has(pair(a, b));
  }

  /** Close every thread that involves this session (leave / block). */
  forget(sid: string, other?: string): void {
    const match = (k: string) => {
      const [a, b] = k.split("|");
      return other ? k === pair(sid, other) : a === sid || b === sid;
    };
    for (const k of [...this.open]) if (match(k)) this.open.delete(k);
    for (const k of [...this.pending.keys()]) if (match(k)) this.pending.delete(k);
  }
}
