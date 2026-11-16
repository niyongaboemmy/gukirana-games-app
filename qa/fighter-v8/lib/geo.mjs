// P3-FGT-19A fighter v8 prototype (dev only): small geometry kit used by the builder.
// Catmull-Clark subdivision with per-corner uv and skin weights, iso-line cutting of a triangle surface along a
// scalar field (smooth garment edges instead of quad staircases), solidify (outer / inner shell + rolled rim),
// surface nets over a signed distance field (gloves, headgear, boots). Pure functions over plain arrays.

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
/** polynomial smooth min / max (Quilez) */
export const smin = (a, b, k) => {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return lerp(b, a, h) - k * h * (1 - h);
};
export const smax = (a, b, k) => -smin(-a, -b, k);

/** deterministic hash noise (no Math.random anywhere in this prototype) */
export function hash3(x, y, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
/** smooth value noise in 3D, range 0..1 */
export function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const c = (a, b, d) => hash3(xi + a, yi + b, zi + d);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), u), x10 = lerp(c(0, 1, 0), c(1, 1, 0), u);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), u), x11 = lerp(c(0, 1, 1), c(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}
export const fbm = (x, y, z, oct = 4) => {
  let a = 0.5, s = 0, f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, y * f, z * f);
    f *= 2.03;
    a *= 0.5;
  }
  return s;
};

/** area-weighted vertex normals for faces (quads or triangles) over a flat position array */
export function vertexNormals(P, faces, n = P.length / 3) {
  const N = new Float64Array(n * 3);
  for (const f of faces)
    for (let k = 0; k < f.length; k++) {
      const a = f[k], b = f[(k + 1) % f.length], c = f[(k + f.length - 1) % f.length];
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
      const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az;
      const vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
      N[a * 3] += uy * vz - uz * vy;
      N[a * 3 + 1] += uz * vx - ux * vz;
      N[a * 3 + 2] += ux * vy - uy * vx;
    }
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1;
    N[i * 3] /= l;
    N[i * 3 + 1] /= l;
    N[i * 3 + 2] /= l;
  }
  return N;
}

export function neighbours(n, faces) {
  const nb = Array.from({ length: n }, () => new Set());
  for (const f of faces)
    for (let k = 0; k < f.length; k++) {
      nb[f[k]].add(f[(k + 1) % f.length]);
      nb[f[k]].add(f[(k + f.length - 1) % f.length]);
    }
  return nb;
}

/**
 * One Catmull-Clark step. Input: positions P (flat), faces (vertex index lists), per-face-corner uv (same shape as
 * faces, [u, v] pairs), per-vertex skin (Map bone → weight). Output: new P, quads, per-corner uv, skin.
 */
