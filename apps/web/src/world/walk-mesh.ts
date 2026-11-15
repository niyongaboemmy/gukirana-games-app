import { inBuilding } from "./footprints";
import { EXPANSION_PLOTS, EXPANSION_RING, OUTER_PROMENADE, PAVING_R, PORTALS, ringOf, ringPoint } from "./layout";
import { DISTRICT_WALKS, PROMENADE_DEG, PROMENADE_EAST_DEG, PROMENADE_R, WALK_TOTEMS, type P } from "./campus";

/**
 * The campus walk network as ONE paved surface (P2-WLD-16): the district walks, the outer promenade and the hall
 * forecourts are a signed distance field (paths = polylines with a half-width, forecourts = rectangles), joined with a
 * smooth union so every junction is a single surface with rounded fillets (no overlapping slabs, no z-fighting, no
 * kerb running across a junction), clipped where the walks meet the plaza paving. Marching squares turn the field
 * into triangles (interior runs as long strips, the boundary cells as exact convex polygons); the contour gives the
 * slim flush edging, the edging's 6 cm face and the soft soil line into the lawn.
 *
 * Pure (no three.js): CampusRoads.tsx wraps the arrays into geometry, the tests check the junctions.
 */

/** A paved path: centre line and half-width (m). */
export interface WalkPath {
  id: string;
  pts: P[];
  hw: number;
}
/** A paved forecourt: oriented rectangle (same convention as obstacles.ts rect: rotY of the local frame). */
export interface WalkPad {
  id: string;
  x: number;
  z: number;
  hw: number;
  hd: number;
  rot: number;
}

/** Corner radius (m) of the bends in the district walks: gentle curves instead of mitred kinks. */
export const WALK_BEND_R = 9;
/** Fillet size (m) of the smooth union where two walks (or a walk and a forecourt) meet. */
export const JUNCTION_K = 2.6;
/** Edging width (m): a slim flush granite band along every edge. */
export const EDGING_W = 0.09;
/** Soil line into the lawn (m). */
export const VERGE_W = 0.5;

/** Round every interior corner of a polyline with a circular arc of radius ≤ r (limited by the leg lengths). */
export function fillet(pts: P[], r: number, step = 0.7): P[] {
  if (pts.length < 3) return pts.map((p) => ({ ...p }));
  const out: P[] = [{ ...pts[0]! }];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    const la = Math.hypot(a.x - b.x, a.z - b.z);
    const lc = Math.hypot(c.x - b.x, c.z - b.z);
    const u = { x: (a.x - b.x) / la, z: (a.z - b.z) / la };
    const v = { x: (c.x - b.x) / lc, z: (c.z - b.z) / lc };
    const theta = Math.acos(Math.max(-1, Math.min(1, u.x * v.x + u.z * v.z))); // interior angle
    if (Math.PI - theta < 0.02) {
      out.push({ ...b });
      continue;
    }
    const half = Math.tan(theta / 2);
    const t = Math.min(r / half, 0.45 * Math.min(la, lc));
    const re = t * half;
    const t1 = { x: b.x + u.x * t, z: b.z + u.z * t };
    const t2 = { x: b.x + v.x * t, z: b.z + v.z * t };
    const bis = { x: u.x + v.x, z: u.z + v.z };
    const bl = Math.hypot(bis.x, bis.z);
    const off = re / Math.sin(theta / 2);
    const o = { x: b.x + (bis.x / bl) * off, z: b.z + (bis.z / bl) * off };
    const a1 = Math.atan2(t1.z - o.z, t1.x - o.x);
    let d = Math.atan2(t2.z - o.z, t2.x - o.x) - a1;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const n = Math.max(2, Math.ceil((Math.abs(d) * re) / step));
    for (let k = 0; k <= n; k++) out.push({ x: o.x + Math.cos(a1 + (d * k) / n) * re, z: o.z + Math.sin(a1 + (d * k) / n) * re });
  }
  out.push({ ...pts[pts.length - 1]! });
  return out;
}

