/**
 * Server-side movement sanity (GAP-014). Clients still drive their own avatar, but the position the room keeps (and
 * relays to everyone, uses for nearby chat, bench release and contact actions) can't move faster than a person can:
 * a per-session distance budget that refills at `speedCmS` up to `burstCm`.
 *
 *  - The first position after joining is taken as sent (spawn, restored position, door arrival: every door crossing
 *    and every respawn is a fresh room join).
 *  - The fastest legit movement is a run at 3.2 m/s × 1.8 ≈ 5.8 m/s; the budget refills at 9 m/s, so walking and
 *    running are never touched, and the 8 m burst covers seat snaps, contact-action alignment and VR teleport steps.
 *  - Anything faster (a teleport across the plaza, a speed hack) is clamped along its direction: others see the
 *    person cover the distance at the maximum speed instead of jumping. Nothing is sent back; the client is not
 *    fought, it only cannot make anyone else see an impossible move.
 */
export const moveConfig = {
  /** refill rate (cm per second) */
  speedCmS: 900,
  /** largest single jump accepted at once (cm) */
  burstCm: 800,
  /** budget refill is counted over at most this long (no banking minutes of standing still) */
  maxGapMs: 1_000,
};

interface Budget {
  cm: number;
  at: number;
}

export class MoveGuard {
  private budgets = new Map<string, Budget>();

  /** Where `id` may be now, given its last accepted position and the position it asks for (centimetres). */
  apply(id: string, from: { x: number; z: number }, to: { x: number; z: number }, now = Date.now()): { x: number; z: number; clamped: boolean } {
    const b = this.budgets.get(id);
    if (!b) {
      this.budgets.set(id, { cm: moveConfig.burstCm, at: now });
      return { x: to.x, z: to.z, clamped: false }; // first fix after joining: spawn / restored position
    }
    const gap = Math.min(moveConfig.maxGapMs, Math.max(0, now - b.at));
    b.cm = Math.min(moveConfig.burstCm, b.cm + (gap / 1000) * moveConfig.speedCmS);
    b.at = now;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const d = Math.hypot(dx, dz);
    if (d <= b.cm) {
      b.cm -= d;
      return { x: to.x, z: to.z, clamped: false };
    }
    const k = b.cm / d;
    b.cm = 0;
    return { x: Math.round(from.x + dx * k), z: Math.round(from.z + dz * k), clamped: true };
  }

  forget(id: string): void {
    this.budgets.delete(id);
  }
}
