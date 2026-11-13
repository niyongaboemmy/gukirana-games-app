import { MAX_BLOCKS } from "@gukirana/contracts";

/** Who a session is, for block checks: always the session id, plus the account id when signed in. */
export interface Ident {
  sid: string;
  uid?: string;
}

export const keysOf = (p: Ident): string[] => (p.uid ? [`u:${p.uid}`, `s:${p.sid}`] : [`s:${p.sid}`]);
/** Preferred key to block someone by: the account (persists across sessions) or, for guests, the session. */
export const blockKeyFor = (p: Ident): string => (p.uid ? `u:${p.uid}` : `s:${p.sid}`);

/**
 * Block graph for one room (SRS FR-COM-07, SAFE-04, DESIGN-SPEC §12.3): blocking is mutual in effect —
 * the two people become invisible and silent to each other, and no chat, DM, call, voice or proposal passes.
 */
export class BlockGraph {
  private sets = new Map<string, Set<string>>(); // sessionId → blocked keys

  set(sid: string, keys: Iterable<string>): void {
    const s = new Set<string>();
    for (const k of keys) {
      if (s.size >= MAX_BLOCKS) break;
      s.add(k);
    }
    this.sets.set(sid, s);
  }

  add(sid: string, key: string): void {
    const s = this.sets.get(sid) ?? new Set<string>();
    if (s.size < MAX_BLOCKS) s.add(key);
    this.sets.set(sid, s);
  }

  remove(sid: string, key: string): void {
    this.sets.get(sid)?.delete(key);
  }

  forget(sid: string): void {
    this.sets.delete(sid);
  }

  /** a has blocked b */
  blocks(a: Ident, b: Ident): boolean {
    const s = this.sets.get(a.sid);
    if (!s || s.size === 0) return false;
    return keysOf(b).some((k) => s.has(k));
  }

  /** Either side blocked the other → they don't see, hear or reach each other. */
  separated(a: Ident, b: Ident): boolean {
    return this.blocks(a, b) || this.blocks(b, a);
  }
}
