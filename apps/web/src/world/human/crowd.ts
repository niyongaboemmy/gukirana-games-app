import * as THREE from "three";

/**
 * Who stands where (P2-AVA-12): every rendered person writes its world position and velocity here each frame, so a
 * person can notice being bumped (someone moving into them faster than a stroll, closer than shoulder to shoulder)
 * and react — on every screen alike, without any network message (positions are the server's, the reaction is
 * cosmetic). A plain module-level table: tens of people, O(n) per person per frame.
 */
interface Entry {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  at: number;
}

const table = new Map<object, Entry>();

/** Two people closer than this (m, pelvis to pelvis) are touching. */
export const BUMP_DIST = 0.52;
/** … and it is a bump if they close in faster than this (m/s). */
export const BUMP_SPEED = 0.7;

export const crowd = {
  update(key: object, pos: THREE.Vector3, vel: THREE.Vector3, now: number) {
    let e = table.get(key);
    if (!e) table.set(key, (e = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), at: now }));
    e.pos.copy(pos);
    e.vel.copy(vel);
    e.at = now;
  },
  remove(key: object) {
    table.delete(key);
  },
  /**
   * The strongest bump on `key` right now: where it came from and how hard (0 … 1), or null. Only the person being
   * walked into reacts (the one closing in is the "bumper"; both react if both move into each other).
   */
  bumpOn(key: object, now: number): { from: THREE.Vector3; strength: number } | null {
    const me = table.get(key);
    if (!me) return null;
    let best: { from: THREE.Vector3; strength: number } | null = null;
    for (const [k, o] of table) {
      if (k === key || now - o.at > 0.5) continue;
      const dx = me.pos.x - o.pos.x;
      const dz = me.pos.z - o.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > BUMP_DIST || d < 1e-4) continue;
      // the other one's velocity towards me
      const towards = (o.vel.x * dx + o.vel.z * dz) / d;
      if (towards < BUMP_SPEED) continue;
      const strength = Math.min(1, (towards - BUMP_SPEED) / 2 + 0.35);
      if (!best || strength > best.strength) best = { from: o.pos.clone(), strength };
    }
    return best;
  },
  get size() {
    return table.size;
  },
};