export function catmullClark({ P, faces, uvs, skin }) {
  const nv = P.length / 3;
  const V = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  const ekey = (a, b) => (a < b ? a * 1e7 + b : b * 1e7 + a);
  const edges = new Map(); // key → { a, b, faces: [] }
  const facePts = faces.map((f) => {
    let c = [0, 0, 0];
    for (const v of f) c = add(c, V(v));
    return scl(c, 1 / f.length);
  });
  faces.forEach((f, fi) => {
    for (let k = 0; k < f.length; k++) {
      const a = f[k], b = f[(k + 1) % f.length];
      const key = ekey(a, b);
      if (!edges.has(key)) edges.set(key, { a, b, faces: [] });
      edges.get(key).faces.push(fi);
    }
  });
  const out = [];
  const outSkin = [];
  const push = (p, s) => {
    out.push(p[0], p[1], p[2]);
    outSkin.push(s);
    return out.length / 3 - 1;
  };
  const mixSkin = (list) => {
    const m = new Map();
    for (const [s, w] of list) for (const [b, x] of s) m.set(b, (m.get(b) ?? 0) + x * w);
    return m;
  };
  // vertex points
  const vFaces = Array.from({ length: nv }, () => []);
  faces.forEach((f, fi) => f.forEach((v) => vFaces[v].push(fi)));
  const vEdges = Array.from({ length: nv }, () => []);
  for (const e of edges.values()) {
    vEdges[e.a].push(e);
    vEdges[e.b].push(e);
  }
  const vIndex = new Int32Array(nv).fill(-1);
  for (let i = 0; i < nv; i++) {
    if (!vFaces[i].length) continue;
    const boundary = vEdges[i].filter((e) => e.faces.length === 1);
    let p;
    if (boundary.length >= 2) {
      const o = boundary.map((e) => V(e.a === i ? e.b : e.a));
      p = add(scl(V(i), 0.75), scl(add(o[0], o[1]), 0.125));
    } else {
      const n = vFaces[i].length;
      let F = [0, 0, 0];
      for (const fi of vFaces[i]) F = add(F, facePts[fi]);
      F = scl(F, 1 / n);
      let R = [0, 0, 0];
      for (const e of vEdges[i]) R = add(R, scl(add(V(e.a), V(e.b)), 0.5));
      R = scl(R, 1 / vEdges[i].length);
      p = scl(add(add(F, scl(R, 2)), scl(V(i), n - 3)), 1 / n);
    }
    vIndex[i] = push(p, skin[i]);
  }
  const eIndex = new Map();
  for (const [key, e] of edges) {
    let p;
    if (e.faces.length === 2) p = scl(add(add(V(e.a), V(e.b)), add(facePts[e.faces[0]], facePts[e.faces[1]])), 0.25);
    else p = scl(add(V(e.a), V(e.b)), 0.5);
    eIndex.set(key, push(p, mixSkin([[skin[e.a], 0.5], [skin[e.b], 0.5]])));
  }
  const fIndex = faces.map((f, fi) => push(facePts[fi], mixSkin(f.map((v) => [skin[v], 1 / f.length]))));
  const quads = [];
  const quv = [];
  faces.forEach((f, fi) => {
    const n = f.length;
    const u = uvs[fi];
    const fu = [0, 0];
    for (const x of u) {
      fu[0] += x[0] / n;
      fu[1] += x[1] / n;
    }
    for (let k = 0; k < n; k++) {
      const prev = (k + n - 1) % n, next = (k + 1) % n;
      const eN = eIndex.get(ekey(f[k], f[next]));
      const eP = eIndex.get(ekey(f[prev], f[k]));
      quads.push([vIndex[f[k]], eN, fIndex[fi], eP]);
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      quv.push([u[k], mid(u[k], u[next]), fu, mid(u[prev], u[k])]);
    }
  });
  return { P: Float64Array.from(out), faces: quads, uvs: quv, skin: outSkin };
}

/**
 * Cut a triangle surface along the zero level of a per-vertex field f (keep f >= 0). Vertices carry arbitrary
 * attribute arrays that are interpolated linearly at the crossing. Returns new { P, tris, attrs, boundary } where
 * boundary marks vertices created on the cut.
 */
