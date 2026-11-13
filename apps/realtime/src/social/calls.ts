/**
 * Private 1:1 voice calls (SRS FR-COM-02 "Private call (1:1, both must accept)"). The registry only decides who
 * is in which call; audio still flows peer-to-peer over the existing WebRTC signalling relay.
 */
export interface Call {
  id: string;
  from: string;
  to: string;
  state: "ringing" | "active";
  since: number;
}

export type CallError = "SELF" | "BUSY" | "TARGET_BUSY" | "RINGING_LIMIT";

export class CallRegistry {
  private calls = new Map<string, Call>();
  private seq = 0;

  /** The call this session is part of (ringing or active). */
  callOf(sid: string): Call | undefined {
    for (const c of this.calls.values()) if (c.from === sid || c.to === sid) return c;
    return undefined;
  }

  get(id: string): Call | undefined {
    return this.calls.get(id);
  }

  request(from: string, to: string, now: number): Call | CallError {
    if (from === to) return "SELF";
    if (this.callOf(from)) return "BUSY";
    if (this.callOf(to)) return "TARGET_BUSY";
    const call: Call = { id: `c${++this.seq}`, from, to, state: "ringing", since: now };
    this.calls.set(call.id, call);
    return call;
  }

  /** Only the callee can answer a ringing call. Declining removes it. */
  respond(id: string, by: string, accept: boolean, now: number): Call | null {
    const c = this.calls.get(id);
    if (!c || c.to !== by || c.state !== "ringing") return null;
    if (!accept) {
      this.calls.delete(id);
      return { ...c };
    }
    c.state = "active";
    c.since = now;
    return c;
  }

  /** Ends the call (either side); returns it so both people can be told. */
  end(id: string, by: string): Call | null {
    const c = this.calls.get(id);
    if (!c || (c.from !== by && c.to !== by)) return null;
    this.calls.delete(id);
    return c;
  }

  /** Ends whatever call this session is in (leave / block). */
  endFor(sid: string): Call | null {
    const c = this.callOf(sid);
    if (!c) return null;
    this.calls.delete(c.id);
    return c;
  }

  /** Ringing calls older than `ttl` (removed). */
  expire(now: number, ttl: number): Call[] {
    const out: Call[] = [];
    for (const c of this.calls.values()) {
      if (c.state === "ringing" && now - c.since >= ttl) {
        this.calls.delete(c.id);
        out.push(c);
      }
    }
    return out;
  }

  /** True when a and b are in the same active call (voice relay is allowed regardless of distance). */
  inCallTogether(a: string, b: string): boolean {
    const c = this.callOf(a);
    return !!c && c.state === "active" && (c.from === b || c.to === b);
  }
}
