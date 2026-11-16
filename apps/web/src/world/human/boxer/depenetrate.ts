import type * as THREE from "three";

/**
 * Garments never inside the body (QA-HUM-01): after an instance's body type is baked and the covered body faces are
 * dropped, every garment vertex that sits under (or within `gap` of) the nearest drawn skin vertex is pushed out along
 * that skin vertex's normal to `gap` above it. The garment shells are built per body slice with fixed offsets
 * (scripts/boxer/build.mjs); the body-type morphs (heavy / mature) and the narrow places (collar on the neck, shoe on
 * the instep, glove cuff on the wrist) left 2–3 % of garment vertices up to 2–3 cm inside the skin, which shows as skin
 * through the cloth. Bind space, once per build; the skinning then carries both together.
 *
 * Material slots (boxer-material.ts SLOT): 0 skin; 19 hair, 20 eye, 21 lash, 22 teeth are neither skin nor garment.
 */
const NOT_GARMENT = new Set([0, 19, 20, 21, 22]);

export interface DepenetrateStats {
  tested: number;
  moved: number;
  worstMm: number;
}

export function depenetrate(
  g: THREE.BufferGeometry,
  gap = 0.002,
  reach = 0.03,
  maxPush = 0.035,
): DepenetrateStats {
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const nrm = g.getAttribute("normal") as THREE.BufferAttribute | undefined;
  const mat = g.getAttribute("_mat") as THREE.BufferAttribute | undefined;
  const stats: DepenetrateStats = { tested: 0, moved: 0, worstMm: 0 };
  if (!pos || !nrm || !mat) return stats;
  const n = pos.count;
  // only vertices that are drawn (the body under the garments was dropped from the index)
  const used = new Uint8Array(n);
  if (g.index) for (let i = 0; i < g.index.count; i++) used[g.index.getX(i)] = 1;
  else used.fill(1);
  const cell = reach;
  const key = (x: number, y: number, z: number) =>
    `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    if (!used[i] || mat.getX(i) !== 0) continue;
    const k = key(pos.getX(i), pos.getY(i), pos.getZ(i));
    let l = grid.get(k);
    if (!l) grid.set(k, (l = []));
    l.push(i);
  }
  if (!grid.size) return stats;
  // positions are moved after the search (duplicated seam vertices move together: same nearest skin, same push)
  const moves: [number, number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (!used[i] || NOT_GARMENT.has(mat.getX(i))) continue;
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    const cx = Math.floor(x / cell),
      cy = Math.floor(y / cell),
      cz = Math.floor(z / cell);
    let best = -1;
    let bd = reach * reach;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const l = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!l) continue;
          for (const j of l) {
            const d = (pos.getX(j) - x) ** 2 + (pos.getY(j) - y) ** 2 + (pos.getZ(j) - z) ** 2;
            if (d < bd) {
              bd = d;
              best = j;
            }
          }
        }
    if (best < 0) continue;
    stats.tested++;
    const nx = nrm.getX(best),
      ny = nrm.getY(best),
      nz = nrm.getZ(best);
    const len = Math.hypot(nx, ny, nz) || 1;
    const sd = ((x - pos.getX(best)) * nx + (y - pos.getY(best)) * ny + (z - pos.getZ(best)) * nz) / len;
    if (sd >= gap) continue;
    const push = Math.min(maxPush, gap - sd);
    // a vertex far inside (more than the push cap) is a different part of the body (an arm against the chest): leave it
    if (gap - sd > maxPush) continue;
    stats.moved++;
    stats.worstMm = Math.max(stats.worstMm, Math.round((gap - sd) * 1000));
    moves.push([i, (nx / len) * push, (ny / len) * push, (nz / len) * push]);
  }
  for (const [i, dx, dy, dz] of moves) pos.setXYZ(i, pos.getX(i) + dx, pos.getY(i) + dy, pos.getZ(i) + dz);
  if (moves.length) pos.needsUpdate = true;
  return stats;
}