/** The outer promenade's centre line (bearings −PROMENADE_DEG … +PROMENADE_EAST_DEG). */
function promenadeLine(): P[] {
  const out: P[] = [];
  const step = 1.25;
  for (let b = -PROMENADE_DEG; b < PROMENADE_EAST_DEG; b += step) {
    const q = ringPoint(b, PROMENADE_R);
    out.push({ x: q.x, z: q.z });
  }
  const q = ringPoint(PROMENADE_EAST_DEG, PROMENADE_R);
  out.push({ x: q.x, z: q.z });
  return out;
}

export const WALK_PATHS: WalkPath[] = [
  { id: "promenade", pts: promenadeLine(), hw: (OUTER_PROMENADE.r1 - OUTER_PROMENADE.r0) / 2 },
  ...DISTRICT_WALKS.map((w) => ({ id: w.id, pts: fillet(w.pts, WALK_BEND_R), hw: w.hw })),
];

/** Forecourts in front of the expansion plots (16 m) and of the outer-ring halls (the Administrative Block, 18 m). */
export const WALK_PADS: WalkPad[] = [
  ...EXPANSION_PLOTS.map((e) => ({ id: e.id, deg: e.angleDeg, w: 16 })),
  ...PORTALS.filter((p) => ringOf(p) === EXPANSION_RING).map((p) => ({ id: p.id, deg: p.angleDeg, w: 18 })),
].map(({ id, deg, w }) => {
  const m = ringPoint(deg, (OUTER_PROMENADE.r1 + EXPANSION_RING) / 2 + 0.3);
  return { id, x: m.x, z: m.z, hw: w / 2, hd: (EXPANSION_RING - OUTER_PROMENADE.r1 + 1.2) / 2, rot: m.rotY };
});

/* ---------------------------------------------------------------- the field ---------------------------------------------------------------- */

function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}
function padSdf(p: WalkPad, x: number, z: number) {
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  const dx = x - p.x;
  const dz = z - p.z;
  const qx = Math.abs(dx * c - dz * s) - p.hw;
  const qz = Math.abs(dx * s + dz * c) - p.hd;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qz, 0));
  return -(outside + Math.min(Math.max(qx, qz), 0));
}
/** smooth maximum (polynomial): max(a, b) plus a fillet where the two are within k of each other */
export function smax(a: number, b: number, k = JUNCTION_K) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + (h * h * k) / 4;
}
const NONE = -1e3;

interface Group {
  /** primitive pieces with their bounds (for the grid stamping and quick rejects) */
  pieces: { x0: number; x1: number; z0: number; z1: number; f: (x: number, z: number) => number }[];
}
const GROUPS: Group[] = [
  ...WALK_PATHS.map((w) => ({
    pieces: w.pts.slice(0, -1).map((a, i) => {
      const b = w.pts[i + 1]!;
      const m = w.hw + JUNCTION_K + 0.5;
      return { x0: Math.min(a.x, b.x) - m, x1: Math.max(a.x, b.x) + m, z0: Math.min(a.z, b.z) - m, z1: Math.max(a.z, b.z) + m, f: (x: number, z: number) => w.hw - segDist(x, z, a.x, a.z, b.x, b.z) };
    }),
  })),
  ...WALK_PADS.map((p) => {
    const m = Math.hypot(p.hw, p.hd) + JUNCTION_K + 0.5;
    return { pieces: [{ x0: p.x - m, x1: p.x + m, z0: p.z - m, z1: p.z + m, f: (x: number, z: number) => padSdf(p, x, z) }] };
  }),
];
/** the walks start where the plaza paving ends (its edge is the junction: no edging across it) */
const plazaClip = (x: number, z: number) => Math.hypot(x, z) - PAVING_R;

