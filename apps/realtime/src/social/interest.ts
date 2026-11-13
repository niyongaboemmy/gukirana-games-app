/**
 * Distance-based update rates for crowds (DESIGN-SPEC §6.5, §16): instead of relaying every move to everyone
 * (O(n²) messages at the senders' 15 Hz), the room ticks at 10 Hz and sends each viewer ONE batched `moves`
 * message with the people that changed — near people every tick, mid-range every 2nd, far every 4th tick.
 * Animation changes (sit down, wave, start walking) are always sent on the next tick so they look instant.
 */
export const TICK_MS = 100;
export const NEAR_M = 20;
export const MID_M = 45;

export interface Mover {
  id: string;
  x: number; // cm
  z: number; // cm
  yaw: number;
  anim: number;
  /** increments on every accepted move */
  seq: number;
}

/** [id, x(cm), z(cm), yaw(0–65535), anim] — compact on the wire */
export type MoveEntry = [string, number, number, number, number];

interface Sent {
  seq: number;
  anim: number;
}

export class InterestManager {
  private sent = new Map<string, Map<string, Sent>>(); // viewer → mover → last sent

  /** Entries for one viewer this tick; `visible(m)` excludes blocked people. */
  collect(viewer: Mover, movers: Iterable<Mover>, tick: number, visible: (m: Mover) => boolean): MoveEntry[] {
    let mine = this.sent.get(viewer.id);
    if (!mine) this.sent.set(viewer.id, (mine = new Map()));
    const out: MoveEntry[] = [];
    for (const m of movers) {
      if (m.id === viewer.id) continue;
      const last = mine.get(m.id);
      if (last && last.seq === m.seq) continue;
      if (!visible(m)) continue;
      const animChanged = !last || last.anim !== m.anim;
      if (!animChanged) {
        const d = Math.hypot(m.x - viewer.x, m.z - viewer.z) / 100;
        const every = d < NEAR_M ? 1 : d < MID_M ? 2 : 4;
        if (tick % every !== 0) continue;
      }
      mine.set(m.id, { seq: m.seq, anim: m.anim });
      out.push([m.id, m.x, m.z, m.yaw, m.anim]);
    }
    return out;
  }

  /** Viewer must receive this mover's next pose (e.g. after an unblock → re-join). */
  reset(viewerId: string, moverId?: string): void {
    if (moverId) this.sent.get(viewerId)?.delete(moverId);
    else this.sent.delete(viewerId);
  }

  forget(id: string): void {
    this.sent.delete(id);
    for (const m of this.sent.values()) m.delete(id);
  }
}
