// Baked per-vertex ambient occlusion for the ring people's skin (P3-FGT-18, docs/FIGHT-REALISM-V7.md §6). Phones get
// no screen-space AO, and even on desktop the SSAO pass misses the small creases at body scale: the skin under the
// vest's arm hole and neckline, under the trunks' hem and band, between the legs, under the chin, round the ears.
// Method: the occluders (the body and the garments that every outfit's skin sits next to) are voxelised at 1 cm; each
// skin vertex marches 24 fixed, cosine-distributed directions over its normal for up to 16 cm and counts the voxels it
// meets (nearer hits weigh more). Deterministic, ~1 s per body.

const VOX = 0.01;

/** a fixed cosine-weighted hemisphere set around +z (Fibonacci spiral) */
function hemisphere(n) {
  const out = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const r = Math.sqrt(u);
    const a = i * ga;
    out.push([r * Math.cos(a), r * Math.sin(a), Math.sqrt(1 - u)]);
  }
  return out;
}

/**
 * @param tris occluder triangles: flat array of positions [ax, ay, az, bx, …] (metres)
 * @param pts receiver positions (flat) and normals (flat)
 * @returns Float32Array of occlusion-free fractions per receiver (1 = open sky, 0 = buried)
 */
export function bakeVertexAo(tris, pts, normals, { dirs = 24, reach = 0.16, start = 0.014 } = {}) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < tris.length; i += 3) {
    x0 = Math.min(x0, tris[i]);
    x1 = Math.max(x1, tris[i]);
    y0 = Math.min(y0, tris[i + 1]);
    y1 = Math.max(y1, tris[i + 1]);
    z0 = Math.min(z0, tris[i + 2]);
    z1 = Math.max(z1, tris[i + 2]);
  }
  const pad = reach + 0.02;
  x0 -= pad; y0 -= pad; z0 -= pad;
  const nx = Math.ceil((x1 + pad - x0) / VOX), ny = Math.ceil((y1 + pad - y0) / VOX), nz = Math.ceil((z1 + pad - z0) / VOX);
  const grid = new Uint8Array(nx * ny * nz);
  const mark = (x, y, z) => {
    const i = Math.floor((x - x0) / VOX), j = Math.floor((y - y0) / VOX), k = Math.floor((z - z0) / VOX);
    if (i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz) grid[(k * ny + j) * nx + i] = 1;
  };
  // rasterise each triangle by sampling it at half a voxel
  for (let t = 0; t < tris.length; t += 9) {
    const a = [tris[t], tris[t + 1], tris[t + 2]], b = [tris[t + 3], tris[t + 4], tris[t + 5]], c = [tris[t + 6], tris[t + 7], tris[t + 8]];
    const lab = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const lac = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const n = Math.max(1, Math.ceil(Math.max(lab, lac) / (VOX * 0.5)));
    for (let u = 0; u <= n; u++)
      for (let v = 0; v <= n - u; v++) {
        const s = u / n, r = v / n;
        mark(a[0] + (b[0] - a[0]) * s + (c[0] - a[0]) * r, a[1] + (b[1] - a[1]) * s + (c[1] - a[1]) * r, a[2] + (b[2] - a[2]) * s + (c[2] - a[2]) * r);
      }
  }
  const occ = (x, y, z) => {
    const i = Math.floor((x - x0) / VOX), j = Math.floor((y - y0) / VOX), k = Math.floor((z - z0) / VOX);
    return i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && grid[(k * ny + j) * nx + i] === 1;
  };
  const H = hemisphere(dirs);
  const out = new Float32Array(pts.length / 3);
  const steps = Math.ceil((reach - start) / (VOX * 0.7));
  for (let v = 0; v < out.length; v++) {
    const p = [pts[v * 3], pts[v * 3 + 1], pts[v * 3 + 2]];
    const n = [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]];
    // a frame round the normal
    const t = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let ux = n[1] * t[2] - n[2] * t[1], uy = n[2] * t[0] - n[0] * t[2], uz = n[0] * t[1] - n[1] * t[0];
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    const wx = n[1] * uz - n[2] * uy, wy = n[2] * ux - n[0] * uz, wz = n[0] * uy - n[1] * ux;
    let blocked = 0;
    for (const h of H) {
      const dx = ux * h[0] + wx * h[1] + n[0] * h[2], dy = uy * h[0] + wy * h[1] + n[1] * h[2], dz = uz * h[0] + wz * h[1] + n[2] * h[2];
      for (let s = 0; s <= steps; s++) {
        const d = start + s * VOX * 0.7;
        if (occ(p[0] + dx * d, p[1] + dy * d, p[2] + dz * d)) {
          // (a near wall occludes fully; a far one only partly: the light still comes in round it)
          blocked += 1 - 0.6 * ((d - start) / (reach - start));
          break;
        }
      }
    }
    out[v] = 1 - blocked / H.length;
  }
  return out;
}
