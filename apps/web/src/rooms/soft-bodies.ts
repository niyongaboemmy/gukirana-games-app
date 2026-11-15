/**
 * Soft bodies (P3-FGT-08): people the hall controller (RoomPlayer) slides around instead of walking through, besides
 * the remote players it already knows — the halls' local staff (gym coaches, the cleaner, the referee on rounds) and
 * your own stand-in at a bag. Layers write their current position every frame and delete it on unmount. Cheap: a few
 * entries, one distance test each per frame.
 */
export const softBodies = new Map<string, { x: number; z: number; r: number }>();

type XZ = { x: number; z: number };

/**
 * A walk heading at someone standing on the line steps round them before bumping into them (real people do; the
 * blocked-walk sidestep only fires after you have already stopped, and a moving cleaner then defeated both tries).
 * Looks `ahead` metres along the line from `p` to `target`; returns a detour point beside the first body in the way, on
 * the side away from it (the other side when that one is not walkable), or null when the line is clear.
 */
export function bodyDetour(p: XZ, target: XZ, bodies: Iterable<{ x: number; z: number; r: number }>, body: number, walkable?: (x: number, z: number) => boolean, ahead = 2.0): XZ | null {
  const dx = target.x - p.x;
  const dz = target.z - p.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.6) return null;
  const ux = dx / len;
  const uz = dz / len;
  const reach = Math.min(len - 0.2, ahead);
  let best: { t: number; lat: number; r: number } | null = null;
  for (const b of bodies) {
    const bx = b.x - p.x;
    const bz = b.z - p.z;
    const t = bx * ux + bz * uz;
    if (t < 0.15 || t > reach) continue;
    const lat = bx * -uz + bz * ux; // + = left of the line
    if (Math.abs(lat) >= body + b.r + 0.12) continue;
    if (!best || t < best.t) best = { t, lat, r: b.r };
  }
  if (!best) return null;
  const off = body + best.r + 0.45;
  for (const side of best.lat >= 0 ? [-1, 1] : [1, -1]) {
    const x = p.x + ux * best.t + -uz * off * side;
    const z = p.z + uz * best.t + ux * off * side;
    if (!walkable || walkable(x, z)) return { x, z };
  }
  return null;
}
