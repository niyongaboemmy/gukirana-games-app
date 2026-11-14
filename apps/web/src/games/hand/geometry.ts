import { B, FINGER_DIMS, REST, THUMB_DIMS, quat, v3, type V3 } from "./rig";

/**
 * Procedural high-detail hand + forearm mesh (P2-GAME-07).
 *
 * The avatar bodies' hands are ~100 vertices each (fine at world distance, faceted when a hand fills a quarter of
 * the screen), so the game hand is sculpted here as a signed distance field — palm slab, metacarpal ridges,
 * knuckles, thenar / hypothenar pads, tapered phalanges with finger pads, wrist bones and the forearm — blended with
 * smooth unions and meshed with surface nets on a narrow band (vertices projected onto the exact surface, normals
 * from the field gradient). Skin weights follow the joint creases (smooth steps along each finger), and a per-vertex
 * region attribute carries palm / nail / knuckle / flush masks for the skin shader. Deterministic, no randomness.
 */

type Prim =
  | { t: "cone"; a: V3; b: V3; ra: number; rb: number; zs: number; g: number }
  | { t: "ell"; c: V3; r: V3; m: number[] | null; g: number }
  | { t: "palm"; g: number };

/** chain ids */
const ARM = 0, PALM = 1, THENAR = 2, THUMB = 3; // fingers: 4 + i
type Tagged = Prim & { chain: number; lo: V3; hi: V3 };

const PALM_Y0 = 0.004, PALM_Y1 = 0.088;

function primsFor(): Tagged[] {
  const out: Tagged[] = [];
  const add = (p: Prim, chain: number) => {
    let lo: V3, hi: V3;
    if (p.t === "cone") {
      const r = Math.max(p.ra, p.rb) / Math.min(1, p.zs) + 0.016;
      lo = [Math.min(p.a[0], p.b[0]) - r, Math.min(p.a[1], p.b[1]) - r, Math.min(p.a[2], p.b[2]) - r];
      hi = [Math.max(p.a[0], p.b[0]) + r, Math.max(p.a[1], p.b[1]) + r, Math.max(p.a[2], p.b[2]) + r];
    } else if (p.t === "ell") {
      const r = Math.max(...p.r) + 0.016;
      lo = [p.c[0] - r, p.c[1] - r, p.c[2] - r];
      hi = [p.c[0] + r, p.c[1] + r, p.c[2] + r];
    } else {
      lo = [-0.06, PALM_Y0 - 0.03, -0.04];
      hi = [0.06, PALM_Y1 + 0.03, 0.04];
    }
    out.push({ ...p, chain, lo, hi } as Tagged);
  };
  // forearm (elliptic: wider than thick), wrist, ulnar styloid bump
  add({ t: "cone", a: [0, -0.012, 0], b: [0, -0.36, 0.002], ra: 0.0262, rb: 0.037, zs: 0.72, g: 0 }, ARM);
  add({ t: "ell", c: [0.0005, 0.004, -0.0012], r: [0.0272, 0.021, 0.0188], m: null, g: 0 }, ARM);
  add({ t: "ell", c: [0.0205, -0.014, 0.0072], r: [0.0052, 0.0072, 0.0048], m: null, g: 0 }, ARM);
  // palm: slab + metacarpal ridges + knuckles (metacarpal heads) + pads
  add({ t: "palm", g: 1 }, PALM);
  FINGER_DIMS.forEach((f) => {
    add({ t: "cone", a: [f.base[0], f.base[1], 0.002], b: [f.knuckle[0], f.knuckle[1] - 0.006, 0.0035], ra: 0.0085, rb: f.r[0] * 0.98, zs: 0.7, g: 1 }, PALM);
    add({ t: "ell", c: [f.knuckle[0], f.knuckle[1] - 0.001, f.knuckle[2] + 0.0045], r: [f.r[0] * 0.9, f.r[0] * 0.98, f.r[0] * 0.8], m: null, g: 1 }, PALM);
  });
  add({ t: "ell", c: [0.0255, 0.036, -0.0075], r: [0.0128, 0.0315, 0.0112], m: null, g: 1 }, PALM);
  add({ t: "ell", c: [-0.0255, 0.036, -0.0095], r: [0.0185, 0.031, 0.0148], m: rotZ(0.5), g: 2 }, THENAR);
  // thumb
  {
    let p = THUMB_DIMS.cmc;
    for (let k = 0; k < 3; k++) {
      const len = THUMB_DIMS.len[k]! - (k === 2 ? THUMB_DIMS.r[3] : 0);
      const q = v3.add(p, v3.scale(THUMB_DIMS.dir, len));
      add({ t: "cone", a: p, b: q, ra: THUMB_DIMS.r[k]!, rb: THUMB_DIMS.r[k + 1]!, zs: k === 0 ? 0.85 : 0.86, g: 3 }, THUMB);
      p = v3.add(p, v3.scale(THUMB_DIMS.dir, THUMB_DIMS.len[k]!));
    }
    // the thumb's fleshy pad
    const b2 = REST[B.thumb(2)]!;
    const nailDir = THUMB_DIMS.nail;
    add({ t: "ell", c: v3.add(v3.add(b2.pos, v3.scale(THUMB_DIMS.dir, 0.013)), v3.scale(nailDir, -0.0035)), r: [0.0088, 0.0125, 0.0068], m: basisMat(THUMB_DIMS.dir, nailDir), g: 3 }, THUMB);
  }
  // fingers: tapered phalanges + ventral pads
  FINGER_DIMS.forEach((f, i) => {
    const rot = REST[B.phal(i, 0)]!.rot;
    const dir = quat.rotate(rot, [0, 1, 0]);
    const dors = quat.rotate(rot, [0, 0, 1]);
    let p: V3 = f.knuckle;
    for (let k = 0; k < 3; k++) {
      const len = f.len[k]! - (k === 2 ? f.r[3] : 0);
      const q = v3.add(p, v3.scale(dir, len));
      add({ t: "cone", a: p, b: q, ra: f.r[k]!, rb: f.r[k + 1]!, zs: 0.9, g: 4 + i }, 4 + i);
      // pad: a soft fullness on the palm side of each phalanx (largest on the fingertip)
      const mid = v3.add(p, v3.scale(dir, f.len[k]! * (k === 2 ? 0.52 : 0.5)));
      const rr = f.r[k + 1]!;
      add({ t: "ell", c: v3.add(mid, v3.scale(dors, -rr * (k === 2 ? 0.3 : 0.34))), r: [rr * 0.84, f.len[k]! * (k === 2 ? 0.36 : 0.4), rr * 0.66], m: basisMat(dir, dors), g: 4 + i }, 4 + i);
      p = v3.add(p, v3.scale(dir, f.len[k]!));
    }
  });
  return out;
}