/** Signed distance (m, > 0 on the paving) of the walk network. */
export function walkSdf(x: number, z: number): number {
  let acc = NONE;
  for (const g of GROUPS) {
    let v = NONE;
    for (const p of g.pieces) if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) v = Math.max(v, p.f(x, z));
    if (v > NONE) acc = acc === NONE ? v : smax(acc, v);
  }
  return Math.min(acc, plazaClip(x, z));
}
/** Is a point on the paved walk network (within `margin` m of its edge)? */
export const onWalkPaving = (x: number, z: number, margin = 0) => walkSdf(x, z) > -margin;

/**
 * Bearing ranges (deg, d0 < d1, covering −180 … 180) of the plaza paving's edge band: the full circle except the
 * mouths where a walk leaves the plaza (the walk's paving and the plaza's meet there, no band across the junction).
 */
export function plazaEdgeArcs(step = 0.25): [number, number][] {
  const out: [number, number][] = [];
  let start: number | null = null;
  for (let d = -180; d <= 180 + 1e-9; d += step) {
    // (the band is 0.8 m wide: open wherever any part of it would lie on a walk's paving)
    const mouth =
      d < 180 &&
      [0.05, 0.4, 0.75].some((o) => {
        const q = ringPoint(d, PAVING_R + o);
        return walkSdf(q.x, q.z) > -0.03;
      });
    if (!mouth && start == null) start = d;
    if ((mouth || d >= 180) && start != null) {
      if (d - start > 1e-6) out.push([start, Math.min(180, d)]);
      start = null;
    }
  }
  return out;
}

/* ---------------------------------------------------------------- the surface ---------------------------------------------------------------- */

export interface WalkSurface {
  /** paving triangles (x, y, z per vertex) */
  pave: Float32Array;
  /** flush edging band (on the paving, along every edge but the plaza junction) */
  edge: Float32Array;
  /** the edging's outer face, down into the lawn */
  side: Float32Array;
  /** soil line into the lawn (positions + uv: v 0.5 at the edge → 1 out on the lawn, for a radial blob texture) */
  verge: Float32Array;
  vergeUv: Float32Array;
  /** contour segments of the paving edge (x0, z0, x1, z1) */
  contour: Float32Array;
  cell: number;
}