export function isoCut({ P, tris, f, attrs = {} }) {
  const outP = [];
  const outA = Object.fromEntries(Object.keys(attrs).map((k) => [k, []]));
  const sizes = Object.fromEntries(Object.entries(attrs).map(([k, a]) => [k, a.size]));
  const onCut = [];
  const map = new Map();
  const vert = (i) => {
    if (map.has(i)) return map.get(i);
    outP.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    for (const k in attrs) for (let c = 0; c < sizes[k]; c++) outA[k].push(attrs[k].data[i * sizes[k] + c]);
    onCut.push(0);
    const id = outP.length / 3 - 1;
    map.set(i, id);
    return id;
  };
  const emap = new Map();
  const edgeVert = (a, b) => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    if (emap.has(key)) return emap.get(key);
    const t = f[a] / (f[a] - f[b]);
    for (let c = 0; c < 3; c++) outP.push(P[a * 3 + c] + (P[b * 3 + c] - P[a * 3 + c]) * t);
    for (const k in attrs)
      for (let c = 0; c < sizes[k]; c++) {
        const s = sizes[k];
        outA[k].push(attrs[k].data[a * s + c] + (attrs[k].data[b * s + c] - attrs[k].data[a * s + c]) * t);
      }
    onCut.push(1);
    const id = outP.length / 3 - 1;
    emap.set(key, id);
    return id;
  };
  const outT = [];
  for (const [a, b, c] of tris) {
    const ins = [f[a] >= 0, f[b] >= 0, f[c] >= 0];
    const n = ins.filter(Boolean).length;
    if (n === 0) continue;
    if (n === 3) {
      outT.push([vert(a), vert(b), vert(c)]);
      continue;
    }
    // rotate so that the odd one out is first
    const v = [a, b, c];
    let r = 0;
    if (n === 1) r = ins.indexOf(true);
    else r = ins.indexOf(false);
    const p0 = v[r], p1 = v[(r + 1) % 3], p2 = v[(r + 2) % 3];
    if (n === 1) {
      outT.push([vert(p0), edgeVert(p0, p1), edgeVert(p0, p2)]);
    } else {
      const e01 = edgeVert(p0, p1), e02 = edgeVert(p0, p2);
      outT.push([e01, vert(p1), vert(p2)]);
      outT.push([e01, vert(p2), e02]);
    }
  }
  const A = {};
  for (const k in outA) A[k] = { data: Float64Array.from(outA[k]), size: sizes[k] };
  return { P: Float64Array.from(outP), tris: outT, attrs: A, onCut: Uint8Array.from(onCut) };
}

/** drop slivers created by a cut: merge cut vertices that are closer than eps to an original neighbour */
export function boundaryLoops(tris) {
  const count = new Map();
  const dir = new Map();
  for (const [a, b, c] of tris)
    for (const [x, y] of [[a, b], [b, c], [c, a]]) {
      const k = x < y ? `${x}_${y}` : `${y}_${x}`;
      count.set(k, (count.get(k) ?? 0) + 1);
      dir.set(k, [x, y]);
    }
  const next = new Map();
  for (const [k, n] of count) if (n === 1) {
    const [x, y] = dir.get(k);
    next.set(x, y);
  }
  const loops = [];
  const seen = new Set();
  for (const s of next.keys()) {
    if (seen.has(s)) continue;
    const loop = [];
    let v = s;
    while (v !== undefined && !seen.has(v)) {
      seen.add(v);
      loop.push(v);
      v = next.get(v);
    }
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}

/** smooth a boundary loop's positions in place (removes the zig-zag of a cut through a coarse surface) */
export function smoothLoops(P, loops, iters = 6, lam = 0.5) {
  for (const loop of loops) {
    const n = loop.length;
    for (let it = 0; it < iters; it++) {
      const cur = loop.map((v) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]);
      for (let i = 0; i < n; i++) {
        const a = cur[(i + n - 1) % n], b = cur[(i + 1) % n], c = cur[i];
        for (let k = 0; k < 3; k++) P[loop[i] * 3 + k] = c[k] + lam * ((a[k] + b[k]) / 2 - c[k]);
      }
    }
  }
}

/**
 * Solidify a cloth surface: outer = P, inner = P − n·t, and a rolled rim along every boundary loop (a half-round of
 * `rimSteps` rings bulging out by `bead`). Returns { P, N, tris, src } where src maps each output vertex to its input
 * vertex (attributes are copied by the caller) and side: 0 outer, 1 inner, 2 rim.
 */