function rotZ(a: number): number[] {
  const c = Math.cos(a), s = Math.sin(a);
  // world → local (transpose of the local → world rotation)
  return [c, s, 0, -s, c, 0, 0, 0, 1];
}
/** World → local matrix (rows = local X, Y, Z axes) for a frame with local Y = `y`, local Z ≈ `z`. */
function basisMat(y: V3, z: V3): number[] {
  const Y = v3.norm(y);
  const X = v3.norm(v3.cross(Y, z));
  const Z = v3.cross(X, Y);
  return [...X, ...Y, ...Z];
}

/* ---------- distance functions ---------- */

function sdCone(px: number, py: number, pz: number, a: V3, b: V3, r1: number, r2: number, zs: number): number {
  // anisotropic: squash z (hand space) so the cross-section is an ellipse; the zero set stays exact
  const iz = 1 / zs;
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = (b[2] - a[2]) * iz;
  const pax = px - a[0], pay = py - a[1], paz = (pz - a[2]) * iz;
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const y = pax * bax + pay * bay + paz * baz;
  const z = y - l2;
  const xx = pax * l2 - bax * y, xy = pay * l2 - bay * y, xz = paz * l2 - baz * y;
  const x2 = xx * xx + xy * xy + xz * xz;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  let d: number;
  if (Math.sign(z) * a2 * z2 > k) d = Math.sqrt(x2 + z2) * il2 - r2;
  else if (Math.sign(y) * a2 * y2 < k) d = Math.sqrt(x2 + y2) * il2 - r1;
  else d = (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
  return d * (zs < 1 ? 0.5 + 0.5 * zs : 1);
}

function sdEll(px: number, py: number, pz: number, c: V3, r: V3, m: number[] | null): number {
  let x = px - c[0], y = py - c[1], z = pz - c[2];
  if (m) {
    const lx = m[0]! * x + m[1]! * y + m[2]! * z;
    const ly = m[3]! * x + m[4]! * y + m[5]! * z;
    const lz = m[6]! * x + m[7]! * y + m[8]! * z;
    x = lx; y = ly; z = lz;
  }
  const k0 = Math.hypot(x / r[0], y / r[1], z / r[2]);
  const k1 = Math.hypot(x / (r[0] * r[0]), y / (r[1] * r[1]), z / (r[2] * r[2]));
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(...r);
}

/** Palm slab: a rounded box that widens from the wrist to the knuckles, domed across the back of the hand. */
function sdPalm(px: number, py: number, pz: number): number {
  const t = Math.min(1, Math.max(0, (py - PALM_Y0) / (PALM_Y1 - PALM_Y0)));
  const hw = 0.0255 + (0.0372 - 0.0255) * Math.sqrt(t);
  const cx = 0.0018 + 0.0012 * t;
  const x = px - cx;
  const z = pz + 0.0015 + 6.5 * x * x; // dorsal dome: the sides of the hand sit lower
  const hz = 0.0098 + 0.0012 * (1 - t);
  const r = 0.0085;
  const qx = Math.abs(x) - hw + r;
  const qy = Math.abs(py - (PALM_Y0 + PALM_Y1) / 2) - (PALM_Y1 - PALM_Y0) / 2 + r;
  const qz = Math.abs(z) - hz + r;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.hypot(ox, oy, oz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - r;
}

function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

const BIG = 1;
/** Group blend radii. */
const K_PALM = 0.0085, K_ARM = 0.012, K_HAND_ARM = 0.014, K_THENAR = 0.012, K_THUMB = 0.0125, K_FINGER = 0.0072, K_SEG = 0.002;

export interface HandSdf {
  prims: Tagged[];
  /** field value; fills `per` (per-primitive distance) when given */
  d: (x: number, y: number, z: number, per?: Float64Array) => number;
}

export function makeSdf(): HandSdf {
  const prims = primsFor();
  const n = prims.length;
  const dist = (p: Tagged, x: number, y: number, z: number) => {
    if (x < p.lo[0] || y < p.lo[1] || z < p.lo[2] || x > p.hi[0] || y > p.hi[1] || z > p.hi[2]) {
      // outside the primitive's box: a cheap lower bound is enough (it cannot win a blend there)
      const dx = Math.max(p.lo[0] - x, 0, x - p.hi[0]), dy = Math.max(p.lo[1] - y, 0, y - p.hi[1]), dz = Math.max(p.lo[2] - z, 0, z - p.hi[2]);
      return Math.hypot(dx, dy, dz) + 0.016;
    }
    if (p.t === "cone") return sdCone(x, y, z, p.a, p.b, p.ra, p.rb, p.zs);
    if (p.t === "ell") return sdEll(x, y, z, p.c, p.r, p.m);
    return sdPalm(x, y, z);
  };
  const d = (x: number, y: number, z: number, per?: Float64Array) => {
    let arm = BIG, palm = BIG, thenar = BIG, thumb = BIG;
    const fingers = [BIG, BIG, BIG, BIG];
    for (let i = 0; i < n; i++) {
      const p = prims[i]!;
      const v = dist(p, x, y, z);
      if (per) per[i] = v;
      if (p.g === 0) arm = arm === BIG ? v : smin(arm, v, K_ARM);
      else if (p.g === 1) palm = palm === BIG ? v : smin(palm, v, K_PALM);
      else if (p.g === 2) thenar = v;
      else if (p.g === 3) thumb = thumb === BIG ? v : smin(thumb, v, K_SEG * 1.5);
      else fingers[p.g - 4] = fingers[p.g - 4] === BIG ? v : smin(fingers[p.g - 4]!, v, K_SEG);
    }
    let h = smin(palm, arm, K_HAND_ARM);
    h = smin(h, thenar, K_THENAR);
    h = smin(h, thumb, K_THUMB);
    // fingers blend into the palm (the webs) but never into each other
    const f = Math.min(fingers[0]!, fingers[1]!, fingers[2]!, fingers[3]!);
    return smin(h, f, K_FINGER);
  };
  return { prims, d };
}

/* ---------- meshing ---------- */

export interface HandMesh {
  position: Float32Array;
  normal: Float32Array;
  /** 4 bone indices per vertex */
  skinIndex: Uint16Array;
  /** 4 weights per vertex (sum 1) */
  skinWeight: Float32Array;
  /** R palm side · G nail · B knuckle creases · A flush (fingertips, knuckles), 0–255 */
  region: Uint8Array;
  index: Uint32Array;
  vertexCount: number;
}

export interface MeshOptions {
  /** voxel size in the hand (m); the forearm is meshed coarser */
  cell?: number;
  /** forearm end (y, m): skin past the sleeve is never seen */
  armEnd?: number;
}

/**
 * Narrow-band surface nets over a rectilinear grid (fine through the hand, coarser down the forearm).
 */
export function buildHandMesh(opts: MeshOptions = {}): HandMesh {
  const h = opts.cell ?? 0.0017;
  const armEnd = opts.armEnd ?? -0.345;
  const sdf = makeSdf();
  const x0 = -0.1, x1 = 0.058, z0 = -0.032, z1 = 0.03;
  const xs: number[] = [];
  for (let x = x0; x <= x1 + 1e-9; x += h) xs.push(x);
  const zs: number[] = [];
  for (let z = z0; z <= z1 + 1e-9; z += h) zs.push(z);
  // y: fine from the wrist up, growing to 3× down the forearm
  const ys: number[] = [];
  for (let y = 0.218; y >= -0.05; y -= h) ys.push(y);
  let y = ys[ys.length - 1]!;
  while (y > armEnd) {
    const k = Math.min(3, 1 + (-0.05 - y) / 0.05);
    y -= h * k;
    ys.push(Math.max(y, armEnd));
  }
  ys.reverse();
  const nx = xs.length, ny = ys.length, nz = zs.length;
  const idx = (i: number, j: number, k: number) => (k * ny + j) * nx + i;
  const vals = new Float32Array(nx * ny * nz);

  // coarse lattice (every 3rd sample) decides where the surface can be
  const S = 3;
  const cx = Math.ceil((nx - 1) / S) + 1, cy = Math.ceil((ny - 1) / S) + 1, cz = Math.ceil((nz - 1) / S) + 1;
  const ci = (I: number) => Math.min(I * S, nx - 1), cj = (J: number) => Math.min(J * S, ny - 1), ck = (K: number) => Math.min(K * S, nz - 1);
  const coarse = new Float32Array(cx * cy * cz);
  for (let K = 0; K < cz; K++) for (let J = 0; J < cy; J++) for (let I = 0; I < cx; I++) coarse[(K * cy + J) * cx + I] = sdf.d(xs[ci(I)]!, ys[cj(J)]!, zs[ck(K)]!);
  for (let k = 0; k < nz; k++) {
    const K = Math.min(Math.floor(k / S), cz - 2);
    for (let j = 0; j < ny; j++) {
      const J = Math.min(Math.floor(j / S), cy - 2);
      const diag = Math.hypot(xs[ci(1)]! - xs[ci(0)]!, ys[cj(J + 1)]! - ys[cj(J)]!, zs[ck(K + 1)]! - zs[ck(K)]!);
      const band = diag * 1.6;
      for (let i = 0; i < nx; i++) {
        const I = Math.min(Math.floor(i / S), cx - 2);
        let near = false;
        let sgn = 0;
        for (let c = 0; c < 8 && !near; c++) {
          const v = coarse[((K + (c >> 2)) * cy + J + ((c >> 1) & 1)) * cx + I + (c & 1)]!;
          if (Math.abs(v) < band) near = true;
          sgn += v;
        }
        vals[idx(i, j, k)] = near ? sdf.d(xs[i]!, ys[j]!, zs[k]!) : sgn > 0 ? 0.05 : -0.05;
      }
    }
  }

  // one vertex per sign-changing cell, at the mean of its edge crossings, then projected onto the surface
  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cIdx = (i: number, j: number, k: number) => (k * (ny - 1) + j) * (nx - 1) + i;
  const pos: number[] = [];
  const EDGES = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const cv = new Float64Array(8);
  const cp = new Float64Array(24);
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const ii = i + (c & 1), jj = j + ((c >> 1) & 1), kk = k + (c >> 2);
          const v = vals[idx(ii, jj, kk)]!;
          cv[c] = v;
          cp[c * 3] = xs[ii]!;
          cp[c * 3 + 1] = ys[jj]!;
          cp[c * 3 + 2] = zs[kk]!;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, m = 0;
        for (const [a, b] of EDGES) {
          const va = cv[a!]!, vb = cv[b!]!;
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          sx += cp[a! * 3]! + (cp[b! * 3]! - cp[a! * 3]!) * t;
          sy += cp[a! * 3 + 1]! + (cp[b! * 3 + 1]! - cp[a! * 3 + 1]!) * t;
          sz += cp[a! * 3 + 2]! + (cp[b! * 3 + 2]! - cp[a! * 3 + 2]!) * t;
          m++;
        }
        cellVert[cIdx(i, j, k)] = pos.length / 3;
        pos.push(sx / m, sy / m, sz / m);
      }
  const vc = pos.length / 3;
  const P = new Float32Array(pos);
  const N = new Float32Array(vc * 3);
  const e = 0.00025;
  for (let v = 0; v < vc; v++) {
    let px = P[v * 3]!, py = P[v * 3 + 1]!, pz = P[v * 3 + 2]!;
    let gx = 0, gy = 0, gz = 1;
    for (let it = 0; it < 3; it++) {
      const d0 = sdf.d(px, py, pz);
      gx = sdf.d(px + e, py, pz) - sdf.d(px - e, py, pz);
      gy = sdf.d(px, py + e, pz) - sdf.d(px, py - e, pz);
      gz = sdf.d(px, py, pz + e) - sdf.d(px, py, pz - e);
      const g2 = (gx * gx + gy * gy + gz * gz) / (4 * e * e);
      if (g2 < 1e-6) break;
      const s = d0 / g2 / (2 * e);
      // never move more than a cell (keeps thin webs from collapsing)
      const mx = Math.max(-h, Math.min(h, -s * gx)), my = Math.max(-h, Math.min(h, -s * gy)), mz = Math.max(-h, Math.min(h, -s * gz));
      px += mx;
      py += my;
      pz += mz;
      if (Math.abs(d0) < 1e-6) break;
    }
    P[v * 3] = px;
    P[v * 3 + 1] = py;
    P[v * 3 + 2] = pz;
    const gl = Math.hypot(gx, gy, gz) || 1;
    N[v * 3] = gx / gl;
    N[v * 3 + 1] = gy / gl;
    N[v * 3 + 2] = gz / gl;
  }

  // quads: one per sign-changing grid edge, joining the four cells around it
  const tris: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) [b, d] = [d, b];
    // split along the shorter diagonal
    const dac = (P[a * 3]! - P[c * 3]!) ** 2 + (P[a * 3 + 1]! - P[c * 3 + 1]!) ** 2 + (P[a * 3 + 2]! - P[c * 3 + 2]!) ** 2;
    const dbd = (P[b * 3]! - P[d * 3]!) ** 2 + (P[b * 3 + 1]! - P[d * 3 + 1]!) ** 2 + (P[b * 3 + 2]! - P[d * 3 + 2]!) ** 2;
    if (dac < dbd) tris.push(a, b, c, a, c, d);
    else tris.push(a, b, d, b, c, d);
  };
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const v0 = vals[idx(i, j, k)]! < 0;
        if (i < nx - 1 && j > 0 && k > 0 && j < ny - 1 && k < nz - 1 && v0 !== vals[idx(i + 1, j, k)]! < 0)
          quad(cellVert[cIdx(i, j - 1, k - 1)]!, cellVert[cIdx(i, j, k - 1)]!, cellVert[cIdx(i, j, k)]!, cellVert[cIdx(i, j - 1, k)]!, !v0);
        if (j < ny - 1 && i > 0 && k > 0 && i < nx - 1 && k < nz - 1 && v0 !== vals[idx(i, j + 1, k)]! < 0)
          quad(cellVert[cIdx(i - 1, j, k - 1)]!, cellVert[cIdx(i - 1, j, k)]!, cellVert[cIdx(i, j, k)]!, cellVert[cIdx(i, j, k - 1)]!, !v0);
        if (k < nz - 1 && i > 0 && j > 0 && i < nx - 1 && j < ny - 1 && v0 !== vals[idx(i, j, k + 1)]! < 0)
          quad(cellVert[cIdx(i - 1, j - 1, k)]!, cellVert[cIdx(i, j - 1, k)]!, cellVert[cIdx(i, j, k)]!, cellVert[cIdx(i - 1, j, k)]!, !v0);
      }

  const { skinIndex, skinWeight, region } = skinAndRegions(sdf, P, N, vc);
  return { position: P, normal: N, skinIndex, skinWeight, region, index: new Uint32Array(tris), vertexCount: vc };
}