export function buildWalkSurface(opts: { cell?: number; y?: number } = {}): WalkSurface {
  const cell = opts.cell ?? 0.35;
  const Y = opts.y ?? 0.006;
  let bx0 = Infinity;
  let bx1 = -Infinity;
  let bz0 = Infinity;
  let bz1 = -Infinity;
  for (const g of GROUPS)
    for (const p of g.pieces) {
      bx0 = Math.min(bx0, p.x0);
      bx1 = Math.max(bx1, p.x1);
      bz0 = Math.min(bz0, p.z0);
      bz1 = Math.max(bz1, p.z1);
    }
  const nx = Math.ceil((bx1 - bx0) / cell) + 1;
  const nz = Math.ceil((bz1 - bz0) / cell) + 1;
  const acc = new Float32Array(nx * nz).fill(NONE);
  const tmp = new Float32Array(nx * nz);
  const mark = new Int32Array(nx * nz).fill(-1);
  const X = (i: number) => bx0 + i * cell;
  const Z = (j: number) => bz0 + j * cell;
  // stamp every group (hard union of its pieces), then fold it in with the smooth union
  GROUPS.forEach((g, gi) => {
    const touched: number[] = [];
    for (const p of g.pieces) {
      const i0 = Math.max(0, Math.floor((p.x0 - bx0) / cell));
      const i1 = Math.min(nx - 1, Math.ceil((p.x1 - bx0) / cell));
      const j0 = Math.max(0, Math.floor((p.z0 - bz0) / cell));
      const j1 = Math.min(nz - 1, Math.ceil((p.z1 - bz0) / cell));
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const x = X(i);
          const z = Z(j);
          if (x < p.x0 || x > p.x1 || z < p.z0 || z > p.z1) continue;
          const k = j * nx + i;
          const v = p.f(x, z);
          if (mark[k] !== gi) {
            mark[k] = gi;
            tmp[k] = v;
            touched.push(k);
          } else if (v > tmp[k]!) tmp[k] = v;
        }
    }
    for (const k of touched) acc[k] = acc[k] === NONE ? tmp[k]! : smax(acc[k]!, tmp[k]!);
  });
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) acc[j * nx + i] = Math.min(acc[j * nx + i]!, plazaClip(X(i), Z(j)));

  const pave: number[] = [];
  const segs: number[] = [];
  const tri = (a: P, b: P, c: P) => {
    // up-facing winding (counter-clockwise seen from +y: (b − a) × (c − a) has y > 0)
    const cy = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    if (cy >= 0) pave.push(a.x, Y, a.z, b.x, Y, b.z, c.x, Y, c.z);
    else pave.push(a.x, Y, a.z, c.x, Y, c.z, b.x, Y, b.z);
  };
  const lerpP = (ax: number, az: number, va: number, bx: number, bz: number, vb: number): P => {
    const t = va / (va - vb);
    return { x: ax + (bx - ax) * t, z: az + (bz - az) * t };
  };
  for (let j = 0; j < nz - 1; j++) {
    let run = -1;
    const flush = (end: number) => {
      if (run < 0) return;
      const a = { x: X(run), z: Z(j) };
      const b = { x: X(end), z: Z(j) };
      const c = { x: X(end), z: Z(j + 1) };
      const d = { x: X(run), z: Z(j + 1) };
      tri(a, b, c);
      tri(a, c, d);
      run = -1;
    };
    for (let i = 0; i < nx - 1; i++) {
      // corners in order round the cell: 00, 10, 11, 01
      const cx = [X(i), X(i + 1), X(i + 1), X(i)];
      const cz = [Z(j), Z(j), Z(j + 1), Z(j + 1)];
      const v = [acc[j * nx + i]!, acc[j * nx + i + 1]!, acc[(j + 1) * nx + i + 1]!, acc[(j + 1) * nx + i]!];
      const inside = v.map((q) => q > 0);
      const n = inside.filter(Boolean).length;
      if (n === 4) {
        if (run < 0) run = i;
        continue;
      }
      flush(i);
      if (n === 0) continue;
      const edgePt = (k: number) => {
        const m = (k + 1) % 4;
        return lerpP(cx[k]!, cz[k]!, v[k]!, cx[m]!, cz[m]!, v[m]!);
      };
      const saddle = n === 2 && inside[0] === inside[2];
      const centre = (v[0]! + v[1]! + v[2]! + v[3]!) / 4;
      if (saddle && centre <= 0) {
        // two separate corners
        for (let k = 0; k < 4; k++) {
          if (!inside[k]) continue;
          const e0 = edgePt(k); // towards the next corner
          const e1 = edgePt((k + 3) % 4); // from the previous corner
          tri({ x: cx[k]!, z: cz[k]! }, e0, e1);
          segs.push(e0.x, e0.z, e1.x, e1.z);
        }
        continue;
      }
      // one convex polygon: corners inside + crossings, in order round the cell
      const poly: P[] = [];
      const crossings: number[] = [];
      for (let k = 0; k < 4; k++) {
        if (inside[k]) poly.push({ x: cx[k]!, z: cz[k]! });
        if (inside[k] !== inside[(k + 1) % 4]) {
          crossings.push(poly.length);
          poly.push(edgePt(k));
        }
      }
      for (let k = 1; k < poly.length - 1; k++) tri(poly[0]!, poly[k]!, poly[k + 1]!);
      // contour segments: consecutive crossing points (a crossing followed by a crossing, round the polygon)
      for (const c of crossings) {
        const nxt = (c + 1) % poly.length;
        if (crossings.includes(nxt)) segs.push(poly[c]!.x, poly[c]!.z, poly[nxt]!.x, poly[nxt]!.z);
      }
    }
    flush(nx - 1);
  }

  // edging, its face and the soil line along the contour (not along the plaza junction)
  const edge: number[] = [];
  const side: number[] = [];
  const verge: number[] = [];
  const vergeUv: number[] = [];
  const normalAt = (x: number, z: number): P => {
    const h = 0.04;
    const gx = walkSdf(x + h, z) - walkSdf(x - h, z);
    const gz = walkSdf(x, z + h) - walkSdf(x, z - h);
    const l = Math.hypot(gx, gz) || 1;
    return { x: gx / l, z: gz / l };
  };
  const quadUp = (out: number[], a: P, b: P, c: P, d: P, y: number) => {
    // a-b-c-d round the quad; keep both triangles up-facing
    const push = (p: P, q: P, r: P) => {
      const cy = (q.z - p.z) * (r.x - p.x) - (q.x - p.x) * (r.z - p.z);
      if (cy >= 0) out.push(p.x, y, p.z, q.x, y, q.z, r.x, y, r.z);
      else out.push(p.x, y, p.z, r.x, y, r.z, q.x, y, q.z);
    };
    push(a, b, c);
    push(a, c, d);
  };
  const nCache = new Map<string, P>();
  const nAt = (x: number, z: number) => {
    const key = `${x.toFixed(4)},${z.toFixed(4)}`;
    let n = nCache.get(key);
    if (!n) {
      n = normalAt(x, z);
      nCache.set(key, n);
    }
    return n;
  };
  for (let s = 0; s < segs.length; s += 4) {
    const a = { x: segs[s]!, z: segs[s + 1]! };
    const b = { x: segs[s + 2]!, z: segs[s + 3]! };
    // the plaza junction: the walk simply meets the plaza paving
    if (Math.abs(plazaClip(a.x, a.z)) < 0.05 && Math.abs(plazaClip(b.x, b.z)) < 0.05) continue;
    const na = nAt(a.x, a.z);
    const nb = nAt(b.x, b.z);
    quadUp(edge, a, b, { x: b.x + nb.x * EDGING_W, z: b.z + nb.z * EDGING_W }, { x: a.x + na.x * EDGING_W, z: a.z + na.z * EDGING_W }, Y + 0.016);
    // outer face (both triangles facing out: the lawn side)
    const y0 = -0.07;
    const y1 = Y + 0.016;
    const out = { x: -(na.x + nb.x) / 2, z: -(na.z + nb.z) / 2 };
    const t = [a.x, y0, a.z, b.x, y0, b.z, b.x, y1, b.z, a.x, y0, a.z, b.x, y1, b.z, a.x, y1, a.z];
    // the first triangle's normal is ∝ (−(b − a).z, 0, (b − a).x): keep the winding when that faces the lawn
    const fx = -(b.z - a.z);
    const fz = b.x - a.x;
    if (fx * out.x + fz * out.z > 0) side.push(...t);
    else side.push(t[0]!, t[1]!, t[2]!, t[6]!, t[7]!, t[8]!, t[3]!, t[4]!, t[5]!, t[9]!, t[10]!, t[11]!, t[15]!, t[16]!, t[17]!, t[12]!, t[13]!, t[14]!);
    // soil line: dark at the edge, fading out over VERGE_W
    const vy = -0.035;
    const ao = { x: a.x - na.x * VERGE_W, z: a.z - na.z * VERGE_W };
    const bo = { x: b.x - nb.x * VERGE_W, z: b.z - nb.z * VERGE_W };
    const before = verge.length;
    quadUp(verge, a, b, bo, ao, vy);
    for (let k = before; k < verge.length; k += 3) {
      const px = verge[k]!;
      const pz = verge[k + 2]!;
      const onEdge = (Math.abs(px - a.x) < 1e-6 && Math.abs(pz - a.z) < 1e-6) || (Math.abs(px - b.x) < 1e-6 && Math.abs(pz - b.z) < 1e-6);
      vergeUv.push(0.5, onEdge ? 0.5 : 1.0);
    }
  }
  return {
    pave: new Float32Array(pave),
    edge: new Float32Array(edge),
    side: new Float32Array(side),
    verge: new Float32Array(verge),
    vergeUv: new Float32Array(vergeUv),
    contour: new Float32Array(segs),
    cell,
  };
}

