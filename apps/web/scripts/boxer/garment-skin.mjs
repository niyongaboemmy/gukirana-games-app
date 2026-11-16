// P3-FGT-19B: the separate-garment stage of the boxer build (docs/FIGHT-REALISM-V8.md §Garments). The v7 garments
// were shells offset from the body, each vertex skinned like the body vertex it came from. A v8 garment can be any
// mesh (a modelled vest, an authored trunk, an asset from source-v8/), so it needs its own skinning, derived from the
// body it is worn on:
//
//  - transferWeights: for every garment vertex the closest point on the body surface (a uniform grid over the body
//    triangles; Ericson's closest-point-on-triangle), the body weights interpolated there (barycentric), the top four
//    influences kept and renormalised, then smoothed over the garment's own edges (a loose hem must not inherit a
//    knee crease) — the "data transfer → nearest face interpolated" step of a DCC tool, in the build.
//  - signedDistances / insideShare: how far each garment vertex is outside the skin (negative = inside), along the
//    interpolated body normal — the build-time check that no garment vertex starts inside the body (the runtime
//    check per pose is the fighter-v8 harness).
//
// Pure: tested in world/human/boxer/v8/garment-skin.test.ts.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const addS = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const at = (P, i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];

/** closest point on triangle abc to p → { q, u, v, w } (q = u·a + v·b + w·c), Ericson, Real-Time Collision Detection 5.1.5 */
export function closestOnTri(p, a, b, c) {
  const ab = sub(b, a),
    ac = sub(c, a),
    ap = sub(p, a);
  const d1 = dot(ab, ap),
    d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return { q: a, u: 1, v: 0, w: 0 };
  const bp = sub(p, b);
  const d3 = dot(ab, bp),
    d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return { q: b, u: 0, v: 1, w: 0 };
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return { q: addS(a, ab, v), u: 1 - v, v, w: 0 };
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp),
    d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return { q: c, u: 0, v: 0, w: 1 };
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return { q: addS(a, ac, w), u: 1 - w, v: 0, w };
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return { q: addS(b, sub(c, b), w), u: 0, v: 1 - w, w };
  }
  const den = 1 / (va + vb + vc);
  const v = vb * den,
    w = vc * den;
  return { q: addS(addS(a, ab, v), ac, w), u: 1 - v - w, v, w };
}

/** a uniform grid over the body triangles (each triangle in every cell its bounding box touches) */
export function triGrid(P, tris, cell = 0.04) {
  const g = new Map();
  const k = (x, y, z) => `${x},${y},${z}`;
  for (let t = 0; t < tris.length; t++) {
    const [a, b, c] = tris[t];
    const lo = [0, 1, 2].map((ax) => Math.floor(Math.min(P[a * 3 + ax], P[b * 3 + ax], P[c * 3 + ax]) / cell));
    const hi = [0, 1, 2].map((ax) => Math.floor(Math.max(P[a * 3 + ax], P[b * 3 + ax], P[c * 3 + ax]) / cell));
    for (let x = lo[0]; x <= hi[0]; x++)
      for (let y = lo[1]; y <= hi[1]; y++)
        for (let z = lo[2]; z <= hi[2]; z++) {
          const key = k(x, y, z);
          if (!g.has(key)) g.set(key, []);
          g.get(key).push(t);
        }
  }
  return { cell, cells: g, P, tris };
}

/** the closest body-surface point to p within maxR → { t, u, v, w, q, d } or null */
export function closestSurface(grid, p, maxR = 0.2) {
  const { cell, cells, P, tris } = grid;
  const c0 = p.map((x) => Math.floor(x / cell));
  let best = null;
  const seen = new Set();
  // grow the search shell until the best hit is nearer than the shell (or maxR is passed)
  for (let r = 0; r * cell <= maxR + cell; r++) {
    for (let x = c0[0] - r; x <= c0[0] + r; x++)
      for (let y = c0[1] - r; y <= c0[1] + r; y++)
        for (let z = c0[2] - r; z <= c0[2] + r; z++) {
          if (Math.max(Math.abs(x - c0[0]), Math.abs(y - c0[1]), Math.abs(z - c0[2])) !== r) continue;
          const l = cells.get(`${x},${y},${z}`);
          if (!l) continue;
          for (const t of l) {
            if (seen.has(t)) continue;
            seen.add(t);
            const [a, b, c] = tris[t];
            const h = closestOnTri(p, at(P, a), at(P, b), at(P, c));
            const d = Math.hypot(p[0] - h.q[0], p[1] - h.q[1], p[2] - h.q[2]);
            if (d <= maxR && (!best || d < best.d)) best = { t, ...h, d };
          }
        }
    if (best && best.d < r * cell) break;
  }
  return best;
}

/** dense weights of vertex i (a Map bone → weight) from 4-influence arrays */
const wmap = (J, W, i, into = new Map(), k = 1) => {
  for (let q = 0; q < 4; q++) {
    const w = W[i * 4 + q];
    if (w > 0) into.set(J[i * 4 + q], (into.get(J[i * 4 + q]) ?? 0) + w * k);
  }
  return into;
};
/** the top `n` influences of a weight map, renormalised → [[bone, w], …] */
export function topN(m, n = 4) {
  const e = [...m.entries()].filter((x) => x[1] > 1e-5).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, n);
  const s = e.reduce((a, x) => a + x[1], 0) || 1;
  return e.map(([b, w]) => [b, w / s]);
}

