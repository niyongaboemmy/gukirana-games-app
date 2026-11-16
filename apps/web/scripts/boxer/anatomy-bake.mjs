// Anatomy detail bake for the boxer bodies (P3-FGT-17, docs/HUMAN-REALISM-VR-RESEARCH.md §3 "detail without
// triangles"). Production pipelines bake a sculpted high-poly body onto the game mesh's UVs (normal + cavity maps);
// we have no licensed sculpt, so the "high" is MakeHuman's own most-defined macro shape (max muscle, min fat: the CC0
// sculptors' muscle separations — pectoral shelf, deltoid heads, serratus, abdominal segments, scapular ridges,
// forearm and calf bellies) plus the regional athletic targets, taken as a band-passed height along the normal and
// rasterised into MakeHuman's UV layout (the same layout the skin texture uses).
//
// Output (RGBA8): R, G = tangent-space detail normal (x, y; 128 = flat) on the uv frame (+u, +v of the glTF uv, as
// the shader's derivative frame sees it); B = cavity (128 = flat, darker in grooves); A = 255.
// Pure functions over plain arrays; the PNG writer uses only node:zlib.
import { deflateSync } from "node:zlib";

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

/** neighbours of each vertex over a face list (quads / tris) */
export function neighbours(n, faces) {
  const nb = Array.from({ length: n }, () => new Set());
  for (const f of faces)
    for (let k = 0; k < f.length; k++) {
      nb[f[k]].add(f[(k + 1) % f.length]);
      nb[f[k]].add(f[(k + f.length - 1) % f.length]);
    }
  return nb;
}

/** plain (shrinking) Laplacian smoothing over the given vertices */
export function laplace(P, nb, verts, iters, lam = 0.5) {
  let cur = Float64Array.from(P);
  for (let it = 0; it < iters; it++) {
    const nx = Float64Array.from(cur);
    for (const a of verts) {
      const ns = nb[a];
      if (!ns.size) continue;
      let x = 0, y = 0, z = 0;
      for (const q of ns) {
        x += cur[q * 3];
        y += cur[q * 3 + 1];
        z += cur[q * 3 + 2];
      }
      const n = ns.size;
      nx[a * 3] = cur[a * 3] + lam * (x / n - cur[a * 3]);
      nx[a * 3 + 1] = cur[a * 3 + 1] + lam * (y / n - cur[a * 3 + 1]);
      nx[a * 3 + 2] = cur[a * 3 + 2] + lam * (z / n - cur[a * 3 + 2]);
    }
    cur = nx;
  }
  return cur;
}

/** area-weighted vertex normals */
export function vertexNormals(P, faces, n) {
  const N = new Float64Array(n * 3);
  for (const f of faces)
    for (let k = 0; k < f.length; k++) {
      const a = f[k], b = f[(k + 1) % f.length], c = f[(k + f.length - 1) % f.length];
      const pa = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]];
      const nn = cross(sub([P[b * 3], P[b * 3 + 1], P[b * 3 + 2]], pa), sub([P[c * 3], P[c * 3 + 1], P[c * 3 + 2]], pa));
      N[a * 3] += nn[0];
      N[a * 3 + 1] += nn[1];
      N[a * 3 + 2] += nn[2];
    }
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1;
    N[i * 3] /= l;
    N[i * 3 + 1] /= l;
    N[i * 3 + 2] /= l;
  }
  return N;
}

/**
 * Band-passed height (m) per vertex: the shape's detail between `fine` and `coarse` smoothing (a difference of
 * Laplacians — muscle separations, not the whole limb's roundness, not the mesh's own facets), along the normal.
 */
export function bandHeight(P, faces, verts, n, { fine = 1, coarse = 14 } = {}) {
  const nb = neighbours(n, faces);
  const a = fine > 0 ? laplace(P, nb, verts, fine) : P;
  const b = laplace(P, nb, verts, coarse);
  const N = vertexNormals(b, faces, n);
  const H = new Float64Array(n);
  for (const i of verts) H[i] = (a[i * 3] - b[i * 3]) * N[i * 3] + (a[i * 3 + 1] - b[i * 3 + 1]) * N[i * 3 + 1] + (a[i * 3 + 2] - b[i * 3 + 2]) * N[i * 3 + 2];
  return H;
}

/**
 * Rasterise a per-vertex height into uv space and turn it into a detail normal + cavity image.
 *  tris: [[[v, uv], [v, uv], [v, uv]], ...] (uv = index into `uvOf`); uvOf(k) → [u, v] (glTF, top-down v);
 *  P: positions (m) for the texel scale; H: per-vertex height (m); mask(v) → 0..1 (fade the detail, e.g. off the face).
 */