/* ---------------------------------------------------------------- walk furniture ---------------------------------------------------------------- */

/** Lamp posts, benches and litter bins along the walks (deterministic, clear of buildings, totems and each other). */
export interface WalkProp {
  kind: "lamp" | "bench" | "bin";
  x: number;
  z: number;
  /** facing (rotation about y): a bench's local +z faces the walk */
  rotY: number;
}
export const WALK_PROPS: WalkProp[] = (() => {
  const out: WalkProp[] = [];
  const clear = (x: number, z: number, r: number) =>
    !inBuilding(x, z, 1.2) &&
    walkSdf(x, z) < -0.25 &&
    Math.hypot(x, z) > PAVING_R + 3 &&
    WALK_TOTEMS.every((t) => Math.hypot(t.x - x, t.z - z) > 2.4) &&
    out.every((p) => Math.hypot(p.x - x, p.z - z) > r);
  for (const w of WALK_PATHS) {
    const prom = w.id === "promenade";
    // arc length along the path
    const cum = [0];
    for (let i = 1; i < w.pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(w.pts[i]!.x - w.pts[i - 1]!.x, w.pts[i]!.z - w.pts[i - 1]!.z));
    const total = cum[cum.length - 1]!;
    const at = (s: number) => {
      let i = 0;
      while (i < cum.length - 2 && cum[i + 1]! < s) i++;
      const a = w.pts[i]!;
      const b = w.pts[i + 1]!;
      const L = Math.max(1e-6, cum[i + 1]! - cum[i]!);
      const t = (s - cum[i]!) / L;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx: (b.x - a.x) / L, tz: (b.z - a.z) / L };
    };
    /** the side of the path away from the campus centre (+1) or towards it (−1) */
    const sideOut = (q: { x: number; z: number; tx: number; tz: number }) => (-q.tz * q.x + q.tx * q.z > 0 ? 1 : -1);
    // lamps: every 20 m, alternating sides on the district walks, on the outer edge of the promenade
    let k = 0;
    for (let s = 9; s < total - 4; s += 20, k++) {
      const q = at(s);
      const side = prom ? sideOut(q) : k % 2 ? 1 : -1;
      const o = w.hw + 0.55;
      const x = q.x - q.tz * side * o;
      const z = q.z + q.tx * side * o;
      if (clear(x, z, 4)) out.push({ kind: "lamp", x, z, rotY: Math.atan2(q.tz * side, -q.tx * side) });
    }
    // benches with a bin beside them: every 42 m along the promenade (outer side, looking in), one per district walk
    const benchAt = prom ? Array.from({ length: Math.floor((total - 20) / 42) }, (_, i) => 20 + i * 42) : [total * 0.55];
    for (const s of benchAt) {
      const q = at(s);
      const side = prom ? sideOut(q) : 1;
      const o = w.hw + 0.85;
      const x = q.x - q.tz * side * o;
      const z = q.z + q.tx * side * o;
      const bx = x + q.tx * 1.75;
      const bz = z + q.tz * 1.75;
      if (!clear(x, z, 3) || !clear(bx, bz, 1.2)) continue;
      // facing the walk: local +z points from the bench towards the centre line
      const rotY = Math.atan2(q.tz * side, -q.tx * side);
      out.push({ kind: "bench", x, z, rotY });
      out.push({ kind: "bin", x: bx, z: bz, rotY });
    }
  }
  return out;
})();