export function solidify(P, tris, thickness, { rimSteps = 4, bead = 0.0015 } = {}) {
  const n = P.length / 3;
  const N = vertexNormals(P, tris, n);
  const tOf = typeof thickness === "function" ? thickness : () => thickness;
  const outP = [];
  const src = [];
  const side = [];
  for (let i = 0; i < n; i++) {
    outP.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    src.push(i);
    side.push(0);
  }
  for (let i = 0; i < n; i++) {
    const t = tOf(i);
    outP.push(P[i * 3] - N[i * 3] * t, P[i * 3 + 1] - N[i * 3 + 1] * t, P[i * 3 + 2] - N[i * 3 + 2] * t);
    src.push(i);
    side.push(1);
  }
  const outT = [];
  for (const [a, b, c] of tris) {
    outT.push([a, b, c]);
    outT.push([n + a, n + c, n + b]);
  }
  for (const loop of boundaryLoops(tris)) {
    const L = loop.length;
    // rings: k = 0 outer edge … rimSteps inner edge; bulge outwards along the in-plane edge normal
    const rings = [];
    for (let k = 0; k <= rimSteps; k++) {
      if (k === 0) {
        rings.push(loop);
        continue;
      }
      if (k === rimSteps) {
        rings.push(loop.map((v) => n + v));
        continue;
      }
      const s = k / rimSteps;
      const ang = Math.PI * s;
      const ring = loop.map((v, i) => {
        const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
        const nn = [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]];
        const a = loop[(i + L - 1) % L], b = loop[(i + 1) % L];
        const tang = norm(sub([P[b * 3], P[b * 3 + 1], P[b * 3 + 2]], [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]]));
        const out = norm(cross(tang, nn)); // points away from the surface (boundary winding is ccw seen from +n)
        const t = tOf(v);
        const q = add(sub(p, scl(nn, t * (1 - Math.cos(ang)) * 0.5)), scl(out, (t * 0.5 + bead) * Math.sin(ang)));
        outP.push(q[0], q[1], q[2]);
        src.push(v);
        side.push(2);
        return outP.length / 3 - 1;
      });
      rings.push(ring);
    }
    for (let k = 0; k < rimSteps; k++)
      for (let i = 0; i < L; i++) {
        const j = (i + 1) % L;
        const a = rings[k][i], b = rings[k][j], c = rings[k + 1][j], d = rings[k + 1][i];
        outT.push([a, d, b], [b, d, c]);
      }
  }
  return { P: Float64Array.from(outP), tris: outT, src: Int32Array.from(src), side: Uint8Array.from(side) };
}

/**
 * Surface nets over a sampled signed distance function (negative inside). Returns { P, tris } (outward winding).
 * bounds [min[3], max[3]], cell size h. sdf(x, y, z) → distance.
 */
export function surfaceNets(sdf, bounds, h) {
  const [mn, mx] = bounds;
  const nx = Math.ceil((mx[0] - mn[0]) / h) + 1, ny = Math.ceil((mx[1] - mn[1]) / h) + 1, nz = Math.ceil((mx[2] - mn[2]) / h) + 1;
  const F = new Float32Array(nx * ny * nz);
  const id = (i, j, k) => i + nx * (j + ny * k);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) F[id(i, j, k)] = sdf(mn[0] + i * h, mn[1] + j * h, mn[2] + k * h);
  const cellV = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cid = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k);
  const P = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const cedges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const v = corners.map(([a, b, c]) => F[id(i + a, j + b, k + c)]);
        let mask = 0;
        for (let c = 0; c < 8; c++) if (v[c] < 0) mask |= 1 << c;
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, cnt = 0;
        for (const [a, b] of cedges) {
          if (v[a] < 0 === v[b] < 0) continue;
          const t = v[a] / (v[a] - v[b]);
          const ca = corners[a], cb = corners[b];
          sx += ca[0] + (cb[0] - ca[0]) * t;
          sy += ca[1] + (cb[1] - ca[1]) * t;
          sz += ca[2] + (cb[2] - ca[2]) * t;
          cnt++;
        }
        P.push(mn[0] + (i + sx / cnt) * h, mn[1] + (j + sy / cnt) * h, mn[2] + (k + sz / cnt) * h);
        cellV[cid(i, j, k)] = P.length / 3 - 1;
      }
  const tris = [];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) tris.push([a, b, c], [a, c, d]);
    else tris.push([a, c, b], [a, d, c]);
  };
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const inside = F[id(i, j, k)] < 0;
        // x edge (i,j,k)-(i+1,j,k): cells sharing it vary in j,k
        if (inside !== F[id(i + 1, j, k)] < 0) quad(cellV[cid(i, j - 1, k - 1)], cellV[cid(i, j, k - 1)], cellV[cid(i, j, k)], cellV[cid(i, j - 1, k)], inside);
        if (inside !== F[id(i, j + 1, k)] < 0) quad(cellV[cid(i - 1, j, k - 1)], cellV[cid(i - 1, j, k)], cellV[cid(i, j, k)], cellV[cid(i, j, k - 1)], inside);
        if (inside !== F[id(i, j, k + 1)] < 0) quad(cellV[cid(i - 1, j - 1, k)], cellV[cid(i, j - 1, k)], cellV[cid(i, j, k)], cellV[cid(i - 1, j, k)], inside);
      }
  return { P: Float64Array.from(P), tris, F, dims: [nx, ny, nz] };
}