export function bakeDetail({ tris, uvOf, P, H, mask = () => 1, size = 1024, blur = 1.6, gain = 1, cavityGain = 900 }) {
  const S = size;
  const hSum = new Float64Array(S * S);
  const wSum = new Float64Array(S * S);
  const su = new Float64Array(S * S); // metres per uv unit along u
  const sv = new Float64Array(S * S);
  for (const t of tris) {
    const uv = t.map(([, k]) => uvOf(k));
    const p = t.map(([v]) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]);
    const h = t.map(([v]) => H[v] * mask(v));
    // uv → position Jacobian: dP/du, dP/dv
    const du1 = uv[1][0] - uv[0][0], dv1 = uv[1][1] - uv[0][1];
    const du2 = uv[2][0] - uv[0][0], dv2 = uv[2][1] - uv[0][1];
    const det = du1 * dv2 - du2 * dv1;
    if (Math.abs(det) < 1e-12) continue;
    const e1 = sub(p[1], p[0]), e2 = sub(p[2], p[0]);
    const dPdu = [0, 1, 2].map((c) => (e1[c] * dv2 - e2[c] * dv1) / det);
    const dPdv = [0, 1, 2].map((c) => (e2[c] * du1 - e1[c] * du2) / det);
    const lu = len(dPdu), lv = len(dPdv);
    const xs = uv.map((q) => q[0] * S - 0.5), ys = uv.map((q) => q[1] * S - 0.5);
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(S - 1, Math.ceil(Math.max(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(S - 1, Math.ceil(Math.max(...ys)));
    const d = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0]);
    if (Math.abs(d) < 1e-9) continue;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const b1 = ((x - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (y - ys[0])) / d;
        const b2 = ((xs[1] - xs[0]) * (y - ys[0]) - (x - xs[0]) * (ys[1] - ys[0])) / d;
        const b0 = 1 - b1 - b2;
        // (a half-texel margin: neighbouring triangles overlap a little, no cracks)
        if (b0 < -0.02 || b1 < -0.02 || b2 < -0.02) continue;
        const k = y * S + x;
        hSum[k] += h[0] * b0 + h[1] * b1 + h[2] * b2;
        wSum[k] += 1;
        su[k] += lu;
        sv[k] += lv;
      }
  }
  const cov = new Uint8Array(S * S);
  let Hm = new Float64Array(S * S);
  for (let k = 0; k < S * S; k++)
    if (wSum[k]) {
      cov[k] = 1;
      Hm[k] = hSum[k] / wSum[k];
      su[k] /= wSum[k];
      sv[k] /= wSum[k];
    }
  // normalised Gaussian blur inside the covered texels (no bleeding across uv islands' empty gutters)
  const g = [];
  const R = Math.ceil(blur * 2.5);
  for (let i = -R; i <= R; i++) g.push(Math.exp(-(i * i) / (2 * blur * blur)));
  const pass = (src, dx, dy) => {
    const o = new Float64Array(S * S);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const k = y * S + x;
        if (!cov[k]) continue;
        let s = 0, w = 0;
        for (let i = -R; i <= R; i++) {
          const xx = x + i * dx, yy = y + i * dy;
          if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue;
          const q = yy * S + xx;
          if (!cov[q]) continue;
          s += src[q] * g[i + R];
          w += g[i + R];
        }
        o[k] = w ? s / w : src[k];
      }
    return o;
  };
  Hm = pass(pass(Hm, 1, 0), 0, 1);
  const out = new Uint8Array(S * S * 4);
  const at = (x, y) => {
    x = Math.max(0, Math.min(S - 1, x));
    y = Math.max(0, Math.min(S - 1, y));
    return y * S + x;
  };
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const k = y * S + x;
      let nx = 0, ny = 0, cav = 0;
      if (cov[k]) {
        const hl = cov[at(x - 1, y)] ? Hm[at(x - 1, y)] : Hm[k];
        const hr = cov[at(x + 1, y)] ? Hm[at(x + 1, y)] : Hm[k];
        const hu = cov[at(x, y - 1)] ? Hm[at(x, y - 1)] : Hm[k];
        const hd = cov[at(x, y + 1)] ? Hm[at(x, y + 1)] : Hm[k];
        // slope along the surface: Δh / (2 texels in uv × metres per uv)
        const sx = (hr - hl) / ((2 / S) * (su[k] || 1));
        const sy = (hd - hu) / ((2 / S) * (sv[k] || 1));
        nx = -sx * gain;
        ny = -sy * gain;
        cav = Hm[k] * cavityGain;
      }
      out[k * 4] = Math.round(Math.max(0, Math.min(255, 128 + nx * 127)));
      out[k * 4 + 1] = Math.round(Math.max(0, Math.min(255, 128 + ny * 127)));
      out[k * 4 + 2] = Math.round(Math.max(0, Math.min(255, 128 + cav * 127)));
      out[k * 4 + 3] = 255;
    }
  // dilate into the gutters (8 passes): mip-mapping never pulls in a flat / black border at uv seams
  for (let pass2 = 0; pass2 < 8; pass2++) {
    const fill = [];
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const k = y * S + x;
        if (cov[k]) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const q = at(x + dx, y + dy);
          if (cov[q]) {
            fill.push([k, q]);
            break;
          }
        }
      }
    for (const [k, q] of fill) {
      out.copyWithin(k * 4, q * 4, q * 4 + 3);
      cov[k] = 1;
    }
  }
  return { rgba: out, size: S, coverage: cov };
}

/** a minimal RGBA8 PNG encoder */
export function encodePng(rgba, w, h) {
  const crcT = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const crc = (buf) => {
    let c = -1;
    for (const b of buf) c = crcT[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const t = Buffer.from(type, "ascii");
    const l = Buffer.alloc(4);
    l.writeUInt32BE(data.length);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(Buffer.concat([t, data])));
    return Buffer.concat([l, t, data, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