/**
 * Skin a garment from the body it is worn on.
 * @param body { P, tris, J, W } positions (flat), triangles [[a,b,c]], 4-influence joints / weights (flat)
 * @param P garment positions (flat)
 * @param opts { maxDist, smoothIters, lambda, faces (garment faces for the smoothing), pin (vertex → weight map) }
 * @returns { J: Uint16Array, W: Float32Array, dist: Float32Array, unmatched: number }
 */
export function transferWeights(body, P, opts = {}) {
  const { maxDist = 0.25, smoothIters = 2, lambda = 0.5, faces = null } = opts;
  const grid = opts.grid ?? triGrid(body.P, body.tris);
  const n = P.length / 3;
  const maps = new Array(n);
  const dist = new Float32Array(n);
  let unmatched = 0;
  for (let i = 0; i < n; i++) {
    const h = closestSurface(grid, at(P, i), maxDist);
    if (!h) {
      maps[i] = new Map();
      dist[i] = Infinity;
      unmatched++;
      continue;
    }
    const [a, b, c] = body.tris[h.t];
    const m = new Map();
    wmap(body.J, body.W, a, m, h.u);
    wmap(body.J, body.W, b, m, h.v);
    wmap(body.J, body.W, c, m, h.w);
    maps[i] = m;
    dist[i] = h.d;
  }
  // smoothing over the garment's own edges (unmatched vertices take their neighbours' weights)
  if (faces && (smoothIters > 0 || unmatched)) {
    const nb = Array.from({ length: n }, () => new Set());
    for (const f of faces)
      for (let k = 0; k < f.length; k++) {
        nb[f[k]].add(f[(k + 1) % f.length]);
        nb[f[k]].add(f[(k + f.length - 1) % f.length]);
      }
    const iters = Math.max(smoothIters, unmatched ? 8 : 0);
    let cur = maps;
    for (let it = 0; it < iters; it++) {
      cur = cur.map((m, i) => {
        if (!nb[i].size) return m;
        const avg = new Map();
        for (const j of nb[i]) for (const [b, w] of cur[j]) avg.set(b, (avg.get(b) ?? 0) + w / nb[i].size);
        const empty = m.size === 0;
        const lam = empty ? 1 : it < smoothIters ? lambda : 0;
        if (lam === 0) return m;
        const out = new Map();
        for (const [b, w] of m) out.set(b, w * (1 - lam));
        for (const [b, w] of avg) out.set(b, (out.get(b) ?? 0) + w * lam);
        return out;
      });
    }
    for (let i = 0; i < n; i++) maps[i] = cur[i];
  }
  if (opts.pin) for (const [i, m] of opts.pin) maps[i] = m;
  const J = new Uint16Array(n * 4),
    W = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const top = topN(maps[i]);
    top.forEach(([b, w], q) => {
      J[i * 4 + q] = b;
      W[i * 4 + q] = w;
    });
  }
  return { J, W, dist, unmatched };
}

/** area-weighted vertex normals of the body (flat) */
export function vertexNormals(P, tris) {
  const N = new Float64Array(P.length);
  for (const [a, b, c] of tris) {
    const A = at(P, a),
      e1 = sub(at(P, b), A),
      e2 = sub(at(P, c), A);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) N[v * 3 + k] += n[k];
  }
  for (let i = 0; i < N.length; i += 3) {
    const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1;
    N[i] /= l;
    N[i + 1] /= l;
    N[i + 2] /= l;
  }
  return N;
}

/** signed distance of each garment vertex to the body surface (negative = inside), NaN beyond maxDist */
export function signedDistances(body, P, { maxDist = 0.25, grid = null, normals = null } = {}) {
  const g = grid ?? triGrid(body.P, body.tris);
  const N = normals ?? vertexNormals(body.P, body.tris);
  const n = P.length / 3;
  const sd = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = at(P, i);
    const h = closestSurface(g, p, maxDist);
    if (!h) {
      sd[i] = NaN;
      continue;
    }
    const [a, b, c] = body.tris[h.t];
    const nn = [0, 1, 2].map((k) => N[a * 3 + k] * h.u + N[b * 3 + k] * h.v + N[c * 3 + k] * h.w);
    sd[i] = Math.sign(dot(sub(p, h.q), nn) || 1) * h.d;
  }
  return sd;
}

/** share of garment vertices more than `tol` inside the skin (of those near enough to be tested) → { share, inside, tested, worst } */
export function insideShare(sd, tol = 0.002) {
  let inside = 0,
    tested = 0,
    worst = 0;
  for (const d of sd) {
    if (Number.isNaN(d)) continue;
    tested++;
    if (d < -tol) {
      inside++;
      worst = Math.max(worst, -d);
    }
  }
  return { share: tested ? inside / tested : 0, inside, tested, worst };
}