const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function skinAndRegions(sdf: HandSdf, P: Float32Array, N: Float32Array, vc: number) {
  const skinIndex = new Uint16Array(vc * 4);
  const skinWeight = new Float32Array(vc * 4);
  const region = new Uint8Array(vc * 4);
  const per = new Float64Array(sdf.prims.length);
  const fingerFrames = FINGER_DIMS.map((f, i) => {
    const rot = REST[B.phal(i, 0)]!.rot;
    return { k: f.knuckle, dir: quat.rotate(rot, [0, 1, 0]), x: quat.rotate(rot, [1, 0, 0]), z: quat.rotate(rot, [0, 0, 1]) };
  });
  const tdir = THUMB_DIMS.dir, tnail = THUMB_DIMS.nail, tx = v3.norm(v3.cross(tdir, tnail));
  const metaLine = (i: number, y: number) => {
    const f = FINGER_DIMS[i]!;
    const t = Math.min(1, Math.max(0, (y - f.base[1]) / (f.knuckle[1] - f.base[1])));
    return f.base[0] + (f.knuckle[0] - f.base[0]) * t;
  };
  const w = new Map<number, number>();
  const addW = (b: number, x: number) => x > 1e-4 && w.set(b, (w.get(b) ?? 0) + x);

  for (let v = 0; v < vc; v++) {
    const px = P[v * 3]!, py = P[v * 3 + 1]!, pz = P[v * 3 + 2]!;
    const nx = N[v * 3]!, ny = N[v * 3 + 1]!, nz = N[v * 3 + 2]!;
    sdf.d(px, py, pz, per);
    // nearest primitive decides the chain
    let best = 0;
    for (let i = 1; i < per.length; i++) if (per[i]! < per[best]!) best = i;
    let chain = sdf.prims[best]!.chain;
    // knuckle-side palm vertices that sit closer to a finger than to the palm belong to that finger
    w.clear();
    let palmSide = 0, nail = 0, crease = 0, flush = 0;
    const wristT = sstep(-0.013, 0.011, py);
    if (chain >= 4) {
      const i = chain - 4;
      const f = FINGER_DIMS[i]!;
      const fr = fingerFrames[i]!;
      const rel: V3 = [px - fr.k[0], py - fr.k[1], pz - fr.k[2]];
      const u = v3.dot(rel, fr.dir);
      const lat = v3.dot(rel, fr.x);
      const j1 = f.len[0], j2 = f.len[0] + f.len[1];
      const t0 = sstep(-0.55 * f.r[0], 0.6 * f.r[0], u);
      const t1 = sstep(j1 - 0.5 * f.r[1], j1 + 0.55 * f.r[1], u);
      const t2 = sstep(j2 - 0.5 * f.r[2], j2 + 0.55 * f.r[2], u);
      addW(B.meta(i), 1 - t0);
      addW(B.phal(i, 0), t0 * (1 - t1));
      addW(B.phal(i, 1), t1 * (1 - t2));
      addW(B.phal(i, 2), t2);
      const dn = nx * fr.z[0] + ny * fr.z[1] + nz * fr.z[2];
      palmSide = sstep(0.12, -0.42, dn);
      const ud = u - j2;
      const L3 = f.len[2];
      nail = sstep(0.24 * L3, 0.36 * L3, ud) * sstep(L3 + 0.2 * f.r[3], L3 - 0.45 * f.r[3], ud) * sstep(0.8 * f.r[2], 0.6 * f.r[2], Math.abs(lat)) * sstep(0.3, 0.62, dn);
      const near = (uj: number, r: number) => Math.exp(-(((u - uj) / (0.55 * r)) ** 2));
      crease = Math.max(near(j1, f.r[1]), near(j2, f.r[2]) * 0.8, near(0.004, f.r[0]) * 0.6) * sstep(0.05, 0.5, dn);
      flush = Math.max(sstep(j2 + 0.4 * L3, j2 + L3, u) * 0.9, near(j1, f.r[1]) * sstep(0.1, 0.6, dn) * 0.5);
    } else if (chain === THUMB) {
      const rel: V3 = [px - THUMB_DIMS.cmc[0], py - THUMB_DIMS.cmc[1], pz - THUMB_DIMS.cmc[2]];
      const u = v3.dot(rel, tdir);
      const lat = v3.dot(rel, tx);
      const [L0, L1, L2] = THUMB_DIMS.len;
      const r = THUMB_DIMS.r;
      const t0 = sstep(0.004, 0.022, u);
      const t1 = sstep(L0! - 0.55 * r[1]!, L0! + 0.6 * r[1]!, u);
      const t2 = sstep(L0! + L1! - 0.5 * r[2]!, L0! + L1! + 0.55 * r[2]!, u);
      addW(B.hand, 1 - t0);
      addW(B.thumb(0), t0 * (1 - t1));
      addW(B.thumb(1), t1 * (1 - t2));
      addW(B.thumb(2), t2);
      const dn = nx * tnail[0] + ny * tnail[1] + nz * tnail[2];
      palmSide = sstep(0.1, -0.45, dn);
      const ud = u - L0! - L1!;
      nail = sstep(0.28 * L2!, 0.4 * L2!, ud) * sstep(L2! + 0.15 * r[3]!, L2! - 0.5 * r[3]!, ud) * sstep(0.85 * r[2]!, 0.62 * r[2]!, Math.abs(lat)) * sstep(0.3, 0.62, dn);
      const near = (uj: number, rr: number) => Math.exp(-(((u - uj) / (0.6 * rr)) ** 2));
      crease = Math.max(near(L0! + L1!, r[2]!), near(L0!, r[1]!) * 0.7) * sstep(0.05, 0.5, dn);
      flush = sstep(L0! + L1! + 0.4 * L2!, L0! + L1! + L2!, u) * 0.9;
    } else if (chain === THENAR) {
      const rel: V3 = [px - THUMB_DIMS.cmc[0], py - THUMB_DIMS.cmc[1], pz - THUMB_DIMS.cmc[2]];
      const u = Math.max(0, v3.dot(rel, tdir));
      const t = sstep(0, THUMB_DIMS.len[0]!, u) * 0.55;
      addW(B.thumb(0), t * wristT);
      addW(B.hand, (1 - t) * wristT);
      addW(B.arm, 1 - wristT);
      palmSide = sstep(0.25, -0.35, nz);
      flush = 0.25 * palmSide;
    } else if (chain === PALM) {
      const s = sstep(0.018, 0.08, py) * wristT;
      let tot = 0;
      const g = [0, 0, 0, 0];
      for (let i = 0; i < 4; i++) {
        g[i] = Math.exp(-(((px - metaLine(i, py)) / 0.0085) ** 2));
        tot += g[i]!;
      }
      for (let i = 0; i < 4; i++) addW(B.meta(i), (s * g[i]!) / (tot || 1));
      addW(B.hand, (1 - s) * wristT);
      addW(B.arm, 1 - wristT);
      palmSide = sstep(0.22, -0.38, nz);
      // dorsal knuckles (metacarpal heads) get creases and a little flush
      const kn = Math.max(...FINGER_DIMS.map((f) => Math.exp(-(((px - f.knuckle[0]) / 0.009) ** 2 + ((py - f.knuckle[1]) / 0.009) ** 2))));
      crease = kn * sstep(0.2, 0.7, nz) * 0.7;
      flush = kn * sstep(0.2, 0.7, nz) * 0.45 + palmSide * 0.15;
      chain = PALM;
    } else {
      addW(B.hand, wristT);
      addW(B.arm, 1 - wristT);
      palmSide = 0.55 * sstep(0.25, -0.65, nz);
      // the wrist's own creases on the palm side
      crease = Math.exp(-(((py + 0.006) / 0.006) ** 2)) * sstep(0, -0.6, nz) * 0.6;
    }
    // top 4 influences, normalised
    const entries = [...w.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = entries.reduce((a, [, x]) => a + x, 0) || 1;
    for (let k = 0; k < 4; k++) {
      const en = entries[k];
      skinIndex[v * 4 + k] = en ? en[0] : 0;
      skinWeight[v * 4 + k] = en ? en[1] / sum : 0;
    }
    if (!entries.length) {
      skinIndex[v * 4] = B.hand;
      skinWeight[v * 4] = 1;
    }
    region[v * 4] = Math.round(palmSide * 255);
    region[v * 4 + 1] = Math.round(nail * 255);
    region[v * 4 + 2] = Math.round(Math.min(1, crease) * 255);
    region[v * 4 + 3] = Math.round(Math.min(1, flush) * 255);
  }
  return { skinIndex, skinWeight, region };
}