/** project surface-nets vertices onto the zero level with a few Newton steps on the analytic sdf, then relax */
export function refineToSurface(P, sdf, h, steps = 3) {
  const e = h * 0.25;
  for (let i = 0; i < P.length; i += 3) {
    for (let s = 0; s < steps; s++) {
      const x = P[i], y = P[i + 1], z = P[i + 2];
      const d = clamp(sdf(x, y, z), -h * 0.5, h * 0.5);
      const g = norm([sdf(x + e, y, z) - sdf(x - e, y, z), sdf(x, y + e, z) - sdf(x, y - e, z), sdf(x, y, z + e) - sdf(x, y, z - e)]);
      P[i] -= g[0] * d;
      P[i + 1] -= g[1] * d;
      P[i + 2] -= g[2] * d;
    }
  }
}

/** sdf gradient normals */
export function sdfNormals(P, sdf, h) {
  const e = h * 0.5;
  const N = new Float64Array(P.length);
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    const g = norm([sdf(x + e, y, z) - sdf(x - e, y, z), sdf(x, y + e, z) - sdf(x, y - e, z), sdf(x, y, z + e) - sdf(x, y, z - e)]);
    N[i] = g[0];
    N[i + 1] = g[1];
    N[i + 2] = g[2];
  }
  return N;
}

/** sdf primitives */
export const sdEllipsoid = (p, r) => {
  const k0 = len([p[0] / r[0], p[1] / r[1], p[2] / r[2]]);
  const k1 = len([p[0] / (r[0] * r[0]), p[1] / (r[1] * r[1]), p[2] / (r[2] * r[2])]);
  return (k0 * (k0 - 1)) / (k1 || 1e-9);
};
export const sdRoundBox = (p, b, r) => {
  const q = [Math.abs(p[0]) - b[0] + r, Math.abs(p[1]) - b[1] + r, Math.abs(p[2]) - b[2] + r];
  return len([Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0)]) + Math.min(Math.max(q[0], Math.max(q[1], q[2])), 0) - r;
};
export const sdCapsule = (p, a, b, r) => {
  const pa = sub(p, a), ba = sub(b, a);
  const h = clamp(dot(pa, ba) / dot(ba, ba), 0, 1);
  return len(sub(pa, scl(ba, h))) - r;
};
/** capsule with radius varying from ra to rb */
export const sdRoundCone = (p, a, b, ra, rb) => {
  const pa = sub(p, a), ba = sub(b, a);
  const h = clamp(dot(pa, ba) / dot(ba, ba), 0, 1);
  return len(sub(pa, scl(ba, h))) - lerp(ra, rb, h);
};
